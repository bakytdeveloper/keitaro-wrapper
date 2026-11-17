import test from "node:test";
import assert from "node:assert/strict";
import { equalSplit, parseGeo, rebalanceOffers, withNewOffer } from "../src/shares.js";

test("equal split preserves the requested total and distributes integer remainder predictably", () => {
  assert.deepEqual(equalSplit(3), [34, 33, 33]);
  assert.deepEqual(equalSplit(5), [20, 20, 20, 20, 20]);
  assert.deepEqual(equalSplit(4, 65), [17, 16, 16, 16]);
});

test("pinned offers keep their share while flexible offers divide the remainder equally", () => {
  const offers = [
    { offerId: 1, active: true, pinned: true, share: 35 },
    { offerId: 2, active: true, pinned: false, share: 50 },
    { offerId: 3, active: true, pinned: false, share: 15 },
    { offerId: 4, active: false, pinned: false, share: 0 },
  ];
  rebalanceOffers(offers);
  assert.deepEqual(offers.map(({ share }) => share), [35, 33, 32, 0]);

  offers[1].share = 70;
  offers[2].share = 30;
  rebalanceOffers(offers);
  assert.deepEqual(offers.map(({ share }) => share), [35, 33, 32, 0]);
  assert.equal(offers.filter((offer) => offer.active).reduce((sum, offer) => sum + offer.share, 0), 100);
});

test("automatic offer addition splits unpinned offers equally", () => {
  const offers = [
    { active: true, pinned: false, share: 70 },
    { active: true, pinned: false, share: 30 },
  ];
  const newShare = withNewOffer(offers, null);
  offers.push({ active: true, pinned: false, share: newShare });
  assert.deepEqual(offers.map(({ share }) => share), [34, 33, 33]);
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
