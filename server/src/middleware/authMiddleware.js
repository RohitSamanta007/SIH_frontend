const jwt = require("jsonwebtoken");
const env = require("../../config/env");

/**
 * Authentication middleware to verify JWT Bearer tokens
 * Protects routes and attaches investigator identity to req.user
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authorization token required",
      },
    });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1].trim()) {
    return res.status(401).json({
      success: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Authorization format must be 'Bearer <token>'",
      },
    });
  }

  const token = parts[1].trim();

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: {
          code: "TOKEN_EXPIRED",
          message: "Authentication token has expired",
        },
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid authentication token signature or payload",
        },
      });
    }

    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication failed",
      },
    });
  }
};

module.exports = authMiddleware;

module.exports.requireInvestigator = (req, res, next) => {
  if (req.user?.role !== "investigator") {
    return res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Investigator role required" },
    });
  }
  return next();
};
