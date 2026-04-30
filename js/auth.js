// ── Authentication Module ──
import { DataStore } from './dataLoader.js';
import { App } from './app.js';

export const Auth = {
  _tokenKey: 'xanic_session_token',
  _roleKey: 'xanic_user_role',
  role: 'viewer',

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
        this.role = data.role || localStorage.getItem(this._roleKey) || 'viewer';
        localStorage.setItem(this._roleKey, this.role);
        this.hideLoginScreen();
        this.applyRole();
        return true;
      }
    } catch (_) {
      // Verify endpoint unreachable (local dev without Vercel)
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        this.role = localStorage.getItem(this._roleKey) || 'admin';
        this.hideLoginScreen();
        this.applyRole();
        return true;
      }
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
          this.role = payload.role || 'viewer';
        } catch (_) { this.role = 'viewer'; }
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
    // Revoke token server-side before clearing locally
    const token = localStorage.getItem(this._tokenKey);
    if (token) {
      fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      }).catch(() => {});
    }
    localStorage.removeItem(this._tokenKey);
    localStorage.removeItem(this._roleKey);
    this.role = 'viewer';
    this._applyRoleClasses();
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

  canWrite()  { return this.role === 'lab'; },
  canExport() { return this.role === 'lab' || this.role === 'admin'; },

  _applyRoleClasses() {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('can-write',  this.canWrite());
    document.body.classList.toggle('can-export', this.canExport());
  },

  applyRole() {
    const uploadSection = document.getElementById('db-upload-section');
    if (uploadSection) uploadSection.style.display = this.canUpload() ? '' : 'none';
    // Schema-drift banner: only meaningful for lab users who manage migrations.
    if (this.role === 'lab') this.checkMigrationsDrift();
    this._applyRoleClasses();
  },

  // Fire-and-forget. Renders a banner only when the deployed code's
  // expected migrations don't all appear in public.applied_migrations.
  // Closes the recurring failure mode where uploads error out with
  // "Could not find the 'X' column ... in the schema cache" because a
  // migration committed to the repo was never run on Supabase (Round 36).
  async checkMigrationsDrift() {
    const banner = document.getElementById('migrations-banner');
    if (!banner) return;
    try {
      const token = this.getToken();
      if (!token) return;
      const resp = await fetch('/api/migrations-status', {
        headers: { 'x-session-token': token },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.ok) return;

      if (data.bootstrapped === false) {
        banner.innerHTML =
          '<strong>Falta inicializar el registro de migraciones.</strong> ' +
          'Ejecuta <code>sql/migration_applied_log.sql</code> en Supabase ' +
          'para activar el monitor de migraciones, y revisa que el resto de migraciones estén aplicadas.';
        banner.style.display = '';
        return;
      }

      if (data.missing && data.missing.length) {
        const list = data.missing
          .map(m => `<code>sql/${this._esc(m)}.sql</code>`)
          .join(', ');
        const noun = data.missing.length === 1 ? 'migración pendiente' : 'migraciones pendientes';
        banner.innerHTML =
          `<strong>${data.missing.length} ${noun}.</strong> ` +
          `Ejecuta en Supabase SQL Editor: ${list}. ` +
          `Las cargas que dependan de columnas nuevas fallarán hasta que se apliquen.`;
        banner.style.display = '';
        return;
      }

      banner.style.display = 'none';
    } catch (_) {
      // Endpoint unreachable (local dev without Vercel) — silent.
    }
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  },

  _formBound: false,
  bindForm() {
    if (this._formBound) return;
    this._formBound = true;
    const form = document.getElementById('login-form');
    if (form) form.addEventListener('submit', (e) => Auth.handleSubmit(e));
  }
};
