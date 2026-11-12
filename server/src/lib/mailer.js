import { query } from '../db/pool.js';
import logger from './logger.js';
import config from '../config/index.js';

let smtp = null;
async function smtpTransport() {
  if (smtp) return smtp;
  const nodemailer = (await import('nodemailer')).default;
  smtp = nodemailer.createTransport({
    host: config.mail.host, port: config.mail.port, secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
  });
  return smtp;
}

/**
 * Email delivery with three transports: console (development), record (tests) and
 * smtp (production). Chosen by configuration, never by a code change, and every
 * attempt is written to `email_log` — so "we told this patient" is a queryable
 * fact rather than an assumption.
 */
export const transportName = () => config.mail.transport;

export async function sendMail({ to, subject, text, html, template = 'generic', jobId = null }) {
  const transport = transportName();
  let providerId = null; let error = null;
  try {
    if (transport === 'smtp') {
      const tx = await smtpTransport();
      const info = await tx.sendMail({ from: config.mail.from, to, subject, text, html });
      providerId = info.messageId || null;
    } else if (transport === 'console') {
      logger.info({ to, subject, template }, 'email (console transport)');
      // eslint-disable-next-line no-console
      console.log(`\n─── email to ${to} ───\nSubject: ${subject}\n\n${text}\n──────────────────────\n`);
    }
  } catch (e) { error = e; }

  await query(
    `INSERT INTO email_log (job_id, to_address, subject, template, status, provider, provider_id, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [jobId, to, subject, template, error ? 'failed' : 'sent', transport, providerId,
      error ? String(error.message).slice(0, 500) : null],
  );
  if (error) throw error;
  return { providerId, transport };
}
