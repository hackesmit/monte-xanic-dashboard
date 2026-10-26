// api/_lib/syncLease.js
// A Postgres lease shared by every Vercel instance (sql/migration_sync_lease.sql,
// xd-wh7). The in-memory in-flight guard in api/winexray-sync.js only collapses
// requests on ONE warm instance; this is what stops a second instance from
// starting its own WineXRay fetch.
//
// Both calls go through PostgREST RPC with the service key. Any answer that is
// not a literal true or false is an error: a lease that might or might not be
// held must never be read as "held by us".

const LEASE_TIMEOUT_MS = 10000;

/** The lease service could not give a definite answer. */
export class LeaseError extends Error {
  constructor(message) { super(message); this.name = 'LeaseError'; }
}

/**
 * @returns {{ acquire(name:string, owner:string, ttlSeconds:number): Promise<boolean>,
 *             release(name:string, owner:string): Promise<boolean> }}
 */
export function postgresLease({ supabaseUrl, serviceKey, fetchImpl = fetch } = {}) {
  async function rpc(fn, args) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LEASE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: ac.signal,
      });
      if (!res.ok) throw new LeaseError(`${fn} answered ${res.status}`);
      const value = await res.json();
      if (value !== true && value !== false) throw new LeaseError(`${fn} answered a non-boolean`);
      return value;
    } catch (err) {
      if (err instanceof LeaseError) throw err;
      throw new LeaseError(`${fn} failed: ${err?.name === 'AbortError' ? 'timeout' : err?.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    acquire: (name, owner, ttlSeconds) =>
      rpc('sync_lease_acquire', { p_name: name, p_owner: owner, p_ttl_seconds: ttlSeconds }),
    release: (name, owner) =>
      rpc('sync_lease_release', { p_name: name, p_owner: owner }),
  };
}
