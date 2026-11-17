import mongoose from "mongoose";

const schema = new mongoose.Schema({
  campaignId: { type: Number, required: true },
  streamId: { type: Number, required: true },
  offerId: { type: Number, required: true },
  name: { type: String, default: "" },
  share: { type: Number, min: 0, max: 100, default: 0 },
  lastShare: { type: Number, min: 0, max: 100, default: 0 },
  active: { type: Boolean, default: true },
  pinned: { type: Boolean, default: false },
}, { timestamps: true });

schema.index({ campaignId: 1, streamId: 1, offerId: 1 }, { unique: true });

export const CampaignOffer = mongoose.model("CampaignOffer", schema);
