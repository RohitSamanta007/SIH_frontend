const mongoose = require("mongoose");
const env = require("./env");

/**
 * Connect to MongoDB database
 * @returns {Promise<typeof mongoose>}
 */
const connectDB = async () => {
  const uri = env.MONGODB_URI;

  if (!uri) {
    const errorMsg = "MongoDB connection error: MONGODB_URI (or MONGO_URI) is not defined in environment variables.";
    console.error(`[Database] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database] MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

/**
 * Disconnect from MongoDB database
 * @returns {Promise<void>}
 */
const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log("[Database] MongoDB connection closed.");
  } catch (error) {
    console.error(`[Database] Error while closing MongoDB connection: ${error.message}`);
  }
};

// Connection event listeners
mongoose.connection.on("disconnected", () => {
  console.log("[Database] MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error(`[Database] MongoDB connection error: ${err.message}`);
});

module.exports = {
  connectDB,
  disconnectDB,
};
