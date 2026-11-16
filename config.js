// The Render Blueprint creates the API service named "healthcrm-api".
// If Render assigns a different hostname, replace the value below with the
// exact URL shown in the Render dashboard (without a trailing slash).
(() => {
  const host = window.location.hostname;
  const runningOnRender = host.endsWith('.onrender.com');
  window.HEALTHCRM_CONFIG = {
    API_BASE_URL: runningOnRender ? '' : (window.HEALTHCRM_API_URL || 'https://healthcrm-api.onrender.com')
  };
})();
