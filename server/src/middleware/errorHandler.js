const { AppError } = require("../utils/AppError");

/**
 * Centralized Express Error Handling Middleware
 * Standardizes all error responses across the application into the project envelope:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "ERROR_CODE",
 *     "message": "Human-readable message"
 *   }
 * }
 */
const errorHandler = (err, req, res, next) => {
  // Server-side logging for operational debugging (never logs secrets/tokens)
  if (process.env.NODE_ENV !== "test") {
    console.error(`[Error] [${req.method} ${req.originalUrl}]`, err.stack || err.message);
  }

  // 1. Operational AppErrors & Known Custom Errors
  if (err instanceof AppError || err.isOperational) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_SERVER_ERROR",
        message: err.message || "An unexpected operational error occurred",
      },
    });
  }

  // 2. Mongoose Schema Validation Errors
  if (err.name === "ValidationError") {
    const messages = err.errors ? Object.values(err.errors).map((e) => e.message).join(", ") : err.message;
    return res.status(422).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: messages || "Database validation failed",
      },
    });
  }

  // 3. Mongoose Cast Errors (Invalid ObjectId format, etc.)
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: `Invalid value for parameter '${err.path}'`,
      },
    });
  }

  // 4. MongoDB Duplicate Key Error (E11000)
  if (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000)) {
    return res.status(409).json({
      success: false,
      error: {
        code: "CONFLICT",
        message: "Duplicate key entry: a record with this unique identifier already exists",
      },
    });
  }

  // 5. Malformed JSON Body Parsing Error
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON syntax in request body",
      },
    });
  }

  // 6. JWT Authentication Errors
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      error: {
        code: "TOKEN_EXPIRED",
        message: "Authentication token has expired",
      },
    });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid authentication token",
      },
    });
  }

  // 7. Multer Upload Errors
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: "Uploaded file exceeds the maximum allowed size of 5MB",
        },
      });
    }
    return res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: `File upload error: ${err.message}`,
      },
    });
  }

  // 8. Unhandled / Unexpected Server Errors (500)
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || "INTERNAL_SERVER_ERROR";

  // Provide safe generic error for unhandled internal exceptions
  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: statusCode === 500 ? "Internal server error" : err.message || "An unexpected error occurred",
    },
  });
};

module.exports = errorHandler;
