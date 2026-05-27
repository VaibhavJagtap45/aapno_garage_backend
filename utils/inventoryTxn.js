// utils/inventoryTxn.js
// ─────────────────────────────────────────────────────────────────
//  Transaction-safe inventory adjustments.
//
//  Why this exists
//  ───────────────
//  Invoice creation/update writes line items AND decrements stock.
//  Doing those as two separate operations leaks two failure modes:
//    1. Invoice succeeds, stock decrement fails → stock drifts up.
//    2. Concurrent invoices race past the same `quantityInHand` and
//       drive stock negative with $inc.
//
//  The fix
//  ───────
//  • Pre-flight check: aggregate net delta per part, refuse the
//    write if any net consumption exceeds quantityInHand.
//  • Atomic conditional update: `{_id, garageId, quantityInHand >= consumed}`
//    so two parallel writers can never both pass the check.
//  • Mongo session: caller wraps invoice doc + inventory updates in
//    one transaction. Requires a replica set / Atlas.
//
//  `manageInventory: false` parts are skipped (consumables we don't
//  track), and parts with no inventoryId (manual/free-text) are also
//  skipped — there's nothing to debit.
// ─────────────────────────────────────────────────────────────────

const Inventory = require("../models/Inventry.model");

class StockError extends Error {
  constructor(message, details = null, status = 409) {
    super(message);
    this.name = "StockError";
    this.status = status;
    this.details = details;
  }
}

function quantityMap(lines = []) {
  const map = new Map();
  for (const line of lines) {
    if (!line?.inventoryId) continue;
    const key = String(line.inventoryId);
    const qty = Number(line.quantity) || 0;
    if (qty <= 0) continue;
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

// Per-inventoryId delta = next consumption - previous consumption.
// delta > 0  → we need that many MORE units (must verify stock).
// delta < 0  → we are returning units (always safe).
function buildDeltaMap(previousParts = [], nextParts = []) {
  const previous = quantityMap(previousParts);
  const next = quantityMap(nextParts);
  const ids = new Set([...previous.keys(), ...next.keys()]);
  const deltas = new Map();
  for (const id of ids) {
    const delta = (next.get(id) || 0) - (previous.get(id) || 0);
    if (delta !== 0) deltas.set(id, delta);
  }
  return deltas;
}

// Validate stock availability BEFORE we attempt to debit. We still
// rely on the conditional $inc below to enforce atomicity, but this
// produces a clean per-part error response when the caller is asking
// for more than we have.
async function assertStockAvailable({ garageId, deltas, session }) {
  const ids = [...deltas.keys()].filter((id) => (deltas.get(id) || 0) > 0);
  if (!ids.length) return;

  const items = await Inventory.find(
    { _id: { $in: ids }, garageId, manageInventory: true },
    { _id: 1, partName: 1, quantityInHand: 1 },
  )
    .session(session ?? null)
    .lean();

  const itemsById = new Map(items.map((i) => [String(i._id), i]));
  const shortages = [];

  for (const id of ids) {
    const need = deltas.get(id);
    const item = itemsById.get(id);
    // Part not found in this garage → caller passed an inventoryId
    // that doesn't belong to us, or it's a free-text part. Skip rather
    // than fail: applyInventoryDelta's update will be a no-op.
    if (!item) continue;
    if (item.quantityInHand < need) {
      shortages.push({
        inventoryId: id,
        partName: item.partName,
        available: item.quantityInHand,
        requested: need,
      });
    }
  }

  if (shortages.length) {
    throw new StockError(
      `Insufficient stock for ${shortages.length} part(s).`,
      { shortages },
      409,
    );
  }
}

// Apply the deltas with a guarded conditional $inc:
//   { _id, garageId, quantityInHand: { $gte: delta } }
// If the doc no longer satisfies the guard (someone else raced past),
// the update writes 0 rows and we abort the transaction.
async function applyInventoryDelta({
  garageId,
  previousParts = [],
  nextParts = [],
  session,
}) {
  const deltas = buildDeltaMap(previousParts, nextParts);
  if (!deltas.size) return;

  await assertStockAvailable({ garageId, deltas, session });

  const now = new Date();
  for (const [inventoryId, delta] of deltas) {
    const filter = { _id: inventoryId, garageId, manageInventory: true };
    if (delta > 0) filter.quantityInHand = { $gte: delta };

    const update = { $inc: { quantityInHand: -delta } };
    if (delta > 0) update.$set = { lastUsedAt: now };

    const result = await Inventory.updateOne(filter, update, {
      session: session ?? null,
    });

    // matchedCount === 0 means either:
    //   • the part isn't manageInventory:true (silently skipped — fine)
    //   • OR a concurrent writer drained stock below our guard
    // The first case is benign; the second has to abort the txn so
    // we don't oversell. We can't distinguish them cheaply, so we
    // re-check the row only when delta > 0 (the unsafe direction).
    if (delta > 0 && result.matchedCount === 0) {
      const fresh = await Inventory.findOne(
        { _id: inventoryId, garageId },
        { manageInventory: 1, quantityInHand: 1, partName: 1 },
      )
        .session(session ?? null)
        .lean();
      if (fresh?.manageInventory) {
        throw new StockError(
          `Stock changed concurrently for "${fresh.partName}". Please retry.`,
          {
            inventoryId,
            available: fresh.quantityInHand,
            requested: delta,
          },
          409,
        );
      }
    }
  }
}

module.exports = {
  StockError,
  applyInventoryDelta,
  buildDeltaMap,
};
