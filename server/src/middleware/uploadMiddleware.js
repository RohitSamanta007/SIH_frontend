const multer = require("multer");
const path = require("path");

// Use memory storage so we don't write unneeded temp files to disk
const storage = multer.memoryStorage();

// Maximum allowed CSV file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed MIME types and extensions for CSV
const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/csv",
  "text/x-csv",
  "application/x-csv",
  "text/comma-separated-values",
  "application/octet-stream",
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isCsvExt = ext === ".csv";
  const isCsvMime = ALLOWED_MIME_TYPES.has(file.mimetype);

  if (isCsvExt || isCsvMime) {
    return cb(null, true);
  }

  const error = new Error(`Unsupported file type: ${file.mimetype || "unknown"}. Only CSV files (.csv) are allowed.`);
  error.statusCode = 415;
  error.code = "UNSUPPORTED_FILE_TYPE";
  return cb(error, false);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
  fileFilter,
});

/**
 * Express middleware wrapper for multer that standardizes upload errors into the project error envelope
 */
const handleUpload = (req, res, next) => {
  const uploadHandler = upload.any();

  uploadHandler(req, res, (err) => {
    if (!err) {
      return next();
    }

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: `Uploaded file exceeds the maximum allowed size of 5MB`,
          },
        });
      }

      return res.status(400).json({
        success: false,
        error: {
          code: "UPLOAD_ERROR",
          message: `File upload error: ${err.message}`,
        },
      });
    }

    // Handle custom fileFilter error (e.g. 415 Unsupported Media Type)
    const statusCode = err.statusCode || 400;
    const errorCode = err.code || "UPLOAD_ERROR";

    return res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: err.message,
      },
    });
  });
};

module.exports = {
  handleUpload,
  MAX_FILE_SIZE,
};
