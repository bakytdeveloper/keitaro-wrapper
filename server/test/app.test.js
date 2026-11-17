import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { ServiceError } from "../src/errors.js";

test("health endpoint works without Keitaro configuration and invalid IDs return a client error", async (t) => {
  const server = createApp(() => ({})).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Keitaro Flow/);

  const invalid = await fetch(`${baseUrl}/api/campaigns/nope`);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).detail, /положительным целым числом/);
});

test("bulk offer route accepts complete offer states and exposes Keitaro error details", async (t) => {
  let receivedOffers;
  const server = createApp(() => ({
    async setOffers(_campaignId, _streamId, offers) {
      receivedOffers = offers;
      return { applied: true };
    },
    async createCampaign() {
      throw new ServiceError(502, "Не удалось создать поток", {
        keitaro_status: 422,
        path: "/admin_api/v1/streams",
        keitaro_detail: "Invalid stream settings",
      });
    },
  })).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const applied = await fetch(`${baseUrl}/campaigns/7/streams/11/offers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offers: [{ offer_id: "12", active: true, pinned: false, share: 100, last_share: 100 }],
    }),
  });
  assert.equal(applied.status, 200);
  assert.deepEqual(receivedOffers, [{
    offerId: 12,
    share: 100,
    lastShare: 100,
    active: true,
    pinned: false,
  }]);

  const failed = await fetch(`${baseUrl}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "test",
      geo: "AU",
      offer_id: 1,
      domain_id: 1,
      group_id: 1,
      source_id: 1,
    }),
  });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), {
    detail: "Не удалось создать поток",
    keitaro_status: 422,
    path: "/admin_api/v1/streams",
    keitaro_detail: "Invalid stream settings",
  });
});
