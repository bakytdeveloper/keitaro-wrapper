import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

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
