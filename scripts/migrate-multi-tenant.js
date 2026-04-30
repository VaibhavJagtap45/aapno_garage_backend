#!/usr/bin/env node
// scripts/migrate-multi-tenant.js
//
// One-shot migration to convert the existing single-garage-per-owner data
// into the multi-tenant model.
//
// Run with:
//   node scripts/migrate-multi-tenant.js
//   node scripts/migrate-multi-tenant.js --dry-run
//
// Idempotent: safe to re-run.
//
// Steps:
//   1. Drop the unique index on Garage.owner (owners may now have many garages).
//   2. For every owner with exactly one garage:
//        - set User.activeGarageId = that garage._id
//        - set User.garage         = that garage._id (legacy field, if missing)
//        - mark that garage as isPrimaryBranch
//   3. For owners with multiple garages (shouldn't exist pre-migration but
//      handled defensively):
//        - pick the oldest as primary
//        - set User.activeGarageId to that one
//   4. Backfill User.franchiseId from their primary garage.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { connectDB } = require("../config/dbConnect");
const Garage = require("../models/Garage.model");
const User = require("../models/User.model");

const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  // eslint-disable-next-line no-console
  console.log("[migrate]", ...args);
}

async function dropUniqueOwnerIndex() {
  const indexes = await Garage.collection.indexes();
  const ownerIdx = indexes.find(
    (i) =>
      i.key &&
      Object.keys(i.key).length === 1 &&
      i.key.owner === 1 &&
      i.unique,
  );
  if (!ownerIdx) {
    log("✓ Garage.owner unique index already absent.");
    return;
  }
  log(`→ Dropping unique index '${ownerIdx.name}' on Garage.owner`);
  if (!DRY_RUN) {
    await Garage.collection.dropIndex(ownerIdx.name);
  }
}

async function backfillOwners() {
  const garages = await Garage.find()
    .sort({ owner: 1, isPrimaryBranch: -1, createdAt: 1 })
    .select("_id owner franchiseId isPrimaryBranch createdAt")
    .lean();

  // Group by owner
  const byOwner = new Map();
  for (const g of garages) {
    const k = String(g.owner);
    if (!byOwner.has(k)) byOwner.set(k, []);
    byOwner.get(k).push(g);
  }

  let touchedUsers = 0;
  let touchedGarages = 0;

  for (const [ownerId, list] of byOwner) {
    // Pick a primary: existing flagged primary, else oldest
    let primary = list.find((g) => g.isPrimaryBranch) || list[0];

    if (!primary.isPrimaryBranch) {
      log(`→ Marking garage ${primary._id} as primary for owner ${ownerId}`);
      if (!DRY_RUN) {
        await Garage.updateOne(
          { _id: primary._id },
          { $set: { isPrimaryBranch: true } },
        );
      }
      touchedGarages++;
    }

    // Demote any other "primary" rows (data hygiene)
    const otherPrimaries = list.filter(
      (g) => g.isPrimaryBranch && String(g._id) !== String(primary._id),
    );
    for (const g of otherPrimaries) {
      log(`→ Demoting non-primary marked garage ${g._id}`);
      if (!DRY_RUN) {
        await Garage.updateOne(
          { _id: g._id },
          { $set: { isPrimaryBranch: false } },
        );
      }
      touchedGarages++;
    }

    // Update owner
    const update = {
      activeGarageId: primary._id,
      garage: primary._id,
    };
    if (primary.franchiseId) update.franchiseId = primary.franchiseId;

    log(`→ Owner ${ownerId} → activeGarageId=${primary._id}`);
    if (!DRY_RUN) {
      await User.updateOne({ _id: ownerId }, { $set: update });
    }
    touchedUsers++;
  }

  log(
    `✓ Backfill complete. owners=${touchedUsers}, garage-flag-updates=${touchedGarages}.`,
  );
}

async function main() {
  log(DRY_RUN ? "Running in DRY-RUN mode (no writes)." : "Live mode.");
  await connectDB();
  try {
    await dropUniqueOwnerIndex();
    await backfillOwners();
    log("✓ Migration finished.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
