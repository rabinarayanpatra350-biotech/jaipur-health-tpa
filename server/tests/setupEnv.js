import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Must run before any module imports config, which reads the environment once.
process.env.DATABASE_URL = readFileSync(join(process.cwd(), '.test-db-url'), 'utf8').trim();
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MAIL_TRANSPORT = 'record';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
process.env.CORS_ORIGINS = 'http://localhost:5173';
