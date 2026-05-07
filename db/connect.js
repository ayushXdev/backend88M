const mongoose = require("mongoose");

let connected = false;

async function connectMongo(uri) {
  if (!uri || !String(uri).trim()) {
    console.warn("MongoDB: MONGODB_URI is empty — persistence disabled.");
    return false;
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  connected = true;
  console.log("MongoDB connected.");
  return true;
}

function isMongoConnected() {
  return connected && mongoose.connection.readyState === 1;
}

module.exports = { connectMongo, isMongoConnected };
