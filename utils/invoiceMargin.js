// utils/invoiceMargin.js
// ─────────────────────────────────────────────────────────────────
//  Shared margin / cost-of-goods helpers used by both the live invoice
//  controller and the historical back-fill script, so the formula lives
//  in exactly one place.
//
//    partsCost    = Σ(line.costPrice × line.quantity)   — cost of goods sold
//    marginAmount = (totalAmount − taxAmount) − partsCost
//      Tax is a pass-through (not profit); the full service price counts
//      as margin since services carry no cost of goods.
// ─────────────────────────────────────────────────────────────────

const Inventory = require("../models/Inventry.model");

// Stamp each part line with its authoritative cost (Inventory.purchasePrice for
// stock-linked parts, else the line's existing costPrice) and return the total
// parts cost. Snapshotting keeps margin stable if the part's cost changes later.
async function stampPartCosts(garageId, parts = []) {
  const ids = parts.map((p) => p.inventoryId).filter(Boolean);
  let costByInventory = {};
  if (ids.length) {
    const items = await Inventory.find({ _id: { $in: ids }, garageId })
      .select("_id purchasePrice")
      .lean();
    costByInventory = Object.fromEntries(
      items.map((i) => [String(i._id), Number(i.purchasePrice) || 0]),
    );
  }

  let partsCost = 0;
  const stamped = parts.map((p) => {
    const fromInv = p.inventoryId ? costByInventory[String(p.inventoryId)] : undefined;
    const cost = fromInv !== undefined ? fromInv : Number(p.costPrice) || 0;
    partsCost += cost * (Number(p.quantity) || 1);
    return { ...p, costPrice: cost };
  });

  return { parts: stamped, partsCost: Number(partsCost.toFixed(2)) };
}

// margin = revenue (ex-tax) − parts cost.
function computeMargin(totalAmount, taxAmount, partsCost) {
  return Number(
    ((Number(totalAmount) || 0) - (Number(taxAmount) || 0) - (Number(partsCost) || 0)).toFixed(2),
  );
}

module.exports = { stampPartCosts, computeMargin };
