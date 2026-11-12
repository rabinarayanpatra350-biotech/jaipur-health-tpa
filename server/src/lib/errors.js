export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status; this.code = code; this.details = details;
  }
  static badRequest(m = 'Bad request', d) { return new ApiError(400, 'BAD_REQUEST', m, d); }
  static unauthorized(m = 'Authentication required') { return new ApiError(401, 'UNAUTHORIZED', m); }
  static forbidden(m = 'You do not have access to this resource') { return new ApiError(403, 'FORBIDDEN', m); }
  static notFound(m = 'Resource not found') { return new ApiError(404, 'NOT_FOUND', m); }
  static conflict(m = 'Resource already exists', d) { return new ApiError(409, 'CONFLICT', m, d); }
  static unprocessable(m = 'Validation failed', d) { return new ApiError(422, 'VALIDATION_FAILED', m, d); }
  static internal(m = 'Something went wrong') { return new ApiError(500, 'INTERNAL_ERROR', m); }
}

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const isApi = err instanceof ApiError;
  let status = isApi ? err.status : (err.status || 500);
  let code = isApi ? err.code : 'INTERNAL_ERROR';
  let message = isApi ? err.message : 'Something went wrong';

  if (err.code === '23505') { status = 409; code = 'CONFLICT'; message = 'That record already exists'; }
  else if (err.code === '23503') { status = 400; code = 'BAD_REQUEST'; message = 'Related record does not exist'; }
  else if (err.code === '23514') { status = 400; code = 'VALIDATION_FAILED'; message = 'A database constraint rejected this value'; }

  if (status >= 500) req.log?.error({ err }, 'unhandled error');
  else req.log?.info({ code, path: req.originalUrl }, 'request rejected');

  const body = { error: { code, message, ...(isApi && err.details ? { details: err.details } : {}) } };
  if (req.id) body.error.requestId = req.id;
  res.status(status).json(body);
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
