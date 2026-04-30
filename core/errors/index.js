// core/errors/index.js
// Typed errors. Throw these from services / controllers and the global
// errorHandler will convert them to clean JSON responses.

const AppError = require("./AppError");

class BadRequestError extends AppError {
  constructor(message = "Bad request", details = null) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

class PaymentRequiredError extends AppError {
  constructor(message = "Payment required", code = "PAYMENT_REQUIRED", details = null) {
    super(message, 402, code, details);
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
  }
}

class ConflictError extends AppError {
  constructor(message = "Conflict", details = null) {
    super(message, 409, "CONFLICT", details);
  }
}

class ValidationError extends AppError {
  constructor(message = "Validation failed", details = null) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
};
