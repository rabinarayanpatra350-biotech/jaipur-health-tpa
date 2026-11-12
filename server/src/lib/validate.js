import { ApiError } from './errors.js';

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw ApiError.unprocessable('Validation failed', r.error.issues.map(i => ({
      field: i.path.join('.') || '(root)', message: i.message,
    })));
  }
  return r.data;
}
export const validateBody = (s) => (req, _res, next) => { try { req.body = parse(s, req.body); next(); } catch (e) { next(e); } };
export const validateQuery = (s) => (req, _res, next) => { try { req.query = parse(s, req.query); next(); } catch (e) { next(e); } };
