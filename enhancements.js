(() => {
  const api = window.HealthCRMAPI;
  if (!api) {
    console.error('HealthCRM API client did not load.');
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const moneyINR = (amount) => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2
  }).format(Number(amount) || 0);

  function showStatus(selector, message, isError = false) {
    const el = $(selector);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('text-red-600', isError);
    el.classList.toggle('text-green-600', !isError);
  }

  function setButtonBusy(button, busy, busyText = 'Please wait…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
      button.classList.add('opacity-60', 'cursor-not-allowed');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }

  function addCell(row, value, className = 'p-3 text-gray-700 dark:text-gray-300') {
    const cell = document.createElement('td');
    cell.className = className;
    cell.textContent = value === null || value === undefined ? '' : String(value);
    row.appendChild(cell);
    return cell;
  }

  // Patients: database-backed patient listing, search, create, edit and delete.
  const patientBody = $('#patient-table-body');
  const patientStatus = $('#patient-status');
  const patientSearch = $('#patient-search');
  const addPatientForm = $('#add-patient-form');
  const editPatientForm = $('#edit-patient-form');
  const addPatientModal = $('#add-patient-modal');
  const editPatientModal = $('#edit-patient-modal');
  let patients = [];

  function setModalOpen(modal, open) {
    if (!modal) return;
    modal.classList.toggle('hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function closeModal(modal) {
    setModalOpen(modal, false);
  }

  function patientActionButton(label, className, action, id) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className + ' px-2 py-1 rounded text-xs';
    button.dataset.patientAction = action;
    button.dataset.patientId = id;
    return button;
  }

  function renderPatients() {
    if (!patientBody) return;
    patientBody.replaceChildren();
    if (!patients.length) {
      const row = document.createElement('tr');
      const cell = addCell(row, 'No patient records found.', 'p-4 text-center text-gray-500');
      cell.colSpan = 6;
      patientBody.appendChild(row);
      return;
    }
    patients.forEach((patient) => {
      const row = document.createElement('tr');
      row.className = 'border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50';
      row.dataset.patientId = patient.id;
      row.dataset.patientName = patient.fullName;
      addCell(row, patient.patientNumber);
      addCell(row, patient.fullName, 'p-3 text-gray-900 dark:text-gray-100 font-medium');
      addCell(row, patient.dateOfBirth);
      addCell(row, patient.gender);
      addCell(row, patient.contact);
      const actions = document.createElement('td');
      actions.className = 'p-3 flex flex-wrap gap-2';
      actions.appendChild(patientActionButton('View', 'text-blue-700 bg-blue-50 hover:bg-blue-100', 'view', patient.id));
      if (['Administrator', 'Staff'].includes(window.__healthcrmUser?.role)) {
        actions.appendChild(patientActionButton('Edit', 'text-amber-700 bg-amber-50 hover:bg-amber-100', 'edit', patient.id));
      }
      if (window.__healthcrmUser?.role === 'Administrator') {
        actions.appendChild(patientActionButton('Delete', 'text-red-700 bg-red-50 hover:bg-red-100', 'delete', patient.id));
      }
      row.appendChild(actions);
      patientBody.appendChild(row);
    });
  }

  async function loadPatients(query = '') {
    if (!api.token || !patientBody) return;
    try {
      if (patientStatus) patientStatus.textContent = 'Loading patient records…';
      const data = await api.get('/api/patients' + (query ? '?q=' + encodeURIComponent(query) : ''));
      patients = data.patients || [];
      renderPatients();
      if (patientStatus) patientStatus.textContent = patients.length + ' patient record(s) loaded from the clinic database.';
    } catch (error) {
      if (patientStatus) {
        patientStatus.textContent = error.message;
        patientStatus.classList.add('text-red-600');
      }
    }
  }

  patientSearch?.addEventListener('input', () => {
    const query = patientSearch.value.trim();
    clearTimeout(patientSearch._debounce);
    patientSearch._debounce = setTimeout(() => loadPatients(query), 250);
  });

  patientBody?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-patient-action]');
    if (!button) return;
    const patient = patients.find((item) => item.id === button.dataset.patientId);
    if (!patient) return;
    const action = button.dataset.patientAction;
    if (action === 'view') {
      window.alert([
        'Patient: ' + patient.fullName,
        'Patient number: ' + patient.patientNumber,
        'Date of birth: ' + patient.dateOfBirth,
        'Gender: ' + patient.gender,
        'Contact: ' + patient.contact,
        'Address: ' + (patient.address || 'Not provided'),
        'Medical history: ' + (patient.medicalHistory || 'Not provided')
      ].join('\n'));
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('Delete the record for ' + patient.fullName + '? This cannot be undone.')) return;
      try {
        await api.remove('/api/patients/' + encodeURIComponent(patient.id));
        await loadPatients(patientSearch?.value.trim() || '');
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }
    if (action === 'edit') {
      $('#edit-patient-id').value = patient.id;
      $('#edit-m-name').value = patient.fullName;
      $('#edit-m-dob').value = patient.dateOfBirth;
      $('#edit-m-contact').value = patient.contact;
      if ($('#edit-m-gender')) $('#edit-m-gender').value = patient.gender;
      if ($('#edit-m-address')) $('#edit-m-address').value = patient.address || '';
      if ($('#edit-m-medicalHistory')) $('#edit-m-medicalHistory').value = patient.medicalHistory || '';
      $('#edit-modal-title').textContent = 'Edit Patient: ' + patient.fullName;
      setModalOpen(editPatientModal, true);
    }
  });

  function formValue(form, name) {
    return String(new FormData(form).get(name) || '').trim();
  }

  addPatientForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = addPatientForm.querySelector('button[type="submit"]');
    setButtonBusy(submit, true, 'Saving…');
    try {
      const body = {
        fullName: formValue(addPatientForm, 'name'),
        dateOfBirth: formValue(addPatientForm, 'dob'),
        gender: formValue(addPatientForm, 'gender'),
        contact: formValue(addPatientForm, 'contact'),
        address: formValue(addPatientForm, 'address'),
        medicalHistory: formValue(addPatientForm, 'medicalHistory'),
        insuranceProvider: formValue(addPatientForm, 'insuranceProvider'),
        insurancePolicyId: formValue(addPatientForm, 'insurancePolicyId')
      };
      await api.post('/api/patients', body);
      addPatientForm.reset();
      closeModal(addPatientModal);
      await loadPatients(patientSearch?.value.trim() || '');
      showStatus('#patient-status', 'Patient saved to the clinic database.');
    } catch (error) {
      showStatus('#patient-status', error.message, true);
    } finally {
      setButtonBusy(submit, false);
    }
  });

  editPatientForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = editPatientForm.querySelector('button[type="submit"]');
    setButtonBusy(submit, true, 'Saving…');
    try {
      const id = $('#edit-patient-id').value;
      const body = {
        fullName: $('#edit-m-name').value.trim(),
        dateOfBirth: $('#edit-m-dob').value,
        contact: $('#edit-m-contact').value.trim()
      };
      if ($('#edit-m-gender')) body.gender = $('#edit-m-gender').value;
      if ($('#edit-m-address')) body.address = $('#edit-m-address').value.trim();
      if ($('#edit-m-medicalHistory')) body.medicalHistory = $('#edit-m-medicalHistory').value.trim();
      await api.patch('/api/patients/' + encodeURIComponent(id), body);
      closeModal(editPatientModal);
      await loadPatients(patientSearch?.value.trim() || '');
      showStatus('#patient-status', 'Patient record updated.');
    } catch (error) {
      showStatus('#patient-status', error.message, true);
    } finally {
      setButtonBusy(submit, false);
    }
  });

  // Invoices: fully persisted in PostgreSQL, with INR only.
  const invoiceBody = $('#invoice-table-body');
  let invoices = [];
  function renderInvoices() {
    if (!invoiceBody) return;
    invoiceBody.replaceChildren();
    let total = 0, paid = 0, pending = 0;
    invoices.forEach((invoice) => {
      const amount = Number(invoice.amount) || 0;
      total += amount;
      if (invoice.status === 'Paid') paid += amount; else pending += amount;
      const row = document.createElement('tr');
      addCell(row, invoice.invoiceNumber);
      addCell(row, invoice.patient);
      addCell(row, invoice.service);
      addCell(row, new Date(invoice.createdAt).toLocaleDateString('en-IN'));
      addCell(row, moneyINR(amount), 'p-3 text-right font-medium text-gray-700 dark:text-gray-300');
      addCell(row, invoice.status);
      const action = document.createElement('td');
      action.className = 'p-3';
      if (invoice.status !== 'Paid') {
        const paidButton = document.createElement('button');
        paidButton.type = 'button';
        paidButton.textContent = 'Mark paid';
        paidButton.className = 'text-xs px-2.5 py-1.5 rounded bg-green-100 text-green-800 hover:bg-green-200';
        paidButton.dataset.invoiceId = invoice.id;
        paidButton.dataset.invoiceAction = 'paid';
        action.appendChild(paidButton);
      } else {
        action.textContent = '—';
      }
      row.appendChild(action);
      invoiceBody.appendChild(row);
    });
    if (!invoices.length) {
      const row = document.createElement('tr');
      const cell = addCell(row, 'No invoices recorded yet.', 'p-4 text-center text-gray-500');
      cell.colSpan = 7;
      invoiceBody.appendChild(row);
    }
    if ($('#billing-total')) $('#billing-total').textContent = moneyINR(total);
    if ($('#billing-paid')) $('#billing-paid').textContent = moneyINR(paid);
    if ($('#billing-pending')) $('#billing-pending').textContent = moneyINR(pending);
  }

  async function loadInvoices() {
    if (!api.token || !invoiceBody) return;
    try {
      const data = await api.get('/api/invoices');
      invoices = data.invoices || [];
      renderInvoices();
    } catch (error) {
      showStatus('#invoice-status', error.message, true);
    }
  }

  $('#invoice-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setButtonBusy(button, true, 'Saving…');
    try {
      await api.post('/api/invoices', {
        patient: $('#invoice-patient').value.trim(),
        service: $('#invoice-service').value.trim(),
        amount: Number($('#invoice-amount').value)
      });
      form.reset();
      showStatus('#invoice-status', 'Invoice saved to the clinic database in INR.');
      await loadInvoices();
    } catch (error) {
      showStatus('#invoice-status', error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  invoiceBody?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-invoice-action="paid"]');
    if (!button) return;
    setButtonBusy(button, true, 'Updating…');
    try {
      await api.patch('/api/invoices/' + encodeURIComponent(button.dataset.invoiceId) + '/status', { status: 'Paid' });
      await loadInvoices();
    } catch (error) {
      showStatus('#invoice-status', error.message, true);
      setButtonBusy(button, false);
    }
  });

  // Appointments: database-backed request and status tracking.
  const appointmentBody = $('#appointment-table-body');
  let appointments = [];
  function renderAppointments() {
    if (!appointmentBody) return;
    appointmentBody.replaceChildren();
    if (!appointments.length) {
      const row = document.createElement('tr');
      const cell = addCell(row, 'No appointment requests recorded yet.', 'p-4 text-center text-gray-500');
      cell.colSpan = 6;
      appointmentBody.appendChild(row);
      return;
    }
    appointments.forEach((item) => {
      const row = document.createElement('tr');
      addCell(row, item.patient);
      addCell(row, item.doctor);
      addCell(row, item.department);
      addCell(row, new Date(item.scheduledAt).toLocaleString('en-IN'));
      addCell(row, item.status);
      const action = document.createElement('td');
      action.className = 'p-3';
      const nextStatus = item.status === 'Requested' ? 'Confirmed' : item.status === 'Confirmed' ? 'Completed' : null;
      if (nextStatus && ['Administrator','Doctor','Staff'].includes(window.__healthcrmUser?.role)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = nextStatus;
        button.className = 'px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs';
        button.dataset.appointmentId = item.id;
        button.dataset.appointmentStatus = nextStatus;
        action.appendChild(button);
      } else {
        action.textContent = '—';
      }
      row.appendChild(action);
      appointmentBody.appendChild(row);
    });
  }
  async function loadAppointments() {
    if (!api.token || !appointmentBody) return;
    try {
      const data = await api.get('/api/appointments');
      appointments = data.appointments || [];
      renderAppointments();
    } catch (error) {
      const row = document.createElement('tr');
      const cell = addCell(row, error.message, 'p-4 text-red-600');
      cell.colSpan = 6;
      appointmentBody.replaceChildren(row);
    }
  }
  $('#appointment-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setButtonBusy(button, true, 'Saving…');
    try {
      const localDate = $('#appointment-date').value;
      await api.post('/api/appointments', {
        patient: $('#appointment-patient').value.trim(),
        doctor: $('#appointment-doctor').value.trim(),
        department: $('#appointment-department').value.trim(),
        scheduledAt: new Date(localDate).toISOString(),
        reason: $('#appointment-reason').value.trim()
      });
      form.reset();
      showStatus('#appointment-status-message', 'Appointment request saved. Confirm the slot with reception.');
      await loadAppointments();
    } catch (error) {
      showStatus('#appointment-status-message', error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });
  appointmentBody?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-appointment-id]');
    if (!button) return;
    try {
      await api.patch('/api/appointments/' + encodeURIComponent(button.dataset.appointmentId) + '/status', {
        status: button.dataset.appointmentStatus
      });
      await loadAppointments();
    } catch (error) {
      window.alert(error.message);
    }
  });

  // Admin user creation.
  const createUserForm = $('#create-user-form');
  createUserForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setButtonBusy(button, true, 'Creating…');
    try {
      await api.post('/api/users', {
        username: $('#new-user-username').value.trim().toLowerCase(),
        name: $('#new-user-name').value.trim(),
        role: $('#new-user-role').value,
        password: $('#new-user-password').value
      });
      form.reset();
      showStatus('#create-user-status', 'Account created.');
      await window.HealthCRMAPI.get('/api/users').then((data) => renderUsers(data.users || []));
    } catch (error) {
      showStatus('#create-user-status', error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });

  function renderUsers(users) {
    const body = $('#user-table-body');
    if (!body) return;
    body.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement('tr');
      row.className = 'border-t dark:border-gray-700';
      [user.username, user.name, user.role, user.active ? 'Active' : 'Inactive'].forEach((value) => addCell(row, value));
      body.appendChild(row);
    });
  }

  // AI assistant: messages are sent to the backend; the browser never sees the API key.
  async function sendAssistantQuestion(input, messagesElement, submitButton) {
    const question = String(input?.value || '').trim();
    if (!question || !messagesElement) return;
    const userBubble = document.createElement('div');
    userBubble.className = 'flex justify-end';
    const userText = document.createElement('div');
    userText.className = 'max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap bg-blue-600 text-white';
    userText.textContent = question;
    userBubble.appendChild(userText);
    messagesElement.appendChild(userBubble);
    messagesElement.scrollTop = messagesElement.scrollHeight;
    input.value = '';
    setButtonBusy(submitButton, true, 'Thinking…');
    try {
      const data = await api.post('/api/assistant/chat', { message: question });
      const wrapper = document.createElement('div');
      wrapper.className = 'flex justify-start';
      const bubble = document.createElement('div');
      bubble.className = 'max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700';
      bubble.textContent = data.reply;
      wrapper.appendChild(bubble);
      messagesElement.appendChild(wrapper);
    } catch (error) {
      const wrapper = document.createElement('div');
      wrapper.className = 'text-sm text-red-600';
      wrapper.textContent = error.message;
      messagesElement.appendChild(wrapper);
    } finally {
      setButtonBusy(submitButton, false);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }

  const customerChat = $('#assistant-form');
  const customerInput = $('#assistant-input');
  const customerMessages = $('#assistant-messages');
  customerChat?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendAssistantQuestion(customerInput, customerMessages, customerChat.querySelector('button[type="submit"]'));
  });
  document.querySelectorAll('[data-chat-question]').forEach((button) => {
    button.addEventListener('click', () => {
      if (customerInput) customerInput.value = button.dataset.chatQuestion || '';
      sendAssistantQuestion(customerInput, customerMessages, customerChat?.querySelector('button[type="submit"]'));
    });
  });
  if (customerMessages && !customerMessages.childElementCount) {
    const intro = document.createElement('div');
    intro.className = 'text-sm text-gray-600 dark:text-gray-300';
    intro.textContent = 'Welcome to Jabalpur Clinic Support. Ask about appointments, services, billing or portal usage. Do not share patient details or medical information.';
    customerMessages.appendChild(intro);
  }

  // Public FAQ assistant available even before staff login.
  const publicToggle = $('#public-assistant-toggle');
  const publicPanel = $('#public-assistant-panel');
  const publicForm = $('#public-assistant-form');
  const publicInput = $('#public-assistant-input');
  const publicMessages = $('#public-assistant-messages');
  publicToggle?.addEventListener('click', () => publicPanel?.classList.toggle('hidden'));
  publicForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    sendAssistantQuestion(publicInput, publicMessages, publicForm.querySelector('button[type="submit"]'));
  });
  if (publicMessages) {
    const intro = document.createElement('div');
    intro.className = 'text-sm text-gray-600';
    intro.textContent = 'Hello! Ask a general question about appointments, billing or clinic portal help.';
    publicMessages.appendChild(intro);
  }

  // AI report summary: explicit de-identification and authorisation confirmation required.
  const reportInput = $('#report-input');
  const reportFile = $('#report-file');
  const reportSummary = $('#report-summary');
  const reportSummaryCard = $('#report-summary-card');
  const reportStatus = $('#report-summary-status');
  const reportConsent = $('#report-consent');
  $('#summarize-report-button')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!reportConsent?.checked) {
      showStatus('#report-summary-status', 'Confirm de-identification and clinic authorisation before submitting.', true);
      return;
    }
    const text = reportInput?.value.trim() || '';
    if (text.length < 30) {
      showStatus('#report-summary-status', 'Paste a report of at least 30 characters.', true);
      return;
    }
    setButtonBusy(button, true, 'Generating summary…');
    try {
      const data = await api.post('/api/reports/summarize', {
        report: text,
        deidentifiedAndAuthorized: true
      });
      reportSummary.textContent = data.summary + '\n\n' + data.disclaimer;
      reportSummaryCard.classList.remove('hidden');
      showStatus('#report-summary-status', 'AI draft ready. Verify it against the original report.');
    } catch (error) {
      showStatus('#report-summary-status', error.message, true);
    } finally {
      setButtonBusy(button, false);
    }
  });
  reportFile?.addEventListener('change', () => {
    const file = reportFile.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      showStatus('#report-summary-status', 'Text file too large. Maximum size is 1 MB.', true);
      reportFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (reportInput) reportInput.value = String(reader.result || ''); };
    reader.onerror = () => showStatus('#report-summary-status', 'Could not read this file.', true);
    reader.readAsText(file);
  });
  $('#clear-report-button')?.addEventListener('click', () => {
    if (reportInput) reportInput.value = '';
    if (reportFile) reportFile.value = '';
    if (reportSummary) reportSummary.textContent = '';
    if (reportSummaryCard) reportSummaryCard.classList.add('hidden');
    if (reportConsent) reportConsent.checked = false;
    showStatus('#report-summary-status', '');
  });

  function reloadBackendData() {
    if (!api.token) return;
    loadPatients(patientSearch?.value.trim() || '');
    loadInvoices();
    loadAppointments();
    if (window.__healthcrmUser?.role === 'Administrator') {
      api.get('/api/users').then((data) => renderUsers(data.users || [])).catch((error) => showStatus('#create-user-status', error.message, true));
    }
  }

  // The classic inline module owns currentUser; this event is raised after sign-in/session restore.
  window.addEventListener('healthcrm:authenticated', () => {
    const stored = sessionStorage.getItem('crmUser');
    try { window.__healthcrmUser = stored ? JSON.parse(stored) : null; } catch { window.__healthcrmUser = null; }
    reloadBackendData();
  });

  // Keep role-based action visibility in sync with the signed-in user.
  const stored = sessionStorage.getItem('crmUser');
  try { window.__healthcrmUser = stored ? JSON.parse(stored) : null; } catch { window.__healthcrmUser = null; }

  document.getElementById('sidebar-nav')?.addEventListener('click', (event) => {
    const page = event.target.closest('[data-page]')?.dataset.page;
    if (page === 'patients') loadPatients(patientSearch?.value.trim() || '');
    if (page === 'billing') loadInvoices();
    if (page === 'appointments') loadAppointments();
  });
})();
