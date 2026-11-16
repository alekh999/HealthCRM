(() => {
  const configured = window.HEALTHCRM_CONFIG?.API_BASE_URL;
  const apiBase = typeof configured === 'string' ? configured.replace(/\/$/, '') : '';
  const tokenKey = 'healthcrmApiToken';

  function getToken() {
    return sessionStorage.getItem(tokenKey) || '';
  }

  function setToken(token) {
    if (token) sessionStorage.setItem(tokenKey, token);
    else sessionStorage.removeItem(tokenKey);
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);

    let response;
    try {
      response = await fetch(apiBase + path, {
        ...options,
        headers,
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (error) {
      throw new Error('Cannot reach the clinic API. Check that the backend is deployed and its URL is configured.');
    }

    let data = {};
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => ({}));
    }
    if (response.status === 401 && path !== '/api/auth/login') {
      setToken('');
      sessionStorage.removeItem('crmUser');
    }
    if (!response.ok) {
      throw new Error(data.error || ('API request failed (' + response.status + ').'));
    }
    if (path === '/api/auth/change-password' && data.token) setToken(data.token);
    return data;
  }

  async function login(username, password) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setToken(data.token);
    sessionStorage.setItem('crmUser', JSON.stringify(data.user));
    return data.user;
  }

  async function logout() {
    setToken('');
    sessionStorage.removeItem('crmUser');
  }

  async function currentUser() {
    if (!getToken()) return null;
    const data = await request('/api/auth/me');
    sessionStorage.setItem('crmUser', JSON.stringify(data.user));
    return data.user;
  }

  async function get(path) { return request(path); }
  async function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }
  async function patch(path, body) {
    return request(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
  }
  async function remove(path) { return request(path, { method: 'DELETE' }); }

  window.HealthCRMAPI = Object.freeze({
    request, login, logout, currentUser, get, post, patch, remove,
    get token() { return getToken(); }
  });
})();
