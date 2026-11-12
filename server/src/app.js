import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import config from './config/index.js';
import logger from './lib/logger.js';
import { notFoundHandler, errorHandler } from './lib/errors.js';
import apiRoutes from './routes/index.js';

/**
 * The Express app, exported as a factory and deliberately NOT calling listen().
 * That is what lets the same module run as a long-lived server locally and as a
 * request handler on a serverless host without a second entry point.
 */
export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // the SPA sets its own policy at the edge
  }));

  app.use(cors({
    origin(origin, cb) {
      if (!origin || config.cors.origins.includes(origin) || config.cors.origins.includes('*')) return cb(null, true);
      return cb(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  }));

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // A request id makes a log line and an error response refer to the same event.
  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.max,
    standardHeaders: true, legacyHeaders: false,
    skip: () => config.env === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
  }));

  // Uploaded files are served read-only from a directory the app controls.
  if (existsSync(config.uploads.dir)) app.use('/uploads', express.static(config.uploads.dir, { maxAge: '1h', index: false }));

  app.use('/api', apiRoutes);
  // The OpenAPI reference, if it has been generated into the repo.
  const docsDir = join(process.cwd(), '..', 'docs', 'openapi');
  if (existsSync(docsDir)) app.use('/api/docs', express.static(docsDir));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export default createApp;
