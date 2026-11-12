import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokens } from '../lib.js';

/** Client-side validation mirrors the server's zod schema: same rules, run twice. */
const check = (email, password) => {
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address';
  if (password.length < 10) return 'Password must be at least 10 characters';
  return null;
};

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    const bad = check(email, password);
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null);
    try {
      const d = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      tokens.access = d.accessToken; tokens.refresh = d.refreshToken;
      nav('/dashboard');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <section className="card narrow">
      <h1>Staff sign in</h1>
      <p className="muted">Clinicians and administrators only.</p>
      <form className="stack" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <div className="alert err">{error}</div>}
        <button className="btn btn-p" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  );
}
