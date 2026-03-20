// ── Authentication Module ──

const Auth = {
  _tokenKey: 'xanic_session_token',
  _roleKey: 'xanic_user_role',
  role: 'admin',

  /**
   * Initialize auth — called on DOMContentLoaded before App.init()
   * Returns true if authenticated, false if login screen shown
   */
  async init() {
    this.bindForm();
    const token = this.getToken();

    // No token — show login immediately (no API call needed)
    if (!token) {
      this.showLoginScreen();
      return false;
    }

    // Token exists — validate server-side
    try {
      const resp = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await resp.json();

      if (data.valid) {
        this.role = data.role || localStorage.getItem(this._roleKey) || 'admin';
        localStorage.setItem(this._roleKey, this.role);
        this.hideLoginScreen();
        this.applyRole();
        return true;
      }
    } catch (_) {
      // Verify endpoint unreachable (local dev without Vercel)
      // Restore cached role if available
      this.role = localStorage.getItem(this._roleKey) || 'admin';
    }

    // Token invalid or expired
    localStorage.removeItem(this._tokenKey);
    this.showLoginScreen();
    return false;
  },

  showLoginScreen() {
    const login = document.getElementById('login-screen');
    const dashboard = document.getElementById('dashboard-content');
    const loader = document.getElementById('data-loader');

    if (login) login.style.display = 'flex';
    if (dashboard) dashboard.style.display = 'none';
    if (loader) loader.classList.remove('active');
  },

  hideLoginScreen() {
    const login = document.getElementById('login-screen');
    if (login) login.style.display = 'none';
  },

  async login(username, password) {
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (errorEl) errorEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }

    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await resp.json();

      if (data.ok && data.token) {
        localStorage.setItem(this._tokenKey, data.token);
        // Decode role from token payload
        try {
          const payload = JSON.parse(atob(data.token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));
          this.role = payload.role || 'admin';
        } catch (_) { this.role = 'admin'; }
        localStorage.setItem(this._roleKey, this.role);
        this.hideLoginScreen();
        this.applyRole();
        App.init();
        return;
      }

      // Show error
      if (errorEl) errorEl.textContent = data.error || 'Credenciales incorrectas';
    } catch (err) {
      if (errorEl) errorEl.textContent = 'Error de conexión. Intente de nuevo.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }
    }
  },

  logout() {
    localStorage.removeItem(this._tokenKey);
    localStorage.removeItem(this._roleKey);
    this.role = 'admin';
    DataStore.clearCache();
    App.initialized = false;
    const dashboard = document.getElementById('dashboard-content');
    if (dashboard) dashboard.style.display = 'none';
    this.showLoginScreen();
    // Clear login form
    const form = document.getElementById('login-form');
    if (form) form.reset();
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = '';
  },

  getToken() {
    return localStorage.getItem(this._tokenKey);
  },

  handleSubmit(event) {
    if (event) event.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    if (username && password) this.login(username, password);
  },

  canUpload() {
    return this.role === 'lab';
  },

  applyRole() {
    const uploadSection = document.getElementById('db-upload-section');
    if (uploadSection) uploadSection.style.display = this.canUpload() ? '' : 'none';
  },

  bindForm() {
    const form = document.getElementById('login-form');
    const btn = document.getElementById('login-btn');
    if (form) form.addEventListener('submit', (e) => Auth.handleSubmit(e));
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); Auth.handleSubmit(); });
  }
};
