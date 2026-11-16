const moneyINR = (amount) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2
}).format(Number(amount) || 0);

// Billing: browser-local demo records. A real clinic needs a secured server/database.
const invoiceStorageKey = 'jabalpurClinicInvoicesV1';
function loadInvoices() {
  try {
    const parsed = JSON.parse(localStorage.getItem(invoiceStorageKey) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
let invoices = loadInvoices();
const invoiceBody = document.getElementById('invoice-table-body');
function saveInvoices() {
  localStorage.setItem(invoiceStorageKey, JSON.stringify(invoices));
}
function renderInvoices() {
  if (!invoiceBody) return;
  invoiceBody.replaceChildren();
  let total = 0, paid = 0, pending = 0;
  invoices.forEach((invoice) => {
    const amount = Number(invoice.amount) || 0;
    total += amount;
    if (invoice.status === 'Paid') paid += amount; else pending += amount;
    const row = document.createElement('tr');
    [invoice.id, invoice.patient, invoice.service,
      new Date(invoice.createdAt).toLocaleDateString('en-IN'),
      moneyINR(amount), invoice.status].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.className = 'p-3 text-gray-700 dark:text-gray-300' + (index === 4 ? ' text-right font-medium' : '');
      cell.textContent = String(value);
      row.appendChild(cell);
    });
    const actionCell = document.createElement('td');
    actionCell.className = 'p-3';
    if (invoice.status !== 'Paid') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Mark paid';
      button.className = 'text-xs px-2.5 py-1.5 rounded bg-green-100 text-green-800 hover:bg-green-200';
      button.dataset.invoiceId = invoice.id;
      button.dataset.invoiceAction = 'paid';
      actionCell.appendChild(button);
    } else {
      actionCell.textContent = '—';
      actionCell.className += ' text-gray-400';
    }
    row.appendChild(actionCell);
    invoiceBody.appendChild(row);
  });
  document.getElementById('billing-total').textContent = moneyINR(total);
  document.getElementById('billing-pending').textContent = moneyINR(pending);
  document.getElementById('billing-paid').textContent = moneyINR(paid);
  if (!invoices.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'p-5 text-center text-gray-500';
    cell.textContent = 'No invoices yet. Add an invoice above.';
    row.appendChild(cell);
    invoiceBody.appendChild(row);
  }
}
renderInvoices();

const invoiceForm = document.getElementById('invoice-form');
invoiceForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const patient = document.getElementById('invoice-patient').value.trim();
  const service = document.getElementById('invoice-service').value.trim();
  const amount = Number(document.getElementById('invoice-amount').value);
  const status = document.getElementById('invoice-status');
  if (!patient || !service || !Number.isFinite(amount) || amount <= 0) {
    status.textContent = 'Enter a patient name, service and amount greater than zero.';
    return;
  }
  invoices.unshift({
    id: 'JCP-' + String(Date.now()).slice(-8), patient, service, amount,
    status: 'Pending', createdAt: new Date().toISOString()
  });
  saveInvoices();
  renderInvoices();
  invoiceForm.reset();
  status.textContent = 'Invoice added. Amount recorded in INR.';
});
invoiceBody?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-invoice-action="paid"]');
  if (!button) return;
  const invoice = invoices.find((item) => item.id === button.dataset.invoiceId);
  if (invoice) {
    invoice.status = 'Paid';
    saveInvoices();
    renderInvoices();
  }
});

// Customer FAQ assistant. No patient record lookup or medical diagnosis.
const chatMessages = document.getElementById('assistant-messages');
function addChatMessage(message, sender) {
  if (!chatMessages) return;
  const wrapper = document.createElement('div');
  wrapper.className = sender === 'customer' ? 'flex justify-end' : 'flex justify-start';
  const bubble = document.createElement('div');
  bubble.className = 'max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ' +
    (sender === 'customer'
      ? 'bg-blue-600 text-white'
      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700');
  bubble.textContent = message;
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function answerClinicQuestion(question) {
  const q = question.toLowerCase();
  if (/\b(hi|hello|hey|namaste|good morning|good evening)\b/.test(q)) {
    return 'Hello! Welcome to Jabalpur Clinic Portal. I can help with general appointment, billing and portal questions.';
  }
  if (/\b(appointment|book|booking|schedule|slot|reschedule|cancel)\b/.test(q)) {
    return 'For appointments, please contact clinic reception or use the Appointments section. This prototype cannot check live doctor availability or confirm bookings.';
  }
  if (/\b(bill|billing|invoice|payment|refund|fee|charge|receipt)\b/.test(q)) {
    return 'Clinic billing is displayed in Indian Rupees (₹). For a specific bill, receipt, refund or payment confirmation, please contact reception. Never share card numbers, UPI PINs or banking passwords here.';
  }
  if (/\b(hour|timing|open|close|address|location|directions|phone|contact)\b/.test(q)) {
    return 'Verified clinic timings, address and contact details have not yet been added. Please ask Jabalpur Clinic reception for current information.';
  }
  if (/\b(service|department|specialty|speciality|doctor|consultant)\b/.test(q)) {
    return 'The approved list of clinic departments, doctors and services has not yet been added. Please contact reception for the current list.';
  }
  if (/\b(symptom|diagnos|medicine|medication|fever|pain|treatment|prescription|medical advice|emergency|bleeding|breath)\b/.test(q)) {
    return 'I cannot diagnose symptoms or recommend medicines. Please contact a qualified clinician. For a medical emergency, seek immediate in-person emergency care.';
  }
  if (/\b(report|test result|lab result|summar)\b/.test(q)) {
    return 'Authorized staff can open Reports and use the Medical Report Summarizer. It extracts text and flagged terms only; a doctor must review the original report and clinical context.';
  }
  return 'I do not have a verified answer for that question yet. Please contact clinic reception or an authorized staff member. Do not share personal health information or patient identifiers in this chat.';
}
function sendClinicQuestion(question) {
  const clean = String(question || '').trim();
  if (!clean) return;
  addChatMessage(clean, 'customer');
  addChatMessage(answerClinicQuestion(clean), 'assistant');
}
const assistantForm = document.getElementById('assistant-form');
const assistantInput = document.getElementById('assistant-input');
assistantForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  sendClinicQuestion(assistantInput.value);
  assistantInput.value = '';
});
document.querySelectorAll('[data-chat-question]').forEach((button) => {
  button.addEventListener('click', () => sendClinicQuestion(button.dataset.chatQuestion));
});
if (chatMessages && chatMessages.childElementCount === 0) {
  addChatMessage('Welcome to Jabalpur Clinic Support. Ask about appointments, billing or portal usage. I cannot access live appointments or patient records.', 'assistant');
}

// Local text summarizer: organizes report text, it does not use an AI model.
function summarizeReport(reportText) {
  const text = reportText.trim();
  if (text.length < 20) return 'Please paste report text containing at least a few lines.';
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  const flagged = lines.filter((line) =>
    /\b(high|low|abnormal|critical|positive|reactive|elevated|reduced|outside range|flagged)\b|[↑↓]|\b[HL]\b/i.test(line)
  );
  const values = lines.filter((line) =>
    /\d/.test(line) && /\b(mg\/?dl|g\/?dl|mmol\/?l|mmhg|bpm|iu\/?l|u\/?l|%|cm|kg|fl|pg)\b/i.test(line)
  );
  return [
    'OVERVIEW',
    (sentences.slice(0, 3).join(' ') || lines.slice(0, 3).join(' ')),
    '',
    'LINES EXPLICITLY FLAGGED IN THE SOURCE',
    flagged.length ? flagged.slice(0, 12).map((line) => '• ' + line).join('\n')
      : 'No explicit high/low/abnormal/critical markers were detected. This does not prove that all results are normal.',
    '',
    'NUMERIC RESULTS / MEASUREMENTS',
    values.length ? values.slice(0, 12).map((line) => '• ' + line).join('\n')
      : 'No result lines with recognized units were detected. Review the original report for values and reference ranges.',
    '',
    'REVIEW NOTE',
    'This tool organizes text only. It is not a clinical interpretation or diagnosis. A qualified clinician must review every value against the original report, reference ranges and patient context.'
  ].join('\n');
}
const reportInput = document.getElementById('report-input');
const reportFile = document.getElementById('report-file');
const reportSummary = document.getElementById('report-summary');
const reportSummaryCard = document.getElementById('report-summary-card');
const reportStatus = document.getElementById('report-summary-status');
document.getElementById('summarize-report-button')?.addEventListener('click', () => {
  reportSummary.textContent = summarizeReport(reportInput.value);
  reportSummaryCard.classList.remove('hidden');
  reportStatus.textContent = 'Summary generated locally in this browser. No report text was sent to a server.';
});
reportFile?.addEventListener('change', () => {
  const file = reportFile.files?.[0];
  if (!file) return;
  if (file.size > 1000000) {
    reportStatus.textContent = 'File is too large. Choose a text file smaller than 1 MB.';
    reportFile.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { reportInput.value = String(reader.result || ''); };
  reader.onerror = () => { reportStatus.textContent = 'Could not read this file. Please paste the report text instead.'; };
  reader.readAsText(file);
});
document.getElementById('clear-report-button')?.addEventListener('click', () => {
  reportInput.value = '';
  reportFile.value = '';
  reportSummary.textContent = '';
  reportSummaryCard.classList.add('hidden');
  reportStatus.textContent = '';
});
