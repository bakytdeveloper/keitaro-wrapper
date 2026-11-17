import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ServiceError, KeitaroError } from "./errors.js";
import { KeitaroClient } from "./keitaro.js";
import { CampaignService } from "./campaignService.js";
import { config } from "./config.js";

const numericId = (value, label) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ServiceError(400, `${label} должен быть положительным целым числом`);
  return parsed;
};

const createService = () => new CampaignService(
  new KeitaroClient(config.keitaroBaseUrl, config.keitaroApiKey, config.keitaroTimeout),
  config,
);

export function createApp(getService = createService) {
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ status: "ok" }));
  api.use((req, res, next) => {
    try {
      req.service = getService();
      next();
    } catch (error) {
      next(error);
    }
  });

  api.get("/meta", async (req, res) => res.json(await req.service.defaults()));
  api.get("/offers", async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await req.service.searchOffers(req.query.q || "", limit));
  });
  api.post("/campaigns", async (req, res) => {
    const { name, geo, offer_id: offerId, domain_id: domainId, group_id: groupId, source_id: sourceId } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 200) {
      throw new ServiceError(400, "Название кампании должно содержать от 1 до 200 символов");
    }
    if (typeof geo !== "string" || geo.length < 2) throw new ServiceError(400, "Укажите гео-коды");
    const created = await req.service.createCampaign(
      name, geo, numericId(offerId, "offer_id"),
      domainId == null ? null : numericId(domainId, "domain_id"),
      groupId == null ? null : numericId(groupId, "group_id"),
      sourceId == null ? null : numericId(sourceId, "source_id"),
    );
    res.status(201).json(created);
  });
  api.get("/campaigns", async (req, res) => res.json(await req.service.listCampaigns(req.query.q || "")));
  api.get("/campaigns/:campaignId", async (req, res) => {
    res.json(await req.service.campaignView(
      numericId(req.params.campaignId, "campaign_id"),
      String(req.query.interval || "today"),
    ));
  });
  api.post("/campaigns/:campaignId/streams/:streamId/offers", async (req, res) => {
    const offerId = numericId(req.body?.offer_id, "offer_id");
    const share = req.body?.share == null ? null : Number(req.body.share);
    if (share != null && (!Number.isInteger(share) || share < 1 || share > 100)) {
      throw new ServiceError(400, "Доля должна быть целым числом от 1 до 100");
    }
    res.json(await req.service.addOffer(
      numericId(req.params.campaignId, "campaign_id"),
      numericId(req.params.streamId, "stream_id"),
      offerId,
      share,
    ));
  });
  api.delete("/campaigns/:campaignId/streams/:streamId/offers/:offerId", async (req, res) => {
    res.json(await req.service.setOfferActive(
      numericId(req.params.campaignId, "campaign_id"),
      numericId(req.params.streamId, "stream_id"),
      numericId(req.params.offerId, "offer_id"),
      false,
    ));
  });
  api.patch("/campaigns/:campaignId/streams/:streamId/offers/:offerId", async (req, res) => {
    const campaignId = numericId(req.params.campaignId, "campaign_id");
    const streamId = numericId(req.params.streamId, "stream_id");
    const offerId = numericId(req.params.offerId, "offer_id");
    if (typeof req.body?.active === "boolean") {
      return res.json(await req.service.setOfferActive(campaignId, streamId, offerId, req.body.active));
    }
    if (typeof req.body?.pinned === "boolean") {
      return res.json(await req.service.setOfferPinned(campaignId, streamId, offerId, req.body.pinned));
    }
    if (Number.isInteger(req.body?.share)) {
      return res.json(await req.service.setOfferShare(campaignId, streamId, offerId, req.body.share));
    }
    throw new ServiceError(400, "Укажите active, pinned или целое значение share");
  });
  api.put("/campaigns/:campaignId/streams/:streamId/offers", async (req, res) => {
    const shares = req.body?.shares;
    if (!Array.isArray(shares)) throw new ServiceError(400, "Поле shares должно быть массивом");
    const shareMap = new Map();
    for (const item of shares) {
      const id = numericId(item?.offer_id, "offer_id");
      if (shareMap.has(id)) throw new ServiceError(400, `Доля для оффера ${id} передана повторно`);
      shareMap.set(id, Number(item.share));
    }
    res.json(await req.service.setShares(
      numericId(req.params.campaignId, "campaign_id"),
      numericId(req.params.streamId, "stream_id"),
      shareMap,
    ));
  });
  api.get("/debug/stream/:streamId", async (req, res) => {
    res.json(await req.service.client.getStream(numericId(req.params.streamId, "stream_id")));
  });
  api.use((_req, res) => res.status(404).json({ detail: "Маршрут API не найден" }));
  app.use("/api", api);
  const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile(resolve(clientDist, "index.html")));
  }
  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ detail: "Некорректный JSON в теле запроса" });
    }
    if (error instanceof ServiceError) return res.status(error.status).json({ detail: error.message });
    if (error instanceof KeitaroError) {
      return res.status(502).json({
        detail: `Keitaro API: ${error.detail}`,
        path: error.path,
        keitaro_status: error.status,
      });
    }
    console.error(error);
    return res.status(500).json({ detail: "Внутренняя ошибка сервера" });
  });
  return app;
}
