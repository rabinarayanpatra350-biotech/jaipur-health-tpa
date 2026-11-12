import { sendMail } from '../lib/mailer.js';
import { appointmentConfirmed, clinicAlert, prescriptionIssued } from '../lib/emailTemplates.js';

/** The job registry. An unknown type fails loudly rather than being skipped. */
export const handlers = {
  async send_email(payload, job) {
    if (!payload.to || !payload.subject) throw new Error('send_email requires "to" and "subject"');
    return sendMail({ ...payload, jobId: job.id });
  },
  async appointment_confirmation(payload) {
    const { subject, text, html } = appointmentConfirmed(payload.appointment);
    const r = await sendMail({ to: payload.to, subject, text, html, template: 'appointment_confirmation' });
    return { to: payload.to, providerId: r.providerId };
  },
  async clinic_alert(payload) {
    const { subject, text, html } = clinicAlert(payload.appointment);
    const r = await sendMail({ to: payload.to, subject, text, html, template: 'clinic_alert' });
    return { to: payload.to, providerId: r.providerId };
  },
  async prescription_issued(payload) {
    const { subject, text, html } = prescriptionIssued(payload.prescription);
    const r = await sendMail({ to: payload.to, subject, text, html, template: 'prescription_issued' });
    return { to: payload.to, providerId: r.providerId };
  },
  /**
   * Stands in for genuinely slow work the queue exists to absorb — a nightly
   * readmission recompute, a claims batch export. Registered so the queue is
   * exercised by something other than email: it is a general queue that happens
   * to carry email, not an email queue.
   */
  async nightly_readmission_recompute(payload) {
    return { recomputed: true, window: payload };
  },
};

export function getHandler(type) {
  const fn = handlers[type];
  if (!fn) throw new Error(`No handler registered for job type "${type}"`);
  return fn;
}
