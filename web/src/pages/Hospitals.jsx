import { useEffect, useState } from 'react';
import { api, inr } from '../lib.js';

export default function Hospitals() {
  const [rows, setRows] = useState([]); const [q, setQ] = useState('');
  useEffect(() => { api(`/api/hospitals?pageSize=50&q=${encodeURIComponent(q)}`).then(d => setRows(d)).catch(() => {}); }, [q]);
  return (<>
    <div className="shead"><h1>Hospitals</h1>
      <input placeholder="Search by name or code" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 280 }} /></div>
    <div className="grid">{rows.map(h => (
      <article className="card" key={h.id}>
        <span className="badge">{h.code}</span>
        <h3>{h.name}</h3>
        <p className="muted small">{h.city} · {inr(h.beds)} licensed beds</p>
      </article>))}</div>
  </>);
}
