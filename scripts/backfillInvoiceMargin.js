// scripts/backfillInvoiceMargin.js
// ─────────────────────────────────────────────────────────────────
//  One-off back-fill: stamp costPrice / partsCost / marginAmount onto
//  invoices created before the margin feature shipped.
//
//  Uses the same helpers as the live controller (utils/invoiceMargin) so
//  back-filled values match newly-created invoices exactly.
//
//  Usage (from garage-system-backend/):
//    node scripts/backfillInvoiceMargin.js --dry-run   # report only, no writes
//    node scripts/backfillInvoiceMargin.js             # apply to historical
//    node scripts/backfillInvoiceMargin.js --all       # recompute EVERY invoice
//
//  Idempotent: re-running produces the same result. By default it only
//  touches invoices missing the margin fields; --all forces a recompute.
// ─────────────────────────────────────────────────────────────────

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Invoice = require("../models/Invoice.model");
const { stampPartCosts, computeMargin } = require("../utils/invoiceMargin");

const DRY_RUN = process.argv.includes("--dry-run");
const ALL = process.argv.includes("--all");

(async () => {
  if (!process.env.MONGO_URL) {
    console.error("MONGO_URL is not set (check garage-system-backend/.env). Aborting.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 8000,
    family: 4,
  });
  console.log(
    `Connected. Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "WRITE"} · ` +
      `Scope: ${ALL ? "ALL invoices" : "invoices missing margin fields"}`,
  );

  // Default scope: only historical invoices that never had margin computed.
  // New invoices always have both fields (even if 0), so this skips them.
  const filter = ALL
    ? {}
    : { $or: [{ marginAmount: { $exists: false } }, { partsCost: { $exists: false } }] };

  const total = await Invoice.countDocuments(filter);
  console.log(`Invoices to process: ${total}`);
  if (total === 0) {
    console.log("Nothing to back-fill. ✅");
    await mongoose.disconnect();
    process.exit(0);
  }

  let processed = 0;
  let updated = 0;
  let sumMargin = 0;
  let sumPartsCost = 0;

  const cursor = Invoice.find(filter).lean().cursor();
  for (let inv = await cursor.next(); inv != null; inv = await cursor.next()) {
    processed += 1;

    const { parts, partsCost } = await stampPartCosts(inv.garageId, inv.parts || []);
    const marginAmount = computeMargin(inv.totalAmount, inv.taxAmount, partsCost);
    sumMargin += marginAmount;
    sumPartsCost += partsCost;

    if (!DRY_RUN) {
      await Invoice.updateOne(
        { _id: inv._id },
        { $set: { parts, partsCost, marginAmount } },
      );
      updated += 1;
    }

    if (processed % 100 === 0) {
      console.log(`  …processed ${processed}/${total}`);
    }
  }

  console.log("─".repeat(52));
  console.log(`Processed:        ${processed}`);
  console.log(`${DRY_RUN ? "Would update:    " : "Updated:         "} ${DRY_RUN ? processed : updated}`);
  console.log(`Total parts cost: ₹${sumPartsCost.toFixed(2)}`);
  console.log(`Total margin:     ₹${sumMargin.toFixed(2)}`);
  if (DRY_RUN) {
    console.log("\nDRY-RUN — no documents were modified. Re-run without --dry-run to apply.");
  }

  await mongoose.disconnect();
  console.log("Done. ✅");
  process.exit(0);
})().catch(async (err) => {
  console.error("Back-fill failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
