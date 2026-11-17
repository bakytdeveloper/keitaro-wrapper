import test from "node:test";
import assert from "node:assert/strict";
import { CampaignService } from "../src/campaignService.js";
import { ServiceError } from "../src/errors.js";

class FakeLink {
  constructor(data) {
    Object.assign(this, data);
  }

  toObject() {
    return { ...this };
  }

  async save() {}
}

function fakeModel(initial = []) {
  const documents = initial.map((record) => new FakeLink(record));
  return {
    documents,
    async create(record) {
      const doc = new FakeLink(record);
      documents.push(doc);
      return doc;
    },
    async find(filter) {
      return documents.filter((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value));
    },
    async findOneAndUpdate(filter, update) {
      let doc = documents.find((item) => Object.entries(filter).every(([key, value]) => item[key] === value));
      if (!doc) {
        doc = new FakeLink(filter);
        documents.push(doc);
      }
      Object.assign(doc, update.$set);
      return doc;
    },
  };
}

function setup({ catalog = [1, 2, 3], links = [] } = {}) {
  const model = fakeModel(links.map((link) => ({
    campaignId: 7,
    streamId: 11,
    active: true,
    pinned: false,
    lastShare: link.share,
    ...link,
  })));
  const changeModel = fakeModel();
  const stream = {
    id: 11,
    campaign_id: 7,
    schema: "landings_offers",
    position: 1,
    name: "Offers",
    offers: [{ offer_id: 1, share: 40, state: "active" }, { offer_id: 2, share: 30, state: "active" }, { offer_id: 3, share: 30, state: "active" }],
  };
  const client = {
    async listOffers() { return catalog.map((id) => ({ id, name: `Offer ${id}` })); },
    async getStream() { return structuredClone(stream); },
    async updateStream(_id, payload) { stream.offers = structuredClone(payload.offers); return stream; },
    async getCampaign(id) { return { id, name: "Test", alias: "test", state: "active" }; },
    async campaignStreams() { return [structuredClone(stream)]; },
    async buildReport() { return { rows: [] }; },
  };
  const service = new CampaignService(client, { namePrefix: "", googleUrl: "https://www.google.com" }, {
    CampaignOffer: model,
    CampaignRecord: fakeModel(),
    OfferChange: changeModel,
  });
  return { service, client, stream, model };
}

test("deactivating an offer retains it and reallocates only unpinned shares", async () => {
  const { service, stream, model } = setup({
    links: [
      { offerId: 1, name: "Offer 1", share: 40, active: true, pinned: true },
      { offerId: 2, name: "Offer 2", share: 30, active: true, pinned: false },
      { offerId: 3, name: "Offer 3", share: 30, active: true, pinned: false },
    ],
  });
  const result = await service.setOfferActive(7, 11, 2, false);
  const offers = result.streams[0].offers;
  assert.deepEqual(offers.map(({ offer_id, share, active, last_share }) => [offer_id, share, active, last_share]), [
    [1, 40, true, 40],
    [2, 0, false, 30],
    [3, 60, true, 60],
  ]);
  assert.deepEqual(stream.offers.map(({ offer_id, share }) => [offer_id, share]), [[1, 40], [2, 0], [3, 60]]);
  assert.equal(model.documents.length, 3);

  const restored = await service.setOfferActive(7, 11, 2, true);
  assert.deepEqual(restored.streams[0].offers.map(({ offer_id, share }) => [offer_id, share]), [
    [1, 40],
    [2, 30],
    [3, 30],
  ]);
});

test("editing another offer's share leaves a pinned percentage unchanged", async () => {
  const { service } = setup({
    links: [
      { offerId: 1, name: "Offer 1", share: 35, active: true, pinned: true },
      { offerId: 2, name: "Offer 2", share: 45, active: true, pinned: false },
      { offerId: 3, name: "Offer 3", share: 20, active: true, pinned: false },
    ],
  });
  const result = await service.setOfferShare(7, 11, 2, 60);
  assert.deepEqual(result.streams[0].offers.map(({ offer_id, share }) => [offer_id, share]), [
    [1, 35],
    [2, 60],
    [3, 5],
  ]);
});

test("an offer removed from Keitaro stays locally visible and cannot be reactivated yet", async () => {
  const { service, stream } = setup({
    catalog: [1, 3],
    links: [
      { offerId: 1, name: "Offer 1", share: 40, active: true },
      { offerId: 2, name: "Offer 2", share: 30, active: true },
      { offerId: 3, name: "Offer 3", share: 30, active: true },
    ],
  });
  const result = await service.campaignView(7);
  const missing = result.streams[0].offers.find((offer) => offer.offer_id === 2);
  assert.equal(missing.active, false);
  assert.equal(missing.available_in_keitaro, false);
  assert.equal(missing.last_share, 30);
  assert.equal(stream.offers.some((offer) => offer.offer_id === 2), false);
  assert.deepEqual(stream.offers.map(({ offer_id, share }) => [offer_id, share]), [[1, 57], [3, 43]]);
  assert.equal(stream.offers.reduce((sum, offer) => sum + offer.share, 0), 100);
  await assert.rejects(service.setOfferActive(7, 11, 2, true), (error) => {
    assert.ok(error instanceof ServiceError);
    assert.match(error.message, /после восстановления в Keitaro/);
    return true;
  });
});

test("campaign view still shows all offers as inactive when Keitaro has no offers left", async () => {
  const { service } = setup({
    catalog: [],
    links: [
      { offerId: 1, name: "Offer 1", share: 40, active: true },
      { offerId: 2, name: "Offer 2", share: 30, active: true },
      { offerId: 3, name: "Offer 3", share: 30, active: true },
    ],
  });
  const result = await service.campaignView(7);
  assert.equal(result.streams[0].offers.length, 3);
  assert.equal(result.streams[0].offers.every((offer) => !offer.active), true);
  assert.equal(result.streams[0].share_warning, null);
});
