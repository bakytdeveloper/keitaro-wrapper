import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env") });

export const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/keitaro_wrapper",
  keitaroBaseUrl: process.env.KEITARO_BASE_URL || "",
  keitaroApiKey: process.env.KEITARO_API_KEY || "",
  keitaroTimeout: Number(process.env.KEITARO_TIMEOUT || 20_000),
  defaultGroupName: process.env.DEFAULT_GROUP_NAME || "FORTESTS",
  defaultSourceName: process.env.DEFAULT_SOURCE_NAME || "FORTESTS",
  defaultDomain: process.env.DEFAULT_DOMAIN || "",
  googleUrl: process.env.GOOGLE_URL || "https://www.google.com",
};
