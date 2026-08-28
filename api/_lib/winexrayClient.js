// api/_lib/winexrayClient.js
// Server-side adapter for the WineXRay client-center app (client.winexray.com).
//
// This module NEVER runs in the browser. It holds the winery's WineXRay login
// and its session cookie, and neither value is ever returned to a caller, put
// in a response body, or written to a log line. Errors raised here carry a
// Spanish, user-safe message and deliberately omit the URL query string, which
// carries the export GUID.
//
// Transport rules, forced by the recon in docs/External-APIs.md:
//   * https only, and only to client.winexray.com. The _ncfa session cookie is
//     set WITHOUT the Secure flag, so nothing at the cookie layer stops a
//     cleartext send. We supply that guarantee here instead.
//   * redirect: 'manual' on every request, not just login. Most clients follow
//     a 303 by default, which turns an expired session into a 200 carrying the
//     login page's HTML — that then feeds into a JSON or CSV parser and fails
//     far from the real cause, or parses as an empty result set.
//   * The login 303 must be read, not followed: following it to /client-center
//     discards the Set-Cookie header we need.
//   * dateStart/dateEnd are date-only YYYY-MM-DD. An ISO value carrying a time
//     or a Z suffix trips a server-side HTTP 500.

const ORIGIN = 'https://client.winexray.com';
const HOST = 'client.winexray.com';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Error carrying a Spanish message safe to show the user. */
export class WineXRayError extends Error {
  constructor(message, { code = 'winexray_error', status = 502 } = {}) {
    super(message);
    this.name = 'WineXRayError';
    this.code = code;
    this.status = status;
  }
}

const AUTH_FAILED = () => new WineXRayError(
  'La sesión de WineXRay expiró o las credenciales no son válidas.',
  { code: 'winexray_auth', status: 502 }
);

// Only ever attach the session to the exact host it was issued for. A redirect
// that changes scheme or origin is refused rather than followed.
function assertSameOrigin(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.host !== HOST) {
    throw new WineXRayError('Destino de WineXRay no permitido.', { code: 'winexray_origin', status: 502 });
  }
  return u;
}

// A 303 to /login on a data request is the documented signal for an absent or
// expired session. Any text/html where JSON or CSV was expected is the same
// thing wearing a 200.
function assertNotLoginRedirect(res) {
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    throw AUTH_FAILED();
  }
}

function assertContentType(res, expected) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) throw AUTH_FAILED();
  if (expected && !ct.includes(expected)) {
    throw new WineXRayError('WineXRay devolvió una respuesta inesperada.', { code: 'winexray_content_type', status: 502 });
  }
}

export class WineXRayClient {
  constructor({ username, password, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    if (!username || !password) {
      throw new WineXRayError(
        'Faltan las credenciales de WineXRay en la configuración del servidor.',
        { code: 'winexray_config', status: 500 }
      );
    }
    this._username = username;
    this._password = password;
    this._fetch = fetchImpl;
    this._timeoutMs = timeoutMs;
    this._cookie = null; // in-memory for the life of the run only
  }

  async _request(path, { method = 'GET', body, headers = {}, expect, as = 'none' } = {}) {
    const url = assertSameOrigin(ORIGIN + path);
    const h = { Accept: '*/*', ...headers };
    // Hand-built Cookie header: there is no cookie jar server-side, and the
    // recon's "the browser attaches it automatically" does not hold here.
    if (this._cookie) h.Cookie = this._cookie;

    // A stalled upstream must fail cleanly rather than hang the function. The
    // timer has to stay armed through BODY consumption, not just until headers
    // arrive: a server that sends headers promptly and then stalls mid-body
    // would otherwise hang the invocation until the platform kills it.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this._timeoutMs);
    try {
      let res;
      try {
        res = await this._fetch(url.toString(), {
          method, body, headers: h, redirect: 'manual', signal: ac.signal,
        });
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new WineXRayError('WineXRay no respondió a tiempo.', { code: 'winexray_timeout', status: 504 });
        }
        // Deliberately does not interpolate err.message: it can contain the URL.
        throw new WineXRayError('No se pudo conectar con WineXRay.', { code: 'winexray_network', status: 502 });
      }

      if (expect === 'login') return { res, data: null };

      assertNotLoginRedirect(res);
      if (!res.ok) {
        throw new WineXRayError(`WineXRay respondió con un error (${res.status}).`, { code: 'winexray_http', status: 502 });
      }
      assertContentType(res, expect);

      let data;
      try {
        if (as === 'json') data = await res.json();
        else if (as === 'text') data = await res.text();
        else if (as === 'arrayBuffer') data = await res.arrayBuffer();
        else data = null;
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new WineXRayError('WineXRay no respondió a tiempo.', { code: 'winexray_timeout', status: 504 });
        }
        throw new WineXRayError('WineXRay devolvió una respuesta ilegible.', { code: 'winexray_body', status: 502 });
      }
      return { res, data };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exchange the login for the _ncfa session cookie. Reads the 303, never follows it. */
  async login() {
    const form = new URLSearchParams({ username: this._username, password: this._password });
    const { res } = await this._request('/login?returnUrl=/client-center', {
      method: 'POST',
      body: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      expect: 'login',
    });

    const cookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

    // Take only _ncfa, and only its name=value pair — never the attributes.
    for (const c of cookies) {
      const pair = String(c).split(';')[0];
      if (pair.startsWith('_ncfa=') && pair.length > '_ncfa='.length) {
        this._cookie = pair;
        return true;
      }
    }
    throw AUTH_FAILED();
  }

  /**
   * Date-bounded sample list, paginated to exhaustion.
   *
   * `from`/`to` must be YYYY-MM-DD — an ISO timestamp makes the server 500.
   *
   * Pagination is not optional. A single page silently truncates a busy window
   * and the caller still reports success, which is the worst failure shape on
   * this surface: samples missing with a green result. We page until the
   * server's own `count` is reached or a short page comes back.
   *
   * seasonStart/seasonEnd must SPAN the requested window. Deriving them from
   * `from` alone truncated any range crossing a year boundary.
   */
  async listResults({ from, to, pageLimit = 500, maxPages = 50 }) {
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
      throw new WineXRayError('Rango de fechas inválido para WineXRay.', { code: 'winexray_date', status: 400 });
    }
    const seasonStart = `${from.slice(0, 4)}-01-01`;
    const seasonEnd = `${to.slice(0, 4)}-12-31`;

    const all = [];
    const seen = new Set();
    let expected = null;

    for (let page = 0; page < maxPages; page++) {
      const { data: json } = await this._request('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        expect: 'application/json', as: 'json',
        body: JSON.stringify({
          orderBy: 'sampleDate', reverse: true, currentPage: page, pageLimit,
          search: '', searchField: 'assayId', searchFieldMatchType: 'Like',
          dateStart: from, dateEnd: to, dateSearchField: 'sampleDate',
          seasonStart, seasonEnd,
          loadMaxBatchId: true,
        }),
      });
      const batch = Array.isArray(json?.results) ? json.results : [];
      if (expected === null && Number.isFinite(json?.count)) expected = json.count;

      for (const r of batch) {
        // Dedupe defensively: paging a list ordered by a non-unique key can
        // repeat a row across page boundaries.
        const id = r?.id;
        if (id === undefined || id === null || seen.has(id)) continue;
        seen.add(id);
        all.push(r);
      }

      // Terminate on the server's own count, or on a genuinely EMPTY page.
      // A merely SHORT page is not proof of the end: the list is ordered by a
      // non-unique key, so rows can repeat across page boundaries and dedupe
      // can leave a page short while results remain. Breaking on a short page
      // silently dropped the tail and still reported success.
      if (expected !== null && all.length >= expected) break;
      if (batch.length === 0) break;

      if (page === maxPages - 1) {
        throw new WineXRayError(
          'El rango solicitado devuelve demasiadas muestras. Sincroniza un periodo más corto.',
          { code: 'winexray_too_many', status: 400 }
        );
      }
    }

    // Never hand back a partial set as a success. If the server said how many
    // there are and we have fewer, that is an inconsistency, not a result.
    if (expected !== null && all.length < expected) {
      throw new WineXRayError(
        'WineXRay devolvió menos muestras de las que reporta. Intenta de nuevo.',
        { code: 'winexray_incomplete', status: 502 }
      );
    }
    return all;
  }

  /** Turn sample ids into an export GUID. */
  async createExport(ids) {
    if (!ids.length) throw new WineXRayError('No hay muestras para exportar.', { code: 'winexray_empty', status: 400 });
    const { data: raw } = await this._request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      expect: 'text/plain', as: 'text',
      body: JSON.stringify({
        keys: ids.map(id => ({ id, expand: false })),
        orderBy: 'sampleDate', reverse: true,
      }),
    });
    const guid = String(raw || '').trim();
    if (!/^[0-9a-fA-F-]{32,40}$/.test(guid)) {
      throw new WineXRayError('WineXRay no devolvió un identificador de exportación válido.', { code: 'winexray_guid', status: 502 });
    }
    return guid;
  }

  /**
   * Download the export CSV as bytes. Returned as an ArrayBuffer so the
   * existing parser owns decoding (it honours a UTF-16 BOM and falls back to
   * Windows-1252 — decoding here as UTF-8 would mangle "Peña").
   */
  async downloadCsv(guid) {
    const { data } = await this._request(`/api/export/result.csv?guid=${encodeURIComponent(guid)}`, {
      expect: 'text/csv', as: 'arrayBuffer',
    });
    return data;
  }

  /** login -> results -> export -> csv, in one call. */
  async fetchExportCsv({ from, to }) {
    await this.login();
    const results = await this.listResults({ from, to });
    if (!results.length) return { buffer: null, sampleCount: 0 };
    const ids = results.map(r => r?.id).filter(id => id !== undefined && id !== null);
    const guid = await this.createExport(ids);
    const buffer = await this.downloadCsv(guid);
    return { buffer, sampleCount: ids.length };
  }
}
