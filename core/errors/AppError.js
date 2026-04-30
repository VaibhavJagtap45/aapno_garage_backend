// core/errors/AppError.js
// Base class for all expected, controllable errors.
// Anything thrown that is NOT an AppError is treated as a 500 by errorHandler.

class AppError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.status = statusCode;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

module.exports = AppError;
