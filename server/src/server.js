import mongoose from "mongoose";
import { config } from "./config.js";
import { createApp } from "./app.js";

try {
  await mongoose.connect(config.mongoUri);
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Keitaro wrapper API listening on http://localhost:${config.port}`);
  });
} catch (error) {
  console.error("Не удалось запустить приложение:", error);
  process.exitCode = 1;
}
