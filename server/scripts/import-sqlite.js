import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { CampaignRecord } from "../src/models/CampaignRecord.js";
import { CampaignOffer } from "../src/models/CampaignOffer.js";
import { OfferChange } from "../src/models/OfferChange.js";
import { LegacyImport } from "../src/models/LegacyImport.js";

const sqlitePath = resolve(process.argv[2] || process.env.LEGACY_SQLITE_PATH || "./app.db");
if (!existsSync(sqlitePath)) {
  console.error(
    `SQLite database not found: ${sqlitePath}\n` +
    "Pass the real path to an existing legacy app.db file. " +
    "If this is a fresh installation with no old SQLite database, skip the import.",
  );
  process.exitCode = 1;
} else {
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    await mongoose.connect(config.mongoUri);
    const migrationKey = `sqlite:${sqlitePath}`;
    const derivedStateImported = await LegacyImport.exists({ key: migrationKey });
    const tableExists = (name) => Boolean(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name));
    let importedCampaigns = 0;
    let importedChanges = 0;
    const campaignRows = tableExists("campaign_records")
      ? sqlite.prepare("SELECT * FROM campaign_records").all()
      : [];
    const changeRows = tableExists("offer_changes")
      ? sqlite.prepare("SELECT * FROM offer_changes ORDER BY created_at, id").all()
      : [];

    for (const row of campaignRows) {
      await CampaignRecord.findOneAndUpdate(
        { keitaroId: row.keitaro_id },
        {
          $setOnInsert: {
            name: row.name,
            geo: row.geo,
            offerId: row.offer_id,
            domainId: row.domain_id ?? undefined,
            groupId: row.group_id ?? undefined,
            sourceId: row.source_id ?? undefined,
            googleStreamId: row.google_stream_id ?? undefined,
            offerStreamId: row.offer_stream_id ?? undefined,
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          },
        },
        { upsert: true, new: true },
      );
      importedCampaigns += 1;
    }

    for (const row of changeRows) {
      await OfferChange.findOneAndUpdate(
        { legacyId: row.id },
        {
          $setOnInsert: {
            campaignId: row.campaign_id,
            streamId: row.stream_id,
            offerId: row.offer_id ?? undefined,
            action: row.action,
            sharesAfter: row.shares_after,
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          },
        },
        { upsert: true, new: true },
      );
      importedChanges += 1;
    }

    if (!derivedStateImported) {
      for (const row of campaignRows) {
        if (row.offer_stream_id == null || row.offer_id == null) continue;
        await CampaignOffer.findOneAndUpdate(
          { campaignId: row.keitaro_id, streamId: row.offer_stream_id, offerId: row.offer_id },
          {
            $setOnInsert: {
              name: `#${row.offer_id}`,
              share: 100,
              lastShare: 100,
              active: true,
              pinned: false,
            },
          },
          { upsert: true, new: true },
        );
      }

      for (const row of changeRows) {
        const snapshot = JSON.parse(row.shares_after);
        const entries = Object.entries(snapshot).map(([id, value]) => {
          const offerId = Number(id);
          const share = Number(typeof value === "object" && value !== null ? value.share : value);
          if (!Number.isSafeInteger(offerId) || !Number.isInteger(share) || share < 0 || share > 100) {
            throw new Error(`Invalid offer share snapshot in legacy offer_changes row ${row.id}`);
          }
          return [offerId, share];
        });
        const snapshotIds = new Set(entries.map(([offerId]) => offerId));
        const existing = await CampaignOffer.find({ campaignId: row.campaign_id, streamId: row.stream_id });
        for (const link of existing) {
          if (link.active && !snapshotIds.has(link.offerId)) {
            link.lastShare = link.share || link.lastShare;
            link.share = 0;
            link.active = false;
            link.pinned = false;
            await link.save();
          }
        }
        for (const [offerId, share] of entries) {
          await CampaignOffer.findOneAndUpdate(
            { campaignId: row.campaign_id, streamId: row.stream_id, offerId },
            {
              $set: { share, lastShare: share, active: true, pinned: false },
              $setOnInsert: { name: `#${offerId}` },
            },
            { upsert: true, new: true },
          );
        }
      }
      if (campaignRows.length || changeRows.length) await LegacyImport.create({ key: migrationKey });
    }

    console.log(`SQLite import complete: ${importedCampaigns} campaign records, ${importedChanges} offer changes.`);
  } catch (error) {
    console.error("SQLite import failed:", error);
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await mongoose.disconnect();
  }
}
