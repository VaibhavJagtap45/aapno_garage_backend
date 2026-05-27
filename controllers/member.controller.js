// controllers/member.controller.js
// All endpoints scoped to the authenticated member (req.user.role === "member")

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const RepairOrder = require("../models/RepairOrder.model");
const Inventory = require("../models/Inventry.model");
const User = require("../models/User.model");

// Valid status transitions a member can make
const STATUS_TRANSITIONS = {
  created: ["in_progress"],
  in_progress: ["vehicle_ready"],
  vehicle_ready: ["completed", "in_progress"],
};

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/member/dashboard
// ─────────────────────────────────────────────────────────────────
const getDashboard = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  if (!garageId) {
    return sendSuccess(res, 200, "Dashboard fetched.", {
      assignedCount: 0,
      inProgressCount: 0,
      completedTotal: 0,
      totalEarnings: 0,
    });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [assignedCount, inProgressCount, completedOrders] = await Promise.all([
    RepairOrder.countDocuments({
      garageId,
      assignedTo: req.user._id,
      status: "created",
      isDeleted: false,
    }),
    RepairOrder.countDocuments({
      garageId,
      assignedTo: req.user._id,
      status: "in_progress",
      isDeleted: false,
    }),
    RepairOrder.find({
      garageId,
      assignedTo: req.user._id,
      status: "completed",
      isDeleted: false,
    })
      .select("totalAmount createdAt")
      .lean(),
  ]);

  const completedToday = completedOrders.filter(
    (o) => new Date(o.createdAt) >= todayStart,
  ).length;

  const totalEarnings = completedOrders.reduce(
    (s, o) => s + (o.totalAmount || 0),
    0,
  );

  return sendSuccess(res, 200, "Dashboard fetched.", {
    assignedCount,
    inProgressCount,
    completedTotal: completedOrders.length,
    completedToday,
    totalEarnings,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/member/orders
//  Query: assignedToMe=true|false, status=, page=, limit=
// ─────────────────────────────────────────────────────────────────
const getOrders = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  if (!garageId)
    return sendSuccess(res, 200, "Orders fetched.", {
      orders: [],
      total: 0,
      page: 1,
    });

  const { assignedToMe, status, page = 1, limit = 20 } = req.query;
  const filter = { garageId, isDeleted: false };

  if (assignedToMe === "true") filter.assignedTo = req.user._id;
  if (status) {
    filter.status = status.includes(",") ? { $in: status.split(",") } : status;
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [orders, total] = await Promise.all([
    RepairOrder.find(filter)
      .populate("customerId", "fullName phoneNo")
      .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo")
      .populate("assignedTo", "fullName")
      .select(
        "orderNo status services parts totalAmount estimatedDeliveryAt customerNote assignedTo assignedAt createdAt",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    RepairOrder.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Orders fetched.", {
    orders,
    total,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/member/orders/:id
// ─────────────────────────────────────────────────────────────────
const getOrderDetail = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  if (!garageId) return sendError(res, 400, "Not linked to any garage.");

  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  })
    .populate("customerId", "fullName phoneNo emailId")
    .populate(
      "vehicleId",
      "vehicleBrand vehicleModel vehicleRegisterNo vehicleVariant vehicleKmDriven",
    )
    .populate("assignedTo", "fullName phoneNo")
    .lean();

  if (!order) return sendError(res, 404, "Order not found.");
  return sendSuccess(res, 200, "Order fetched.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/member/orders/:id/accept
//  Accept an assignment (status: created → in_progress)
// ─────────────────────────────────────────────────────────────────
const acceptOrder = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    assignedTo: req.user._id,
    isDeleted: false,
  });

  if (!order)
    return sendError(res, 404, "Order not found or not assigned to you.");
  if (order.status !== "created")
    return sendError(res, 400, "Can only accept orders in 'created' status.");

  order.status = "in_progress";
  order.assignedAt = new Date();
  await order.save();

  return sendSuccess(res, 200, "Order accepted. Status set to in_progress.", {
    order,
  });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/member/orders/:id/reject
//  Reject assignment — removes assignedTo so owner can reassign
// ─────────────────────────────────────────────────────────────────
const rejectOrder = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    assignedTo: req.user._id,
    isDeleted: false,
  });

  if (!order)
    return sendError(res, 404, "Order not found or not assigned to you.");
  if (order.status !== "created")
    return sendError(res, 400, "Can only reject orders in 'created' status.");

  order.assignedTo = null;
  order.assignedAt = null;
  await order.save();

  return sendSuccess(res, 200, "Assignment rejected.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/member/orders/:id/status
//  Body: { status: "in_progress" | "vehicle_ready" | "completed" }
// ─────────────────────────────────────────────────────────────────
const updateOrderStatus = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  const { status } = req.body;

  if (!status) return sendError(res, 400, "status is required.");

  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });

  if (!order) return sendError(res, 404, "Order not found.");

  const allowed = STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return sendError(
      res,
      400,
      `Cannot transition from '${order.status}' to '${status}'. Allowed: ${allowed.join(", ") || "none"}.`,
    );
  }

  order.status = status;
  // Auto-assign to this member if not yet assigned
  if (!order.assignedTo) {
    order.assignedTo = req.user._id;
    order.assignedAt = new Date();
  }
  await order.save();

  return sendSuccess(res, 200, "Status updated.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/member/orders/:id/parts
//  Replace the parts array on the order and recompute totals
//  Body: { parts: [{ inventoryId?, partCode?, name, quantity, unitPrice, discount, taxPercent }] }
// ─────────────────────────────────────────────────────────────────
const updateOrderParts = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  const { parts } = req.body;

  if (!Array.isArray(parts)) {
    return sendError(res, 400, "parts must be an array.");
  }

  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });

  if (!order) return sendError(res, 404, "Order not found.");
  if (!["in_progress", "vehicle_ready"].includes(order.status)) {
    return sendError(
      res,
      400,
      "Parts can only be updated on in_progress or vehicle_ready orders.",
    );
  }

  const partLines = await Promise.all(
    parts.map(async (p) => {
      const unitPrice = Math.max(Number(p.unitPrice) || 0, 0);
      const quantity = Math.max(Number(p.quantity) || 1, 1);
      const discount = Math.max(Number(p.discount) || 0, 0);
      const taxPercent = Math.max(Number(p.taxPercent) || 0, 0);

      let inventoryId = p.inventoryId || null;
      let partCode = p.partCode || null;
      let name = String(p.name || "Part").trim();

      const manual =
        String(p.entryMode || "").toLowerCase() === "manual" || !inventoryId;

      if (manual) {
        const existing = await Inventory.findOne({
          garageId,
          $or: [
            { partName: new RegExp(`^${escapeRegex(name)}$`, "i") },
            ...(partCode
              ? [{ partCode: new RegExp(`^${escapeRegex(partCode)}$`, "i") }]
              : []),
          ],
        })
          .select("_id partName partCode sellingPrice")
          .lean();

        let inventoryItem = existing;

        if (!inventoryItem) {
          inventoryItem = await Inventory.create({
            garageId,
            partName: name,
            partCode: partCode ? String(partCode).trim().toUpperCase() : null,
            category: "general",
            brand: null,
            manufacturer: null,
            unit: "pcs",
            description: null,
            quantityInHand: 0,
            minimumStockLevel: 5,
            purchasePrice: 0,
            sellingPrice: unitPrice,
            taxPercent,
            manageInventory: false,
            applicability: "generic",
            applicableBrands: [],
            applicableModels: [],
            isActive: true,
          });
        }

        inventoryId = inventoryItem._id;
        name = inventoryItem.partName;
        partCode = inventoryItem.partCode || partCode;
      }

      const subtotal = unitPrice * quantity - discount;
      const lineTotal = Math.max(subtotal + (subtotal * taxPercent) / 100, 0);

      return {
        inventoryId: inventoryId || null,
        partCode: partCode || null,
        name,
        quantity,
        unitPrice,
        discount,
        taxPercent,
        lineTotal,
      };
    }),
  );

  const partsTotal = partLines.reduce((s, p) => s + p.lineTotal, 0);
  const servicesTotal = (order.services || []).reduce(
    (s, line) => s + (Number(line?.lineTotal) || 0),
    0,
  );
  const taxTotal = partLines.reduce((s, p) => {
    const sub = p.unitPrice * p.quantity - p.discount;
    return s + (sub * p.taxPercent) / 100;
  }, 0);

  order.parts = partLines;
  order.partsTotal = partsTotal;
  order.servicesTotal = servicesTotal;
  order.taxTotal = taxTotal;
  order.totalAmount = servicesTotal + partsTotal;
  await order.save();

  return sendSuccess(res, 200, "Parts updated.", { order });
});
// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/member/inventory?search=&category=&page=&limit=
//  Read-only view of garage inventory (needed to add parts to orders)
// ─────────────────────────────────────────────────────────────────
const getInventory = asyncHandler(async (req, res) => {
  const garageId = req.user.garage;
  if (!garageId)
    return sendSuccess(res, 200, "Inventory fetched.", {
      items: [],
      total: 0,
      categories: [],
      page: 1,
    });

  const { search, category, page = 1, limit = 50 } = req.query;
  const filter = { garageId, isActive: true };
  if (category) filter.category = category.trim();
  if (search?.trim())
    filter.partName = { $regex: search.trim(), $options: "i" };

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [items, total, categories] = await Promise.all([
    Inventory.find(filter)
      .select(
        "partName partCode category sellingPrice taxPercent quantityInHand unit manufacturer",
      )
      .sort({ category: 1, partName: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Inventory.countDocuments(filter),
    Inventory.distinct("category", { garageId, isActive: true }),
  ]);

  return sendSuccess(res, 200, "Inventory fetched.", {
    items,
    total,
    categories,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET  /api/v1/member/profile
//  PUT  /api/v1/member/profile
// ─────────────────────────────────────────────────────────────────
const getMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select("-otp -refreshToken")
    .lean();
  return sendSuccess(res, 200, "Profile fetched.", { user });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const { fullName, address, state } = req.body;
  const update = {};
  if (fullName?.trim()) update.fullName = fullName.trim();
  if (address !== undefined) update.address = address?.trim() || null;
  if (state !== undefined) update.state = state?.trim() || null;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: update },
    { returnDocument: "after", runValidators: true },
  )
    .select("-otp -refreshToken")
    .lean();

  return sendSuccess(res, 200, "Profile updated.", { user });
});

module.exports = {
  getDashboard,
  getOrders,
  getOrderDetail,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
  updateOrderParts,
  getInventory,
  getMyProfile,
  updateMyProfile,
};
