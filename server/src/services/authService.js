const jwt = require("jsonwebtoken");
const User = require("../models/User");
const env = require("../../config/env");

/**
 * Generate a short-lived JWT token containing minimal investigator identity
 * @param {Object} user - User document
 * @param {string} [expiresIn] - Optional custom expiration (defaults to env.JWT_EXPIRES_IN)
 * @returns {string} Signed JWT token
 */
const generateToken = (user, expiresIn = env.JWT_EXPIRES_IN) => {
  const payload = {
    userId: user._id.toString(),
    username: user.username,
    role: user.role || "investigator",
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn,
  });
};

/**
 * Authenticate user credentials and return a signed JWT
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @returns {Promise<{ success: boolean, token?: string, user?: Object, code?: string, message?: string }>}
 */
const authenticateUser = async (username, password) => {
  if (!username || !password) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      message: "Username and password are required",
    };
  }

  // Find user by normalized username and explicitly select the password hash
  const user = await User.findOne({ username: username.toLowerCase().trim() }).select("+password");

  if (!user) {
    return {
      success: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    };
  }

  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return {
      success: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    };
  }

  const token = generateToken(user);

  return {
    success: true,
    token,
    user: {
      id: user._id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  };
};

/**
 * Seed default investigator user if no users exist in the database
 * Ensures out-of-the-box readiness without plaintext password storage
 * @returns {Promise<void>}
 */
const seedDefaultInvestigator = async () => {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const username = env.DEFAULT_INVESTIGATOR_USERNAME;
      const password = env.DEFAULT_INVESTIGATOR_PASSWORD;

      await User.create({
        username,
        password,
        name: "Primary Investigator",
        role: "investigator",
      });

      console.log(`[Auth] Initialized default investigator account: "${username}"`);
    }
  } catch (error) {
    console.error("[Auth] Error seeding default investigator:", error.message);
  }
};

module.exports = {
  generateToken,
  authenticateUser,
  seedDefaultInvestigator,
};
