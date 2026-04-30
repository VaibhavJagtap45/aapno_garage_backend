const PurchaseOrder = require("../models/PurchaseOrder.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");

async function nextOrderNo(garageId) {
  const count = await PurchaseOrder.countDocuments({ garageId });
  return `PO-${String(count + 1).padStart(5, "0")}`;
}

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/purchase-orders?status=&page=&limit=
// ─────────────────────────────────────────────────────────────────
const listPurchaseOrders = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { status, page = 1, limit = 50 } = req.query;
  const filter = { garageId, isDeleted: false };
  if (status) filter.status = status;

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [orders, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .populate("vendorId", "fullName phoneNo")
      .populate("repairOrderId", "orderNo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    PurchaseOrder.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Purchase orders fetched.", {
    orders,
    total,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/purchase-orders
// ─────────────────────────────────────────────────────────────────
const createPurchaseOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const {
    vendorId = null,
    repairOrderId = null,
    items = [],
    comments = null,
    notifyVendor = false,
    totalAmount = 0,
  } = req.body;

  if (!items.length)
    return sendError(res, 400, "At least one part/item is required.");

  // Validate each item has partName + quantity
  for (const item of items) {
    if (!item.partName?.trim())
      return sendError(res, 400, "Each item must have a partName.");
    if (!item.quantity || item.quantity < 1)
      return sendError(res, 400, "Each item must have quantity ≥ 1.");
  }

  const orderNo = await nextOrderNo(garageId);

  const order = await PurchaseOrder.create({
    garageId,
    orderNo,
    vendorId: vendorId || null,
    repairOrderId: repairOrderId || null,
    items: items.map((it) => ({
      inventoryId: it.inventoryId || null,
      partCode: it.partCode || null,
      partName: it.partName.trim(),
      quantity: Number(it.quantity) || 1,
      unitPrice: Number(it.unitPrice) || 0,
      lineTotal: Number(it.lineTotal) || 0,
    })),
    comments: comments || null,
    notifyVendor: Boolean(notifyVendor),
    totalAmount: Number(totalAmount) || 0,
    createdBy: req.user._id,
    status: "draft",
  });

  return sendSuccess(res, 201, "Purchase order created.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/purchase-orders/:id
// ─────────────────────────────────────────────────────────────────
const updatePurchaseOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const order = await PurchaseOrder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!order) return sendError(res, 404, "Purchase order not found.");

  const allowed = [
    "vendorId",
    "repairOrderId",
    "items",
    "comments",
    "notifyVendor",
    "totalAmount",
    "status",
  ];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) order[k] = req.body[k];
  });

  await order.save();
  return sendSuccess(res, 200, "Purchase order updated.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/purchase-orders/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────
const deletePurchaseOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const order = await PurchaseOrder.findOneAndUpdate(
    { _id: req.params.id, garageId, isDeleted: false },
    { isDeleted: true },
    { returnDocument: "after" },
  );

  if (!order) return sendError(res, 404, "Purchase order not found.");
  return sendSuccess(res, 200, "Purchase order deleted.");
});

// GET /api/v1/purchase-orders/vendors-due
// Returns vendors that have draft/sent POs with outstanding amounts
const getVendorsDue = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const orders = await PurchaseOrder.find({
    garageId,
    isDeleted: false,
    status: { $in: ["draft", "sent"] },
    vendorId: { $ne: null },
  })
    .populate("vendorId", "fullName phoneNo emailId")
    .lean();

  // Group by vendorId
  const map = {};
  for (const order of orders) {
    const vid = String(order.vendorId?._id);
    if (!map[vid]) {
      map[vid] = {
        vendor:     order.vendorId,
        totalDue:   0,
        orderCount: 0,
      };
    }
    map[vid].totalDue   += order.totalAmount || 0;
    map[vid].orderCount += 1;
  }

  return sendSuccess(res, 200, "Vendors due fetched.", {
    vendors: Object.values(map).sort((a, b) => b.totalDue - a.totalDue),
  });
});

module.exports = {
  listPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getVendorsDue,
};
