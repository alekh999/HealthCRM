import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const app = express();
const { Pool } = pg;

const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'DATA_ENCRYPTION_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
  throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'https://alekh999.github.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by the API CORS policy.'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600
}));
app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });

const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64');
function encryptPrivateField(value) {
  if (value === undefined || value === null || value === '') return null;
  const iv = cryptoRandomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}
function decryptPrivateField(value) {
  if (!value) return '';
  const [version, iv64, tag64, data64] = value.split(':');
  if (version !== 'v1') throw new Error('Unsupported encrypted field version.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv64, 'base64'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data64, 'base64')), decipher.final()]).toString('utf8');
}
function cryptoRandomBytes(size) { return randomBytes(size); }
function toUser(row) {
  return { id: row.id, username: row.username, name: row.full_name, role: row.role };
}
function cleanString(value, maxLength, fieldName, required = false) {
  if (typeof value !== 'string') { const error = new Error(`${fieldName} must be text.`); error.status = 400; throw error; }
  const result = value.trim();
  if (required && !result) { const error = new Error(`${fieldName} is required.`); error.status = 400; throw error; }
  if (result.length > maxLength) { const error = new Error(`${fieldName} is too long.`); error.status = 400; throw error; }
  return result;
}
function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    { const error = new Error('Date of birth must be a valid YYYY-MM-DD date.'); error.status = 400; throw error; }
  }
  return value;
}
async function audit(actorId, eventType, entityType, entityId = null) {
  await pool.query(
    'INSERT INTO audit_events (id, actor_user_id, event_type, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), actorId || null, eventType, entityType, entityId ? String(entityId) : null]
  );
}

function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'healthcrm' });
    req.auth = { userId: payload.sub };
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}
async function loadUser(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT id, username, full_name, role, active FROM app_users WHERE id = $1',
      [req.auth.userId]
    );
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account is inactive or no longer exists.' });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}
const signedIn = [authRequired, loadUser];

async function ensureSchemaAndAdmin() {
  const schema = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM app_users');
  if (count.rows[0].count === 0) {
    const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const name = (process.env.BOOTSTRAP_ADMIN_NAME || 'Clinic Administrator').trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD to a unique password of at least 12 characters before first deployment.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO app_users (id, username, full_name, role, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), username, name, 'Administrator', passwordHash]
    );
    console.log('Initial administrator account created. Credentials are not logged.');
  }
}

function handleAsync(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/health', handleAsync(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', service: 'Jabalpur Clinic Portal API', database: 'connected' });
}));

app.post('/api/auth/login', loginLimiter, handleAsync(async (req, res) => {
  const username = cleanString(req.body?.username || '', 64, 'Username', true).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || password.length > 256) return res.status(400).json({ error: 'Username and password are required.' });

  const result = await pool.query(
    'SELECT id, username, full_name, role, password_hash, active FROM app_users WHERE username = $1',
    [username]
  );
  const row = result.rows[0];
  const valid = row && row.active && await bcrypt.compare(password, row.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password.' });

  const token = jwt.sign({ sub: row.id }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'healthcrm' });
  await audit(row.id, 'login', 'user', row.id);
  res.json({ token, user: toUser(row), expiresIn: 28800 });
}));

app.get('/api/auth/me', ...signedIn, (req, res) => {
  res.json({ user: toUser(req.user) });
});

app.patch('/api/auth/profile', ...signedIn, handleAsync(async (req, res) => {
  const fullName = cleanString(req.body?.name || '', 120, 'Name', true);
  const result = await pool.query(
    'UPDATE app_users SET full_name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, full_name, role',
    [fullName, req.user.id]
  );
  await audit(req.user.id, 'profile_updated', 'user', req.user.id);
  res.json({ user: toUser(result.rows[0]) });
}));

app.post('/api/auth/change-password', ...signedIn, handleAsync(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword || newPassword.length < 12 || newPassword.length > 256) {
    return res.status(400).json({ error: 'Enter your current password and a new password of at least 12 characters.' });
  }
  const result = await pool.query('SELECT password_hash FROM app_users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, req.user.id]);
  await audit(req.user.id, 'password_changed', 'user', req.user.id);
  res.json({ ok: true, message: 'Password updated. Sign in again on other devices.' });
}));

app.get('/api/users', ...signedIn, requireRoles('Administrator'), handleAsync(async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, full_name, role, active, created_at FROM app_users ORDER BY created_at ASC'
  );
  res.json({ users: result.rows.map((row) => ({ ...toUser(row), active: row.active, createdAt: row.created_at })) });
}));

app.post('/api/users', ...signedIn, requireRoles('Administrator'), handleAsync(async (req, res) => {
  const username = cleanString(req.body?.username || '', 40, 'Username', true).toLowerCase();
  const fullName = cleanString(req.body?.name || '', 120, 'Name', true);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role;
  if (!/^[a-z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Username can contain lowercase letters, numbers, dots, underscores and hyphens only.' });
  if (!['Administrator', 'Doctor', 'Staff'].includes(role)) return res.status(400).json({ error: 'Choose Administrator, Doctor or Staff.' });
  if (password.length < 12 || password.length > 256) return res.status(400).json({ error: 'Initial password must contain at least 12 characters.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const id = randomUUID();
  try {
    const result = await pool.query(
      'INSERT INTO app_users (id, username, full_name, role, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, role, active, created_at',
      [id, username, fullName, role, passwordHash]
    );
    await audit(req.user.id, 'user_created', 'user', id);
    res.status(201).json({ user: { ...toUser(result.rows[0]), active: result.rows[0].active, createdAt: result.rows[0].created_at } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That username already exists.' });
    throw error;
  }
}));

app.get('/api/patients', ...signedIn, handleAsync(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const result = await pool.query(
    `SELECT * FROM patients
       WHERE ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR patient_number ILIKE '%' || $1 || '%')
       ORDER BY created_at DESC LIMIT 500`,
    [q]
  );
  res.json({ patients: result.rows.map(shapePatient) });
}));

function shapePatient(row) {
  return {
    id: row.id,
    patientNumber: row.patient_number,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth.toISOString ? row.date_of_birth.toISOString().slice(0, 10) : String(row.date_of_birth).slice(0, 10),
    gender: row.gender,
    contact: row.contact_number,
    address: decryptPrivateField(row.address_enc),
    medicalHistory: decryptPrivateField(row.medical_history_enc),
    insuranceProvider: row.insurance_provider || '',
    insurancePolicyId: decryptPrivateField(row.insurance_policy_id_enc),
    createdAt: row.created_at
  };
}

app.post('/api/patients', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  const fullName = cleanString(req.body?.fullName || '', 120, 'Patient name', true);
  const dob = validateDate(req.body?.dateOfBirth);
  const gender = req.body?.gender;
  if (!['Female', 'Male', 'Other'].includes(gender)) return res.status(400).json({ error: 'Choose a valid gender.' });
  const contact = cleanString(req.body?.contact || '', 30, 'Contact number', true);
  const addressEnc = encryptPrivateField(cleanString(req.body?.address || '', 1000, 'Address'));
  const historyEnc = encryptPrivateField(cleanString(req.body?.medicalHistory || '', 5000, 'Medical history'));
  const provider = cleanString(req.body?.insuranceProvider || '', 120, 'Insurance provider');
  const policyEnc = encryptPrivateField(cleanString(req.body?.insurancePolicyId || '', 120, 'Insurance policy ID'));
  const id = randomUUID();
  const number = 'JCP-' + randomUUID().slice(0, 8).toUpperCase();
  const result = await pool.query(
    `INSERT INTO patients (id, patient_number, full_name, date_of_birth, gender, contact_number, address_enc, medical_history_enc, insurance_provider, insurance_policy_id_enc, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, number, fullName, dob, gender, contact, addressEnc, historyEnc, provider, policyEnc, req.user.id]
  );
  await audit(req.user.id, 'patient_created', 'patient', id);
  res.status(201).json({ patient: shapePatient(result.rows[0]) });
}));

app.patch('/api/patients/:id', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  const allowed = {
    fullName: (v) => cleanString(v, 120, 'Patient name', true),
    dateOfBirth: (v) => validateDate(v),
    gender: (v) => {
      if (!['Female', 'Male', 'Other'].includes(v)) throw new Error('Choose a valid gender.');
      return v;
    },
    contact: (v) => cleanString(v, 30, 'Contact number', true),
    address: (v) => encryptPrivateField(cleanString(v, 1000, 'Address')),
    medicalHistory: (v) => encryptPrivateField(cleanString(v, 5000, 'Medical history')),
    insuranceProvider: (v) => cleanString(v, 120, 'Insurance provider'),
    insurancePolicyId: (v) => encryptPrivateField(cleanString(v, 120, 'Insurance policy ID'))
  };
  const columnMap = {
    fullName: 'full_name', dateOfBirth: 'date_of_birth', gender: 'gender', contact: 'contact_number',
    address: 'address_enc', medicalHistory: 'medical_history_enc', insuranceProvider: 'insurance_provider',
    insurancePolicyId: 'insurance_policy_id_enc'
  };
  const sets = [];
  const values = [];
  for (const [keyName, validator] of Object.entries(allowed)) {
    if (Object.hasOwn(req.body || {}, keyName)) {
      values.push(validator(req.body[keyName]));
      sets.push(`${columnMap[keyName]} = $${values.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable patient fields were supplied.' });
  values.push(new Date());
  sets.push(`updated_at = $${values.length}`);
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE patients SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Patient not found.' });
  await audit(req.user.id, 'patient_updated', 'patient', req.params.id);
  res.json({ patient: shapePatient(result.rows[0]) });
}));

app.delete('/api/patients/:id', ...signedIn, requireRoles('Administrator'), handleAsync(async (req, res) => {
  const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Patient not found.' });
  await audit(req.user.id, 'patient_deleted', 'patient', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/appointments', ...signedIn, handleAsync(async (req, res) => {
  const result = await pool.query(
    'SELECT id, patient_name, doctor_name, department, scheduled_at, reason_enc, status, created_at FROM appointments ORDER BY scheduled_at DESC LIMIT 500'
  );
  res.json({ appointments: result.rows.map((row) => ({
    id: row.id, patient: row.patient_name, doctor: row.doctor_name, department: row.department,
    scheduledAt: row.scheduled_at, reason: decryptPrivateField(row.reason_enc), status: row.status, createdAt: row.created_at
  })) });
}));

app.post('/api/appointments', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  const patient = cleanString(req.body?.patient || '', 120, 'Patient name', true);
  const doctor = cleanString(req.body?.doctor || '', 120, 'Doctor name', true);
  const department = cleanString(req.body?.department || '', 100, 'Department', true);
  const reasonEnc = encryptPrivateField(cleanString(req.body?.reason || '', 500, 'Reason'));
  const scheduledAt = req.body?.scheduledAt;
  const when = new Date(scheduledAt);
  if (typeof scheduledAt !== 'string' || Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 5 * 60 * 1000) {
    return res.status(400).json({ error: 'Choose a valid future appointment date and time.' });
  }
  const id = randomUUID();
  const result = await pool.query(
    \`INSERT INTO appointments (id, patient_name, doctor_name, department, scheduled_at, reason_enc, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, patient_name, doctor_name, department, scheduled_at, reason, status, created_at\`,
    [id, patient, doctor, department, when.toISOString(), reasonEnc, req.user.id]
  );
  await audit(req.user.id, 'appointment_requested', 'appointment', id);
  const row = result.rows[0];
  res.status(201).json({ appointment: {
    id: row.id, patient: row.patient_name, doctor: row.doctor_name, department: row.department,
    scheduledAt: row.scheduled_at, reason: row.reason, status: row.status, createdAt: row.created_at
  } });
}));

app.patch('/api/appointments/:id/status', ...signedIn, requireRoles('Administrator', 'Staff', 'Doctor'), handleAsync(async (req, res) => {
  const allowed = ['Requested', 'Confirmed', 'Completed', 'Cancelled'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: 'Invalid appointment status.' });
  const result = await pool.query(
    'UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
    [req.body.status, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Appointment not found.' });
  await audit(req.user.id, 'appointment_status_changed', 'appointment', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/invoices', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  const result = await pool.query(
    'SELECT id, invoice_number, patient_name, service_description, amount::text, currency, status, created_at FROM invoices ORDER BY created_at DESC LIMIT 500'
  );
  res.json({ invoices: result.rows.map((row) => ({
    id: row.id, invoiceNumber: row.invoice_number, patient: row.patient_name,
    service: row.service_description, amount: Number(row.amount), currency: row.currency,
    status: row.status, createdAt: row.created_at
  })) });
}));

app.post('/api/invoices', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  const patient = cleanString(req.body?.patient || '', 120, 'Patient name', true);
  const service = cleanString(req.body?.service || '', 160, 'Service', true);
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Enter a valid INR amount greater than zero.' });
  const id = randomUUID();
  const number = 'JCP-' + randomUUID().slice(0, 8).toUpperCase();
  const result = await pool.query(
    `INSERT INTO invoices (id, invoice_number, patient_name, service_description, amount, currency, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'INR','Pending',$6)
     RETURNING id, invoice_number, patient_name, service_description, amount::text, currency, status, created_at`,
    [id, number, patient, service, amount.toFixed(2), req.user.id]
  );
  await audit(req.user.id, 'invoice_created', 'invoice', id);
  const row = result.rows[0];
  res.status(201).json({ invoice: {
    id: row.id, invoiceNumber: row.invoice_number, patient: row.patient_name, service: row.service_description,
    amount: Number(row.amount), currency: row.currency, status: row.status, createdAt: row.created_at
  } });
}));

app.patch('/api/invoices/:id/status', ...signedIn, requireRoles('Administrator', 'Staff'), handleAsync(async (req, res) => {
  if (!['Paid', 'Pending'].includes(req.body?.status)) return res.status(400).json({ error: 'Invoice status must be Paid or Pending.' });
  const result = await pool.query(
    'UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
    [req.body.status, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Invoice not found.' });
  await audit(req.user.id, 'invoice_status_changed', 'invoice', req.params.id);
  res.json({ ok: true });
}));

async function callOpenAI(instructions, input, maxOutputTokens = 900) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('The AI service is not configured. Add OPENAI_API_KEY to the backend environment.');
    error.status = 503;
    throw error;
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-6-astra',
      instructions,
      input,
      store: false,
      max_output_tokens: maxOutputTokens
    }),
    signal: AbortSignal.timeout(45_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 429 ? 'AI usage limit reached. Please try again later.' : 'The AI service could not complete this request.');
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const outputText = (data.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
  if (!outputText) {
    const error = new Error('The AI service returned an empty response.');
    error.status = 502;
    throw error;
  }
  return outputText;
}

app.post('/api/assistant/chat', aiLimiter, handleAsync(async (req, res) => {
  const message = cleanString(req.body?.message || '', 1200, 'Message', true);
  const possibleIdentifier = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|(?:\\+?91[\\s-]?)?[6-9]\\d{9}|\\b\\d{12}\\b)/i;
  if (possibleIdentifier.test(message)) {
    return res.status(400).json({ error: 'Please remove phone numbers, email addresses, national ID numbers and patient identifiers from chat.' });
  }
  if (/\\b(my report|my test result|my diagnosis|my symptoms|my prescription|what medicine|medical record)\\b/i.test(message)) {
    return res.status(400).json({ error: 'Please do not share personal medical information here. Contact clinic staff or a qualified clinician for patient-specific help.' });
  }
  if (message.length < 2) return res.status(400).json({ error: 'Please enter a question.' });
  const clinic = {
    name: process.env.CLINIC_NAME || 'Jabalpur Clinic',
    address: process.env.CLINIC_ADDRESS || 'Not configured',
    hours: process.env.CLINIC_HOURS || 'Not configured',
    phone: process.env.CLINIC_PHONE || 'Not configured'
  };
  const instructions = `You are the administrative help assistant for ${clinic.name}. Answer in clear, polite language. You may help with appointment process, billing process, portal navigation and general clinic information. Never diagnose, triage, recommend medicines or treatment, or interpret test results. For urgent medical concerns direct the customer to immediate in-person medical care. Do not claim to book or change appointments or payments. Only state clinic details that appear below; if a detail says Not configured, tell the customer to contact reception. Never request or repeat patient identifiers, passwords, UPI PINs, card details or medical records. If a user shares personal health information, tell them not to share it in chat and do not analyze it. Verified clinic details: address: ${clinic.address}; hours: ${clinic.hours}; phone: ${clinic.phone}.`;
  const reply = await callOpenAI(instructions, message, 500);
  res.json({ reply });
}));

app.post('/api/reports/summarize', ...signedIn, requireRoles('Administrator', 'Doctor'), aiLimiter, handleAsync(async (req, res) => {
  const report = typeof req.body?.report === 'string' ? req.body.report.trim() : '';
  const approved = req.body?.deidentifiedAndAuthorized === true;
  if (!approved) return res.status(400).json({ error: 'Confirm that the report is de-identified and AI processing is authorized before sending it.' });
  if (report.length < 30 || report.length > 20000) return res.status(400).json({ error: 'Report text must be between 30 and 20,000 characters.' });
  const possibleIdentifier = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|(?:\\+?91[\\s-]?)?[6-9]\\d{9}|\\b\\d{12}\\b)/i;
  if (possibleIdentifier.test(report)) return res.status(400).json({ error: 'Potential phone, email or national ID number detected. Remove patient identifiers before AI processing.' });
  const instructions = 'You assist a qualified doctor by summarizing a de-identified clinical report. Do not diagnose or recommend treatment. Do not infer missing facts. Preserve units, values, reference ranges and uncertainty exactly. Separate (1) concise overview, (2) numeric findings with values and ranges if present, (3) abnormalities explicitly flagged by the source, and (4) questions or points for clinician verification. State when the source does not provide reference ranges. Do not claim that an unflagged result is normal. Clearly label the output as a draft for clinician review.';
  const summary = await callOpenAI(instructions, `Summarize this de-identified report for clinician review. Preserve all numbers and units accurately.\n\n${report}`, 1600);
  res.json({ summary, disclaimer: 'AI-generated draft only. A qualified clinician must review the source report and clinical context.' });
}));

app.get('/', (req, res) => res.sendFile(path.join(projectRoot, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(projectRoot, 'index.html')));
app.get('/enhancements.js', (req, res) => res.sendFile(path.join(projectRoot, 'enhancements.js')));
app.get('/config.js', (req, res) => res.sendFile(path.join(projectRoot, 'config.js')));
app.get('/api-client.js', (req, res) => res.sendFile(path.join(projectRoot, 'api-client.js')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error('Request failed:', error.message);
  else if (status === 403 || status === 401) console.warn('Access check rejected a request.');
  res.status(status).json({ error: status >= 500 ? (status === 503 || status === 502 ? error.message : 'An unexpected server error occurred.') : error.message });
});

const port = Number(process.env.PORT || 10000);
await ensureSchemaAndAdmin();
app.listen(port, '0.0.0.0', () => console.log(`HealthCRM API listening on port ${port}`));

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
