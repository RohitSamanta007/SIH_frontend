const { authenticateUser } = require("../services/authService");

/**
 * Handle investigator login
 * @route POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password || typeof username !== "string" || typeof password !== "string" || !username.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Username and password are required",
        },
      });
    }

    const result = await authenticateUser(username, password);

    if (!result.success) {
      const statusCode = result.code === "VALIDATION_ERROR" ? 400 : 401;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: result.code,
          message: result.message,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        token: result.token,
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify current authenticated user session
 * @route GET /api/auth/verify
 */
const verifyToken = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
    error: null,
  });
};

module.exports = {
  login,
  verifyToken,
};
