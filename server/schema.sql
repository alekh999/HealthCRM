CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Administrator', 'Doctor', 'Staff')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY,
  patient_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('Female', 'Male', 'Other')),
  contact_number TEXT NOT NULL,
  address_enc TEXT,
  medical_history_enc TEXT,
  insurance_provider TEXT,
  insurance_policy_id_enc TEXT,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (LOWER(full_name));
CREATE INDEX IF NOT EXISTS patients_number_idx ON patients (patient_number);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  patient_name TEXT NOT NULL,
  service_description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid')),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY,
  patient_name TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  department TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  reason_enc TEXT,
  contact_enc TEXT,
  status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Confirmed', 'Completed', 'Cancelled')),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON appointments (status);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS contact_enc TEXT;


CREATE TABLE IF NOT EXISTS internal_messages (
  id UUID PRIMARY KEY,
  sender_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  subject_enc TEXT NOT NULL,
  body_enc TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS internal_messages_inbox_idx ON internal_messages (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS internal_messages_sent_idx ON internal_messages (sender_user_id, created_at DESC);
