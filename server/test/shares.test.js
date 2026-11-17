import test from "node:test";
import assert from "node:assert/strict";
import { equalSplit, parseGeo, rebalanceOffers, redistribute, withNewOffer } from "../src/shares.js";

test("equal split and proportional redistribution preserve the requested total", () => {
  assert.deepEqual(equalSplit(3), [34, 33, 33]);
  assert.deepEqual(redistribute([60, 40], 80), [48, 32]);
  assert.equal(redistribute([1, 1, 1], 100).reduce((sum, share) => sum + share, 0), 100);
});

test("pinned offers keep their share while only flexible offers rebalance", () => {
  const offers = [
    { offerId: 1, active: true, pinned: true, share: 35 },
    { offerId: 2, active: true, pinned: false, share: 50 },
    { offerId: 3, active: true, pinned: false, share: 15 },
    { offerId: 4, active: false, pinned: false, share: 0 },
  ];
  rebalanceOffers(offers);
  assert.deepEqual(offers.map(({ share }) => share), [35, 50, 15, 0]);

  offers[1].share = 70;
  offers[2].share = 30;
  rebalanceOffers(offers);
  assert.deepEqual(offers.map(({ share }) => share), [35, 46, 19, 0]);
  assert.equal(offers.filter((offer) => offer.active).reduce((sum, offer) => sum + offer.share, 0), 100);
});

test("adding an offer leaves pinned shares fixed and distributes only the remaining percentage", () => {
  const offers = [
    { active: true, pinned: true, share: 40 },
    { active: true, pinned: false, share: 60 },
  ];
  const newShare = withNewOffer(offers, 20);
  offers.push({ active: true, pinned: false, share: newShare });
  assert.deepEqual(offers.map(({ share }) => share), [40, 40, 20]);
});

test("rejects impossible pinned allocations and validates geo codes", () => {
  assert.throws(() => rebalanceOffers([
    { active: true, pinned: true, share: 70 },
  ]), /остаток/);
  assert.deepEqual(parseGeo("mx, au;ro mx"), ["MX", "AU", "RO"]);
  assert.throws(() => parseGeo("MEX"), /ISO-код/);
});
