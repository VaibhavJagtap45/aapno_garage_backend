// core/middleware/errorHandler.js
// Centralised error → JSON response.
// Mount LAST in the express stack.

const { AppError } = require("../errors");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // Mongo duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    const value = field ? err.keyValue?.[field] : undefined;
    const message =
      field && value !== undefined
        ? `${field} '${value}' already exists.`
        : "A record with the same unique value already exists.";
    return res.status(409).json({ success: false, code: "DUPLICATE_KEY", message });
  }

  // Mongoose validation
  if (err?.name === "ValidationError") {
    const details = Object.values(err.errors || {}).map((e) => ({
      path: e.path,
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Validation failed.",
      errors: details,
    });
  }

  // CastError (bad ObjectId, etc.)
  if (err?.name === "CastError") {
    return res.status(400).json({
      success: false,
      code: "BAD_REQUEST",
      message: `Invalid ${err.path}: ${err.value}`,
    });
  }

  // Our own typed errors
  if (err instanceof AppError) {
    const body = {
      success: false,
      code: err.code || undefined,
      message: err.message,
    };
    if (err.details) body.errors = err.details;
    return res.status(err.statusCode).json(body);
  }

  // Anything else → 500
  // eslint-disable-next-line no-console
  console.error("[unhandled]", err);
  res.status(err?.status || 500).json({
    success: false,
    message: err?.message || "Internal Server Error",
  });
}

module.exports = errorHandler;
