import pino from 'pino';
import config from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    // Patient data and secrets must never reach a log line.
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      'password', '*.password', 'passwordHash', '*.passwordHash', 'refreshToken', '*.refreshToken',
      'patient_name', '*.patient_name', 'diagnosis_text', '*.diagnosis_text'],
    censor: '[redacted]',
  },
  transport: config.isProd ? undefined : { target: 'pino/file', options: { destination: 1 } },
});

export default logger;
