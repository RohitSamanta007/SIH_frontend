/**
 * Base Application Error class for operational errors
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} [code="INTERNAL_SERVER_ERROR"] - Machine-readable error code
   * @param {number} [statusCode=500] - HTTP status code
   * @param {any} [details=null] - Optional safe diagnostic details
   */
  constructor(message, code = "INTERNAL_SERVER_ERROR", statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND", details = null) {
    super(message, code, 404, details);
  }
}

class ValidationError extends AppError {
  constructor(message = "Validation failed", code = "VALIDATION_ERROR", statusCode = 422, details = null) {
    super(message, code, statusCode, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED", details = null) {
    super(message, code, 401, details);
  }
}

class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST", details = null) {
    super(message, code, 400, details);
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  BadRequestError,
};
