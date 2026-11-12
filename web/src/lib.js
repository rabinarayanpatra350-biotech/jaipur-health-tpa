/** One fetch wrapper: attaches the token, unwraps { data }, and retries once on a
 *  401 after refreshing — single-flight, so ten parallel 401s cause one refresh. */
const BASE = import.meta.env.VITE_API_URL || '';
const store = {
  get access() { return localStorage.getItem('accessToken'); },
  set access(v) { v ? localStorage.setItem('accessToken', v) : localStorage.removeItem('accessToken'); },
  get refresh() { return localStorage.getItem('refreshToken'); },
  set refresh(v) { v ? localStorage.setItem('refreshToken', v) : localStorage.removeItem('refreshToken'); },
};
export const tokens = store;

let inflight = null;
async function refreshOnce() {
  if (!inflight) {
    inflight = (async () => {
      const rt = store.refresh;
      if (!rt) throw new Error('No session');
      const r = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }),
      });
      if (!r.ok) { store.access = null; store.refresh = null; throw new Error('Session expired'); }
      const { data } = await r.json();
      store.access = data.accessToken; store.refresh = data.refreshToken;
      return data.accessToken;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

export async function api(path, { method = 'GET', body, retry = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (store.access) headers.authorization = `Bearer ${store.access}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry && store.refresh) {
    try { await refreshOnce(); } catch { /* fall through to the error below */ }
    return api(path, { method, body, retry: false });
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Request failed (${res.status})`), { status: res.status, code: json?.error?.code });
  return json?.data ?? json;
}
export const inr = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(n) || 0);
export const pct = (n) => `${(Number(n) * 100).toFixed(1)}%`;
