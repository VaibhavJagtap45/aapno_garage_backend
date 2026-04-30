const StockIn = require("../models/StockIn.model");
const Inventory = require("../models/Inventry.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const { resolveFranchiseAccountsScope, garageFilter } = require("../utils/resolveFranchiseAccountsScope");

const listStockIn = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { page = 1, limit = 50 } = req.query;
  const safePage  = Math.max(Number(page)  || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const filter = { garageId: garageFilter(scope), isDeleted: false };

  const [records, total] = await Promise.all([
    StockIn.find(filter)
      .populate("vendorId", "fullName phoneNo")
      .populate("purchaseOrderId", "orderNo")
      .populate("garageId", "garageName")
      .sort({ date: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    StockIn.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Stock-in records fetched.", {
    records, total, page: safePage,
    isFranchiseView: scope.isFranchiseView,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/stock-in
//  Also increments Inventory.quantityInHand for each item
// ─────────────────────────────────────────────────────────────────
const createStockIn = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const {
    vendorId,
    purchaseOrderId,
    invoiceNo,
    date,
    paymentChannel,
    paidAmount,
    totalAmount,
    items = [],
  } = req.body;

  if (!items.length) return sendError(res, 400, "At least one item is required.");
  if (!date)         return sendError(res, 400, "date is required.");

  for (const item of items) {
    if (!item.partName?.trim())  return sendError(res, 400, "Each item must have a partName.");
    if (!item.quantityAdded || item.quantityAdded < 1)
      return sendError(res, 400, "Each item must have quantityAdded ≥ 1.");
  }

  const stockIn = await StockIn.create({
    garageId,
    vendorId:        vendorId        || null,
    purchaseOrderId: purchaseOrderId || null,
    invoiceNo:       invoiceNo?.trim() || "",
    date:            new Date(date),
    paymentChannel:  paymentChannel  || "CASH",
    paidAmount:      Number(paidAmount)  || 0,
    totalAmount:     Number(totalAmount) || 0,
    items: items.map((it) => ({
      inventoryId:   it.inventoryId   || null,
      partCode:      it.partCode      || null,
      partName:      it.partName.trim(),
      quantityAdded: Number(it.quantityAdded) || 1,
      purchasePrice: Number(it.purchasePrice) || 0,
      sellingPrice:  Number(it.sellingPrice)  || 0,
      lineTotal:     Number(it.lineTotal)     || 0,
    })),
  });

  // Increment stock for each item that has a known inventoryId
  const updatePromises = items
    .filter((it) => it.inventoryId)
    .map((it) =>
      Inventory.findOneAndUpdate(
        { _id: it.inventoryId, garageId },
        {
          $inc:  { quantityInHand: Number(it.quantityAdded) || 1 },
          $set:  {
            purchasePrice:    Number(it.purchasePrice) || undefined,
            lastPurchasedAt:  new Date(date),
          },
        },
      ),
    );
  await Promise.all(updatePromises);

  return sendSuccess(res, 201, "Stock-in recorded.", { stockIn });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/stock-in/:id  (soft delete, does NOT reverse stock)
// ─────────────────────────────────────────────────────────────────
const deleteStockIn = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const record = await StockIn.findOne({ _id: req.params.id, garageId, isDeleted: false });
  if (!record) return sendError(res, 404, "Stock-in record not found.");

  record.isDeleted = true;
  await record.save();

  return sendSuccess(res, 200, "Stock-in record deleted.");
});

const getStockInStats = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo } = req.query;
  const filter = { garageId: garageFilter(scope), isDeleted: false };
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo)   filter.date.$lte = new Date(dateTo);
  }

  const [result] = await StockIn.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: "$totalAmount" },
        paid:  { $sum: "$paidAmount" },
      },
    },
  ]);

  const total  = result?.total ?? 0;
  const paid   = result?.paid  ?? 0;
  const credit = Math.max(total - paid, 0);

  return sendSuccess(res, 200, "StockIn stats fetched.", { total, paid, credit });
});

module.exports = { listStockIn, createStockIn, deleteStockIn, getStockInStats };
