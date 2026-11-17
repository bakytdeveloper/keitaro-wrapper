import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  completedAt: { type: Date, default: Date.now },
});

export const LegacyImport = mongoose.model("LegacyImport", schema);
