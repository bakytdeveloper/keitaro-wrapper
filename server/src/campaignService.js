import { ServiceError, KeitaroError } from "./errors.js";
import { parseGeo, rebalanceOffers, redistribute, withNewOffer } from "./shares.js";
import { CampaignRecord } from "./models/CampaignRecord.js";
import { CampaignOffer } from "./models/CampaignOffer.js";
import { OfferChange } from "./models/OfferChange.js";

const asArray = (value) => Array.isArray(value) ? value : [];
const asNumber = (value) => Number(value);
const normalizedName = (value) => String(value || "").trim().toLowerCase();
const cleanDomain = (value) => String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();

export class CampaignService {
  constructor(client, settings, models = {}) {
    this.client = client;
    this.settings = settings;
    this.models = {
      CampaignRecord: models.CampaignRecord || CampaignRecord,
      CampaignOffer: models.CampaignOffer || CampaignOffer,
      OfferChange: models.OfferChange || OfferChange,
    };
  }

  async defaults() {
    const [domains, groups, sources] = await Promise.all([
      this.client.listDomains(),
      this.client.listGroups("campaigns"),
      this.client.listTrafficSources(),
    ]);
    const findByName = (items, name, key = normalizedName) => items.find((item) => key(item.name) === key(name));
    const domain = this.settings.defaultDomain
      ? findByName(domains, this.settings.defaultDomain, cleanDomain)
      : domains.length === 1 ? domains[0] : null;
    const group = this.settings.defaultGroupName ? findByName(groups, this.settings.defaultGroupName) : null;
    const source = this.settings.defaultSourceName ? findByName(sources, this.settings.defaultSourceName) : null;
    return {
      domains: domains.map(({ id, name }) => ({ id, name })),
      groups: groups.map(({ id, name }) => ({ id, name })),
      sources: sources.map(({ id, name }) => ({ id, name })),
      defaults: {
        domain_id: domain?.id ?? null,
        group_id: group?.id ?? null,
        source_id: source?.id ?? null,
        name_prefix: this.settings.namePrefix,
      },
    };
  }

  async searchOffers(query = "", limit = 20) {
    const q = String(query).trim().toLowerCase();
    const offers = await this.client.listOffers();
    return asArray(offers)
      .filter((offer) => !q || String(offer.name || "").toLowerCase().includes(q) || q === String(offer.id))
      .slice(0, limit)
      .map((offer) => ({ id: offer.id, name: offer.name || "", country: offer.country }));
  }

  async _getOffer(offerId) {
    const offers = asArray(await this.client.listOffers());
    const offer = offers.find((item) => asNumber(item.id) === asNumber(offerId));
    if (!offer) throw new ServiceError(404, `Оффер с ID ${offerId} не найден в Keitaro`);
    return offer;
  }

  async createCampaign(name, geoRaw, offerId, domainId, groupId, sourceId) {
    let geos;
    try {
      geos = parseGeo(geoRaw);
    } catch (error) {
      throw new ServiceError(400, error.message);
    }
    name = String(name || "").trim();
    if (!name) throw new ServiceError(400, "Название кампании не может быть пустым");
    const prefix = this.settings.namePrefix;
    if (prefix && !name.startsWith(prefix)) name = prefix + name;

    const defaults = (await this.defaults()).defaults;
    domainId ||= defaults.domain_id;
    groupId ||= defaults.group_id;
    sourceId ||= defaults.source_id;
    const missing = [
      ["домен", domainId],
      ["группа", groupId],
      ["источник", sourceId],
    ].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) {
      throw new ServiceError(400, `Не выбраны: ${missing.join(", ")}. Задайте настройки по умолчанию или выберите значения в форме.`);
    }

    const offer = await this._getOffer(offerId);
    const existing = asArray(await this.client.listCampaigns());
    if (existing.some((campaign) => campaign.name === name)) {
      throw new ServiceError(409, `Кампания с именем «${name}» уже существует`);
    }
    const campaign = await this.client.createCampaign({
      name,
      type: "position",
      state: "active",
      cookies_ttl: 24,
      domain_id: domainId,
      group_id: groupId,
      traffic_source_id: sourceId,
      cost_type: "CPC",
      cost_value: 0,
      cost_currency: "USD",
      cost_auto: true,
    });

    let google;
    let offerStream;
    try {
      google = await this.client.createStream({
        campaign_id: campaign.id,
        type: "regular",
        name: `Geo ${geos.join(",")} → Google`,
        position: 1,
        state: "active",
        schema: "action",
        action_type: "http",
        action_payload: this.settings.googleUrl,
        collect_clicks: true,
        filter_or: false,
        filters: [{ name: "country", mode: "accept", payload: geos }],
      });
      offerStream = await this.client.createStream({
        campaign_id: campaign.id,
        type: "regular",
        name: `Offer ${offerId}`,
        position: 2,
        state: "active",
        schema: "landings_offers",
        action_type: "http",
        collect_clicks: true,
        filter_or: false,
        filters: [],
        offers: [{ offer_id: offerId, share: 100, state: "active" }],
      });
    } catch (error) {
      let rollbackMessage = "";
      try {
        await this.client.deleteCampaign(campaign.id);
      } catch (rollbackError) {
        rollbackMessage = ` Не удалось откатить кампанию ${campaign.id}: ${rollbackError.message}`;
      }
      throw new ServiceError(502, `Не удалось создать потоки кампании ${campaign.id}.${rollbackMessage} ${error.message}`);
    }

    await this.models.CampaignRecord.create({
      keitaroId: campaign.id,
      name,
      geo: geos.join(","),
      offerId,
      domainId,
      groupId,
      sourceId,
      googleStreamId: google.id,
      offerStreamId: offerStream.id,
    });
    await this.models.CampaignOffer.create({
      campaignId: campaign.id,
      streamId: offerStream.id,
      offerId,
      name: offer.name || `#${offerId}`,
      share: 100,
      lastShare: 100,
      active: true,
      pinned: false,
    });

    const domains = asArray(await this.client.listDomains());
    const domainName = domains.find((item) => asNumber(item.id) === asNumber(domainId))?.name;
    return {
      campaign_id: campaign.id,
      name,
      alias: campaign.alias,
      tracking_url: domainName && campaign.alias ? `https://${cleanDomain(domainName)}/${campaign.alias}` : null,
      geo: geos,
      offer: { id: offerId, name: offer.name },
      streams: { google: google.id, offer: offerStream.id },
    };
  }

  async listCampaigns(query = "") {
    const q = String(query).trim().toLowerCase();
    const campaigns = asArray(await this.client.listCampaigns())
      .filter((campaign) => !q || String(campaign.name || "").toLowerCase().includes(q) || q === String(campaign.id))
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        alias: campaign.alias,
        state: campaign.state,
      }));
    return campaigns.sort((a, b) => b.id - a.id);
  }

  async _stats(campaignId, interval) {
    let lastError = null;
    for (const dimensions of [["stream_id", "offer_id"], ["stream", "offer"]]) {
      try {
        const report = await this.client.buildReport({
          range: { interval },
          dimensions,
          measures: ["clicks", "campaign_unique_clicks", "bots"],
          filters: [{ name: "campaign_id", operator: "EQUALS", expression: campaignId }],
          limit: 1000,
        });
        const stats = new Map();
        for (const row of asArray(report?.rows)) {
          if (row.stream_id == null || row.offer_id == null) continue;
          stats.set(`${row.stream_id}:${row.offer_id}`, {
            clicks: row.clicks || 0,
            unique_clicks: row.campaign_unique_clicks || 0,
            bots: row.bots || 0,
          });
        }
        return { stats, error: null };
      } catch (error) {
        if (!(error instanceof KeitaroError)) throw error;
        lastError = error.detail;
      }
    }
    return { stats: new Map(), error: lastError };
  }

  async _syncStream(campaignId, stream, catalog) {
    const { CampaignOffer: OfferModel } = this.models;
    const streamId = asNumber(stream.id);
    const remoteOffers = asArray(stream.offers);
    const remoteById = new Map(remoteOffers.map((offer) => [asNumber(offer.offer_id), offer]));
    let links = await OfferModel.find({ campaignId, streamId });
    const byId = new Map(links.map((link) => [asNumber(link.offerId), link]));
    let shouldRemoveUnavailable = false;
    let deactivated = false;

    for (const remote of remoteOffers) {
      const offerId = asNumber(remote.offer_id);
      const liveOffer = catalog.get(offerId);
      let link = byId.get(offerId);
      const remoteShare = Math.max(0, Math.min(100, asNumber(remote.share) || 0));
      if (!link) {
        if (!liveOffer && remoteShare > 0) deactivated = true;
        link = await OfferModel.create({
          campaignId,
          streamId,
          offerId,
          name: liveOffer?.name || `#${offerId}`,
          share: liveOffer ? remoteShare : 0,
          lastShare: remoteShare,
          active: Boolean(liveOffer && remoteShare > 0 && remote.state !== "disabled"),
          pinned: false,
        });
        byId.set(offerId, link);
      } else if (!liveOffer) {
        if (link.active) {
          link.lastShare = link.share || remoteShare || link.lastShare;
          deactivated = true;
        }
        link.active = false;
        link.pinned = false;
        link.share = 0;
        shouldRemoveUnavailable = true;
        await link.save();
      } else {
        link.name = liveOffer.name || link.name || `#${offerId}`;
        if (link.active && remoteById.has(offerId) && !link.pinned) {
          link.share = remoteShare;
          if (remoteShare > 0) link.lastShare = remoteShare;
        }
        await link.save();
      }
    }

    for (const link of links) {
      const offerId = asNumber(link.offerId);
      if (link.active && (!remoteById.has(offerId) || !catalog.has(offerId))) {
        link.lastShare = link.share || link.lastShare;
        link.share = 0;
        link.active = false;
        link.pinned = false;
        deactivated = true;
        await link.save();
      }
      if (!catalog.has(offerId)) shouldRemoveUnavailable = shouldRemoveUnavailable || remoteById.has(offerId);
    }

    links = await OfferModel.find({ campaignId, streamId });
    const activeCount = links.filter((link) => link.active).length;
    let shareWarning = null;
    if (deactivated) {
      if (activeCount > 0) {
        try {
          rebalanceOffers(links);
        } catch (error) {
          shareWarning = `Оффер был удалён в Keitaro, но доли закреплённых офферов нельзя распределить на 100%: ${error.message}`;
        }
      }
      if (!shareWarning) await Promise.all(links.map((link) => link.save()));
    }
    if (!shareWarning && (deactivated || shouldRemoveUnavailable) && links.some((link) => catalog.has(asNumber(link.offerId)))) {
      await this.client.updateStream(streamId, {
        offers: links
          .filter((link) => catalog.has(asNumber(link.offerId)))
          .map((link) => ({
            offer_id: link.offerId,
            share: link.active ? link.share : 0,
            state: "active",
          })),
      });
    }
    links = await OfferModel.find({ campaignId, streamId });
    links.shareWarning = shareWarning;
    return links;
  }

  async campaignView(campaignId, interval = "today") {
    let campaign;
    try {
      campaign = await this.client.getCampaign(campaignId);
    } catch (error) {
      if (error instanceof KeitaroError && error.status === 404) {
        throw new ServiceError(404, `Кампания ${campaignId} не найдена`);
      }
      throw error;
    }
    const [liveOffers, streams, { stats, error: statsError }] = await Promise.all([
      this.client.listOffers(),
      this.client.campaignStreams(campaignId),
      this._stats(campaignId, interval),
    ]);
    const catalog = new Map(asArray(liveOffers).map((offer) => [asNumber(offer.id), offer]));
    const views = [];
    for (const stream of asArray(streams).sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const links = stream.schema === "landings_offers"
        ? await this._syncStream(campaignId, stream, catalog)
        : [];
      const shareWarning = links.shareWarning || null;
      const offers = links
        .sort((a, b) => asNumber(a.offerId) - asNumber(b.offerId))
        .map((link) => {
          const currentStats = stats.get(`${stream.id}:${link.offerId}`) || {};
          return {
            offer_id: link.offerId,
            name: link.name || `#${link.offerId}`,
            share: link.active ? link.share : 0,
            last_share: link.lastShare,
            active: link.active,
            pinned: link.pinned,
            available_in_keitaro: catalog.has(asNumber(link.offerId)),
            clicks: currentStats.clicks || 0,
            unique_clicks: currentStats.unique_clicks || 0,
            bots: currentStats.bots || 0,
          };
        });
      views.push({
        id: stream.id,
        name: stream.name,
        position: stream.position,
        schema: stream.schema,
        action_type: stream.action_type,
        action_payload: stream.action_payload,
        state: stream.state,
        filters: stream.filters || [],
        editable: stream.schema === "landings_offers",
        share_warning: shareWarning,
        offers,
        totals: {
          clicks: offers.reduce((sum, offer) => sum + offer.clicks, 0),
          unique_clicks: offers.reduce((sum, offer) => sum + offer.unique_clicks, 0),
          bots: offers.reduce((sum, offer) => sum + offer.bots, 0),
          share: offers.filter((offer) => offer.active).reduce((sum, offer) => sum + offer.share, 0),
        },
      });
    }
    return {
      campaign: { id: campaign.id, name: campaign.name, alias: campaign.alias, state: campaign.state },
      interval,
      streams: views,
      stats_error: statsError,
    };
  }

  async _offerStream(campaignId, streamId) {
    const stream = await this.client.getStream(streamId);
    if (asNumber(stream.campaign_id) !== asNumber(campaignId)) {
      throw new ServiceError(404, `Поток ${streamId} не принадлежит кампании ${campaignId}`);
    }
    if (stream.schema !== "landings_offers") {
      throw new ServiceError(400, "В этом потоке нет офферов — редактировать нечего");
    }
    return stream;
  }

  async _saveOffers(campaignId, streamId, offers, action, offerId) {
    const { CampaignOffer: OfferModel, OfferChange: ChangeModel } = this.models;
    const catalog = new Map(asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]));
    const payload = offers
      .filter((offer) => catalog.has(asNumber(offer.offerId)))
      .map((offer) => ({
        offer_id: offer.offerId,
        share: offer.active ? offer.share : 0,
        state: "active",
      }));
    await this.client.updateStream(streamId, { offers: payload });
    await Promise.all(offers.map((offer) => OfferModel.findOneAndUpdate(
      { campaignId, streamId, offerId: offer.offerId },
      {
        $set: {
          name: offer.name || catalog.get(asNumber(offer.offerId))?.name || `#${offer.offerId}`,
          share: offer.active ? offer.share : 0,
          lastShare: offer.active ? offer.share : offer.lastShare,
          active: offer.active,
          pinned: offer.active && offer.pinned,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )));
    await ChangeModel.create({
      campaignId,
      streamId,
      offerId: offerId ?? undefined,
      action,
      sharesAfter: JSON.stringify(Object.fromEntries(offers.map((offer) => [
        offer.offerId,
        { share: offer.active ? offer.share : 0, active: offer.active, pinned: offer.pinned },
      ]))),
    });
    return this.campaignView(campaignId);
  }

  async addOffer(campaignId, streamId, offerId, share = null) {
    const stream = await this._offerStream(campaignId, streamId);
    const catalogOffer = await this._getOffer(offerId);
    let offers = await this._syncStream(campaignId, stream, new Map(
      asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]),
    ));
    const existing = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
    if (existing) {
      if (existing.active) throw new ServiceError(409, `Оффер ${offerId} уже есть в этом потоке`);
      return this.setOfferActive(campaignId, streamId, offerId, true);
    }
    offers = offers.map((offer) => offer.toObject());
    const newShare = withNewOffer(offers, share);
    offers.push({
      campaignId,
      streamId,
      offerId,
      name: catalogOffer.name || `#${offerId}`,
      share: newShare,
      lastShare: newShare,
      active: true,
      pinned: false,
    });
    try {
      rebalanceOffers(offers);
    } catch (error) {
      throw new ServiceError(409, error.message);
    }
    return this._saveOffers(campaignId, streamId, offers, "add", offerId);
  }

  async setOfferActive(campaignId, streamId, offerId, active) {
    const stream = await this._offerStream(campaignId, streamId);
    let offers = await this._syncStream(campaignId, stream, new Map(
      asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]),
    ));
    const target = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
    if (!target) throw new ServiceError(404, `Оффера ${offerId} нет в этом потоке`);
    if (active && !target.active) {
      let liveOffer;
      try {
        liveOffer = await this._getOffer(offerId);
      } catch (error) {
        if (error instanceof ServiceError && error.status === 404) {
          throw new ServiceError(409, `Оффер ${offerId} отсутствует в Keitaro; его можно включить после восстановления в Keitaro`);
        }
        throw error;
      }
      offers = offers.map((offer) => offer.toObject());
      const restored = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
      restored.name = liveOffer.name || restored.name;
      restored.active = true;
      try {
        const fixedShare = offers
          .filter((offer) => offer.offerId !== restored.offerId && offer.active && offer.pinned)
          .reduce((sum, offer) => sum + offer.share, 0);
        const availableShare = 100 - fixedShare;
        if (availableShare < 1) throw new RangeError("Закреплённые офферы уже занимают 100%");
        restored.share = Math.min(restored.lastShare || 1, availableShare);
        restored.share = withNewOffer(offers.filter((offer) => offer.offerId !== restored.offerId), restored.share);
        rebalanceOffers(offers);
      } catch (error) {
        restored.active = false;
        restored.share = 0;
        throw new ServiceError(409, error.message);
      }
      return this._saveOffers(campaignId, streamId, offers, "activate", offerId);
    }
    if (!active && target.active) {
      if (offers.filter((offer) => offer.active).length <= 1) {
        throw new ServiceError(409, "Нельзя деактивировать последний активный оффер потока");
      }
      offers = offers.map((offer) => offer.toObject());
      const changed = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
      changed.lastShare = changed.share;
      changed.share = 0;
      changed.active = false;
      changed.pinned = false;
      try {
        rebalanceOffers(offers);
      } catch (error) {
        throw new ServiceError(409, error.message);
      }
      return this._saveOffers(campaignId, streamId, offers, "deactivate", offerId);
    }
    return this.campaignView(campaignId);
  }

  async setOfferPinned(campaignId, streamId, offerId, pinned) {
    const stream = await this._offerStream(campaignId, streamId);
    const offers = (await this._syncStream(campaignId, stream, new Map(
      asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]),
    ))).map((offer) => offer.toObject());
    const target = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
    if (!target) throw new ServiceError(404, `Оффера ${offerId} нет в этом потоке`);
    if (!target.active) throw new ServiceError(409, "Закрепить можно только активный оффер");
    target.pinned = Boolean(pinned);
    return this._saveOffers(campaignId, streamId, offers, "pin", offerId);
  }

  async setShares(campaignId, streamId, shares) {
    const stream = await this._offerStream(campaignId, streamId);
    const offers = (await this._syncStream(campaignId, stream, new Map(
      asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]),
    ))).map((offer) => offer.toObject());
    const active = offers.filter((offer) => offer.active);
    const ids = new Set(active.map((offer) => asNumber(offer.offerId)));
    if (shares.size !== ids.size || [...shares.keys()].some((id) => !ids.has(asNumber(id)))) {
      throw new ServiceError(400, "Нужно передать доли для всех активных офферов потока");
    }
    for (const offer of active) {
      const share = shares.get(asNumber(offer.offerId));
      if (!Number.isInteger(share) || share < 0 || share > 100) {
        throw new ServiceError(400, "Доля должна быть целым числом от 0 до 100");
      }
      if (offer.pinned && share !== offer.share) {
        throw new ServiceError(409, `Открепите оффер ${offer.offerId}, чтобы изменить его долю`);
      }
      offer.share = share;
    }
    const sum = active.reduce((total, offer) => total + offer.share, 0);
    if (sum !== 100) throw new ServiceError(400, `Сумма долей должна быть 100%, сейчас ${sum}%`);
    for (const offer of active) offer.lastShare = offer.share;
    return this._saveOffers(campaignId, streamId, offers, "shares", null);
  }

  async setOfferShare(campaignId, streamId, offerId, share) {
    const stream = await this._offerStream(campaignId, streamId);
    const offers = (await this._syncStream(campaignId, stream, new Map(
      asArray(await this.client.listOffers()).map((offer) => [asNumber(offer.id), offer]),
    ))).map((offer) => offer.toObject());
    const target = offers.find((offer) => asNumber(offer.offerId) === asNumber(offerId));
    if (!target?.active) throw new ServiceError(404, `Активный оффер ${offerId} не найден`);
    if (target.pinned) throw new ServiceError(409, "Сначала открепите оффер, чтобы изменить его долю");
    if (!Number.isInteger(share) || share < 0 || share > 100) {
      throw new ServiceError(400, "Доля должна быть целым числом от 0 до 100");
    }
    const pinnedTotal = offers.filter((offer) => offer.active && offer.pinned)
      .reduce((sum, offer) => sum + offer.share, 0);
    const remaining = 100 - pinnedTotal - share;
    const others = offers.filter((offer) => offer.active && !offer.pinned && offer.offerId !== target.offerId);
    if (remaining < 0 || (!others.length && remaining !== 0)) {
      throw new ServiceError(400, "Долю нельзя изменить, не нарушив закреплённые проценты");
    }
    target.share = share;
    target.lastShare = share;
    const nextShares = redistribute(others.map((offer) => offer.share), remaining);
    others.forEach((offer, index) => {
      offer.share = nextShares[index];
      offer.lastShare = nextShares[index];
    });
    return this._saveOffers(campaignId, streamId, offers, "shares", offerId);
  }
}
