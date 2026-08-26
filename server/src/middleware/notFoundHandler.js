/**
 * 404 Route Not Found Middleware
 * Intercepts unhandled routes and returns standard JSON error envelope
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
};

module.exports = notFoundHandler;
