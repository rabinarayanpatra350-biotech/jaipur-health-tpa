import 'dotenv/config';

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes)$/i.test(String(v)));
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const config = {
  env, isProd,
  port: int(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hospital',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || (isProd ? '' : 'dev-access-secret-change-me'),
    refreshSecret: process.env.JWT_REFRESH_SECRET || (isProd ? '' : 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: int(process.env.JWT_REFRESH_TTL_DAYS, 30),
    issuer: 'hospital-platform',
  },
  cors: { origins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean) },
  uploads: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxBytes: int(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
    publicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL || '',
  },
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 20),
  },
  logLevel: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  mail: {
    transport: process.env.MAIL_TRANSPORT || (isProd ? 'smtp' : 'console'),
    from: process.env.MAIL_FROM || 'Jaipur Health TPA <no-reply@example.com>',
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    clinicInbox: process.env.CLINIC_NOTIFICATION_EMAIL || 'opd@example.com',
  },
  jobs: {
    pollIntervalMs: int(process.env.JOB_POLL_INTERVAL_MS, 1000),
    visibilityTimeoutMs: int(process.env.JOB_VISIBILITY_TIMEOUT_MS, 5 * 60 * 1000),
  },
  // Reporting window used by the dashboard when no dates are given.
  reporting: { defaultDays: int(process.env.REPORTING_DAYS, 90) },
};

const problems = [];
if (isProd) {
  if (!config.jwt.accessSecret || config.jwt.accessSecret.length < 32) problems.push('JWT_ACCESS_SECRET must be at least 32 characters in production');
  if (!config.jwt.refreshSecret || config.jwt.refreshSecret.length < 32) problems.push('JWT_REFRESH_SECRET must be at least 32 characters in production');
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is required in production');
  if (config.cors.origins.includes('*')) problems.push('CORS_ORIGINS must not be "*" in production');
  if (config.mail.transport === 'smtp' && !config.mail.host) problems.push('SMTP_HOST is required when MAIL_TRANSPORT is smtp');
}
if (problems.length) throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);

export default Object.freeze(config);
