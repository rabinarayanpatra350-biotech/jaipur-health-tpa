import { Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { tokens, api } from './lib.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Hospitals from './pages/Hospitals.jsx';
import Patients from './pages/Patients.jsx';

function Nav() {
  const nav = useNavigate();
  const signedIn = !!tokens.access;
  return (
    <header className="nav"><div className="nav-inner">
      <Link className="brand" to="/"><span className="mark">JH</span><span>Jaipur Health TPA</span></Link>
      <nav className="nav-links">
        {signedIn && <Link to="/hospitals">Hospitals</Link>}
        {signedIn && <Link to="/patients">Patients</Link>}
        {signedIn && <Link to="/dashboard">Claims dashboard</Link>}
      </nav>
      {signedIn
        ? <button className="btn" onClick={async () => { await api('/api/auth/logout', { method: 'POST', body: { refreshToken: tokens.refresh } }).catch(() => {}); tokens.access = null; tokens.refresh = null; nav('/login'); }}>Sign out</button>
        : <Link className="btn" to="/login">Sign in</Link>}
    </div></header>
  );
}
const Protected = ({ children }) => (tokens.access ? children : <Navigate to="/login" replace />);

export default function App() {
  return (<>
    <Nav />
    <main className="container">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to={tokens.access ? '/dashboard' : '/login'} replace />} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/hospitals" element={<Protected><Hospitals /></Protected>} />
        <Route path="/patients" element={<Protected><Patients /></Protected>} />
        <Route path="*" element={<p>Not found. <Link to="/">Go home</Link></p>} />
      </Routes>
    </main>
  </>);
}
