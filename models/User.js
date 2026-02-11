const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  firstname: { type: String, default: "" },
  lastname: { type: String, default: "" },
  password: { type: String, required: true },
  createon: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
