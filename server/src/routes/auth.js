import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validateBody } from '../lib/validate.js';
import { asyncHandler } from '../lib/errors.js';
import { signupSchema, loginSchema, refreshSchema, roleSchema, staffUserSchema } from '../schemas.js';
import * as auth from '../services/authService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import config from '../config/index.js';

const router = Router();
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax,
  standardHeaders: true, legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, please wait and try again' } },
});
const REFRESH_COOKIE = 'refreshToken';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/api/auth', maxAge: 30 * 864e5 };

router.post('/signup', authLimiter, validateBody(signupSchema), asyncHandler(async (req, res) => {
  const user = await auth.signup(req.body);
  res.status(201).json({ data: user });
}));

router.post('/login', authLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const out = await auth.login({ ...req.body, userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie(REFRESH_COOKIE, out.refreshToken, cookieOpts);
  res.json({ data: { user: out.user, accessToken: out.accessToken, refreshToken: out.refreshToken } });
}));

router.post('/refresh', validateBody(refreshSchema), asyncHandler(async (req, res) => {
  const token = req.body.refreshToken || req.cookies?.[REFRESH_COOKIE];
  const out = await auth.refresh({ token, userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie(REFRESH_COOKIE, out.refreshToken, cookieOpts);
  res.json({ data: { user: out.user, accessToken: out.accessToken, refreshToken: out.refreshToken } });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
  await auth.logout({ token });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ data: { ok: true } });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: await auth.getById(req.user.id) });
}));

// ---- staff account administration (admin only)
router.get('/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  res.json({ data: await auth.listUsers({ role: req.query.role }) });
}));

router.post('/users', requireAuth, requireRole('admin'), validateBody(staffUserSchema), asyncHandler(async (req, res) => {
  const user = await auth.signup(req.body);
  const updated = await auth.setRole(user.id, req.body.role);
  res.status(201).json({ data: updated });
}));

router.patch('/users/:id/role', requireAuth, requireRole('admin'), validateBody(roleSchema), asyncHandler(async (req, res) => {
  res.json({ data: await auth.setRole(req.params.id, req.body.role) });
}));

export default router;
