import { KeitaroError } from "./errors.js";

export function normalizeBaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (url.endsWith("/admin")) url = url.slice(0, -6);
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export class KeitaroClient {
  constructor(baseUrl, apiKey, timeout = 20_000, fetchImpl = fetch) {
    const base = normalizeBaseUrl(baseUrl);
    if (!base || !apiKey) throw new Error("Не заданы KEITARO_BASE_URL / KEITARO_API_KEY в .env");
    this.baseUrl = `${base}/admin_api/v1`;
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.fetch = fetchImpl;
  }

  async request(method, path, { json, params } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value != null) url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    let response;
    let text;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          "Api-Key": this.apiKey,
          Accept: "application/json",
          ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      throw new KeitaroError(0, error.name === "AbortError" ? "Request timed out" : error.message, path);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new KeitaroError(response.status, text.slice(0, 600), path);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new KeitaroError(response.status, "Ответ не JSON — проверьте KEITARO_BASE_URL и API-ключ", path);
    }
  }

  listOffers() { return this.request("GET", "/offers"); }
  listDomains() { return this.request("GET", "/domains"); }
  listGroups(type = "campaigns") { return this.request("GET", "/groups", { params: { type } }); }
  listTrafficSources() { return this.request("GET", "/traffic_sources"); }
  listCampaigns() { return this.request("GET", "/campaigns"); }
  getCampaign(id) { return this.request("GET", `/campaigns/${id}`); }
  createCampaign(payload) { return this.request("POST", "/campaigns", { json: payload }); }
  deleteCampaign(id) { return this.request("DELETE", `/campaigns/${id}`); }
  campaignStreams(id) { return this.request("GET", `/campaigns/${id}/streams`); }
  getStream(id) { return this.request("GET", `/streams/${id}`); }
  createStream(payload) { return this.request("POST", "/streams", { json: payload }); }
  updateStream(id, payload) { return this.request("PUT", `/streams/${id}`, { json: payload }); }
  buildReport(payload) { return this.request("POST", "/report/build", { json: payload }); }
}
