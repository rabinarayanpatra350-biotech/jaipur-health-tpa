/**
 * Email bodies as plain functions. Every interpolated value is escaped: a patient's
 * name is user input, and an email body is exactly where an unescaped name becomes
 * HTML injection.
 *
 * Note what these deliberately do NOT contain: no diagnosis, no test result, no
 * medication. A notification that says "you have an appointment" is safe to send
 * over unencrypted mail; one that says "your HIV test result is ready" is not.
 */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const wrap = (title, body) => `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17202a;line-height:1.55">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="border-bottom:3px solid #0f5132;padding-bottom:12px;margin-bottom:20px">
<strong style="font-size:18px;color:#0f5132">Jaipur Health TPA</strong></div>
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1>${body}
<p style="margin-top:28px;font-size:12px;color:#6b7a88">This is a portfolio project. No real clinical data is involved.</p>
</div></body></html>`;

export function appointmentConfirmed(a) {
  const subject = `Appointment confirmed — ${a.reference}`;
  const text = [
    `Dear ${a.patientName},`, '',
    'Your appointment has been confirmed.', '',
    `Reference:  ${a.reference}`,
    `Hospital:   ${a.hospitalName}`,
    `Department: ${a.departmentName || 'General'}`,
    `Doctor:     ${a.doctorName || 'To be assigned'}`,
    `When:       ${a.scheduledAt}`, '',
    'Please arrive 15 minutes early and bring a photo ID.', '',
    'Jaipur Health TPA',
  ].join('\n');
  const html = wrap('Appointment confirmed', `
    <p>Dear ${esc(a.patientName)},</p><p>Your appointment has been confirmed.</p>
    <table style="border-collapse:collapse;margin:16px 0">
    ${[['Reference', esc(a.reference)], ['Hospital', esc(a.hospitalName)],
      ['Department', esc(a.departmentName || 'General')], ['Doctor', esc(a.doctorName || 'To be assigned')],
      ['When', esc(a.scheduledAt)]].map(([k, v]) =>
      `<tr><td style="padding:4px 16px 4px 0;color:#6b7a88">${k}</td><td><strong>${v}</strong></td></tr>`).join('')}
    </table>
    <p>Please arrive 15 minutes early and bring a photo ID.</p>`);
  return { subject, text, html };
}

export function clinicAlert(a) {
  const subject = `New appointment — ${a.hospitalName} (${a.reference})`;
  const text = [
    'A new appointment has been booked.', '',
    `Reference: ${a.reference}`, `Hospital:  ${a.hospitalName}`,
    `Patient:   ${a.patientName}`, `When:      ${a.scheduledAt}`,
  ].join('\n');
  const html = wrap('New appointment booked', `
    <p><strong>${esc(a.hospitalName)}</strong> — ${esc(a.reference)}</p>
    <p>${esc(a.patientName)}<br>${esc(a.scheduledAt)}</p>`);
  return { subject, text, html };
}

export function prescriptionIssued(p) {
  const subject = `Your prescription — ${p.reference}`;
  const lines = p.items.map(i => `  • ${i.drug}${i.dose ? ' ' + i.dose : ''}${i.frequency ? ', ' + i.frequency : ''}${i.durationDays ? ' for ' + i.durationDays + ' days' : ''}`);
  const text = [`Dear ${p.patientName},`, '', 'A prescription has been issued for you.', '',
    `Reference: ${p.reference}`, '', ...lines, '',
    p.instructions ? `Instructions: ${p.instructions}` : '',
    '', 'Jaipur Health TPA'].filter(Boolean).join('\n');
  const html = wrap('Your prescription', `
    <p>Dear ${esc(p.patientName)},</p>
    <p>Reference <strong>${esc(p.reference)}</strong></p>
    <ul>${p.items.map(i => `<li>${esc(i.drug)}${i.dose ? ' ' + esc(i.dose) : ''}${i.frequency ? ', ' + esc(i.frequency) : ''}${i.durationDays ? ' for ' + esc(i.durationDays) + ' days' : ''}</li>`).join('')}</ul>
    ${p.instructions ? `<p>${esc(p.instructions)}</p>` : ''}`);
  return { subject, text, html };
}
