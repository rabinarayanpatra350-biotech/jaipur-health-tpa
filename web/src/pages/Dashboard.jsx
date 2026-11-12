import { useEffect, useState } from 'react';
import { api, inr, pct } from '../lib.js';

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

export default function Dashboard() {
  const [from, setFrom] = useState(daysAgo(365));
  const [to, setTo] = useState(iso(new Date()));
  const [m, setM] = useState(null); const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api(`/api/metrics?from=${from}&to=${to}`)
      .then(d => { if (alive) { setM(d); setError(null); } })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [from, to]);

  if (error) return <div className="alert err">{error}</div>;
  if (!m) return <p className="muted">Calculating…</p>;
  const p = m.portfolio;

  return (<>
    <div className="shead"><h1>Claims dashboard</h1>
      <div className="row">
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
    </div>
    <div className="kpis">
      <div className="kpi"><span className="kpi-l">Average length of stay</span>
        <span className="kpi-v">{p.avgLengthOfStayDays} d</span>
        <span className="kpi-s">{inr(p.discharges)} discharges</span></div>
      <div className="kpi"><span className="kpi-l">Bed occupancy</span>
        <span className="kpi-v">{pct(p.bedOccupancyRate)}</span>
        <span className="kpi-s">{inr(p.occupiedBedDays)} of {inr(p.availableBedDays)} bed-days</span></div>
      <div className="kpi"><span className="kpi-l">30-day readmission</span>
        <span className="kpi-v">{pct(p.readmissionRate30d)}</span>
        <span className="kpi-s">{p.readmitted30d} of {inr(p.discharges)} discharges</span></div>
      <div className="kpi"><span className="kpi-l">Currently admitted</span>
        <span className="kpi-v">{inr(m.supporting.currently_admitted)}</span>
        <span className="kpi-s">{inr(m.supporting.opd_visits)} OPD visits in window</span></div>
    </div>
    <section className="card"><h2>By hospital</h2>
      <table className="table"><thead><tr><th>Hospital</th><th className="num">Beds</th><th className="num">Discharges</th>
        <th className="num">ALOS</th><th className="num">Occupancy</th><th className="num">Readmission</th></tr></thead>
      <tbody>{m.hospitals.map(h => (<tr key={h.hospitalId}>
        <td>{h.hospitalName} <span className="muted small">{h.hospitalCode}</span></td>
        <td className="num">{h.licensedBeds}</td><td className="num">{inr(h.discharges)}</td>
        <td className="num">{h.avgLengthOfStayDays} d</td>
        <td className="num">{pct(h.bedOccupancyRate)}</td>
        <td className="num">{pct(h.readmissionRate30d)}</td></tr>))}</tbody></table>
    </section>
    <p className="muted small">{m.supporting.uncoded_visits} visits in this window have no coded diagnosis.</p>
  </>);
}
