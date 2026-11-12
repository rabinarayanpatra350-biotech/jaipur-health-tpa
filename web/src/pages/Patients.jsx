import { useEffect, useState } from 'react';
import { api } from '../lib.js';

export default function Patients() {
  const [rows, setRows] = useState([]); const [meta, setMeta] = useState(null);
  const [q, setQ] = useState(''); const [error, setError] = useState(null);
  useEffect(() => {
    api(`/api/patients?pageSize=25&q=${encodeURIComponent(q)}`)
      .then(d => setRows(d)).catch(e => setError(e.message));
  }, [q]);
  return (<>
    <div className="shead"><h1>Patients</h1>
      <input placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 280 }} /></div>
    {error && <div className="alert err">{error}</div>}
    <section className="card"><table className="table">
      <thead><tr><th>MRN</th><th>Name</th><th>Date of birth</th><th>Gender</th>
        <th className="num">Appointments</th><th className="num">Admissions</th></tr></thead>
      <tbody>{rows.map(p => (<tr key={p.id}>
        <td><code>{p.mrn}</code></td><td>{p.fullName}</td><td>{p.dateOfBirth || '—'}</td>
        <td>{p.gender || '—'}</td><td className="num">{p.appointments}</td>
        <td className="num">{p.admissions}</td></tr>))}</tbody></table>
    </section>
  </>);
}
