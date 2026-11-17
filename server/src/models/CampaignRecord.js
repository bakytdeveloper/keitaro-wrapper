import mongoose from "mongoose";

const schema = new mongoose.Schema({
  keitaroId: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true },
  geo: { type: String, required: true },
  offerId: { type: Number, required: true },
  domainId: Number,
  groupId: Number,
  sourceId: Number,
  googleStreamId: Number,
  offerStreamId: Number,
  createdAt: { type: Date, default: Date.now },
});

export const CampaignRecord = mongoose.model("CampaignRecord", schema);
