import mongoose from "mongoose";

const schema = new mongoose.Schema({
  legacyId: { type: Number, unique: true, sparse: true },
  campaignId: { type: Number, required: true, index: true },
  streamId: { type: Number, required: true },
  offerId: Number,
  action: { type: String, required: true },
  sharesAfter: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const OfferChange = mongoose.model("OfferChange", schema);
