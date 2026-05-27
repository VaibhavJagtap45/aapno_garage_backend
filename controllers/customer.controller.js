// controllers/customer.controller.js
// All endpoints scoped to the authenticated customer (req.user.role === "customer")

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const RepairOrder = require("../models/RepairOrder.model");
const Invoice = require("../models/Invoice.model");
const Vehicle = require("../models/Vehicle.model");
const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const GarageServiceCatalog = require("../models/GarageServiceCatalog.model");
const { notifyUser, TEMPLATES } = require("../services/pushNotification.service");

// ─── Helper ────────────────────────────────────────────────────────
function garageId(user) {
  return user.garage ?? null;
}

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/garage-info
// ─────────────────────────────────────────────────────────────────
const getGarageInfo = asyncHandler(async (req, res) => {
  const gid = garageId(req.user);
  if (!gid)
    return sendError(
      res,
      400,
      "Your account is not linked to any garage. Please contact your garage.",
    );

  const garage = await Garage.findById(gid)
    .select(
      "garageName garageOwnerName garageAddress garageContactNumber garageLogo garageType",
    )
    .lean();

  if (!garage) return sendError(res, 404, "Garage not found.");
  return sendSuccess(res, 200, "Garage info fetched.", { garage });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/services?category=&search=&page=&limit=
// ─────────────────────────────────────────────────────────────────
const getServices = asyncHandler(async (req, res) => {
  const gid = garageId(req.user);
  if (!gid)
    return sendSuccess(res, 200, "Services fetched.", {
      services: [],
      total: 0,
      categories: [],
      page: 1,
    });

  const { category, search, page = 1, limit = 50 } = req.query;
  const filter = { garageId: gid, isActive: true, isDeleted: false };
  if (category) filter.category = category.trim();
  if (search?.trim()) filter.name = { $regex: search.trim(), $options: "i" };

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [services, total, categories] = await Promise.all([
    GarageServiceCatalog.find(filter)
      .select("name category mrp serviceNo applicableBrands applicableModels")
      .sort({ category: 1, name: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    GarageServiceCatalog.countDocuments(filter),
    GarageServiceCatalog.distinct("category", {
      garageId: gid,
      isActive: true,
      isDeleted: false,
    }),
  ]);

  return sendSuccess(res, 200, "Services fetched.", {
    services,
    total,
    categories,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/vehicles
// ─────────────────────────────────────────────────────────────────
const getMyVehicles = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({ user: req.user._id })
    .select(
      "vehicleBrand vehicleModel vehicleRegisterNo vehicleVariant vehiclePurchaseDate vehicleKmDriven",
    )
    .sort({ createdAt: -1 })
    .lean();
  return sendSuccess(res, 200, "Vehicles fetched.", { vehicles });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/customer/vehicles
// ─────────────────────────────────────────────────────────────────
const addMyVehicle = asyncHandler(async (req, res) => {
  const {
    vehicleBrand,
    vehicleModel,
    vehicleRegisterNo,
    vehicleVariant,
    vehicleKmDriven,
  } = req.body;
  if (!vehicleBrand || !vehicleModel || !vehicleRegisterNo)
    return sendError(
      res,
      400,
      "vehicleBrand, vehicleModel, and vehicleRegisterNo are required.",
    );

  // Validate km if provided
  let kmDriven;
  if (vehicleKmDriven !== undefined && vehicleKmDriven !== null && vehicleKmDriven !== "") {
    const parsed = Number(vehicleKmDriven);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return sendError(res, 400, "vehicleKmDriven must be a non-negative number.");
    }
    kmDriven = Math.floor(parsed);
  }

  const regNo = vehicleRegisterNo.toUpperCase().replace(/\s/g, "");
  const existing = await Vehicle.findOne({ vehicleRegisterNo: regNo });
  if (existing)
    return sendError(
      res,
      409,
      "A vehicle with this registration number already exists.",
    );

  const vehicle = await Vehicle.create({
    user: req.user._id,
    vehicleBrand: vehicleBrand.trim(),
    vehicleModel: vehicleModel.trim(),
    vehicleRegisterNo: regNo,
    vehicleVariant: vehicleVariant?.trim() || null,
    ...(kmDriven !== undefined && { vehicleKmDriven: kmDriven }),
  });

  return sendSuccess(res, 201, "Vehicle added.", { vehicle });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/orders?status=&page=&limit=
// ─────────────────────────────────────────────────────────────────
const getMyOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { customerId: req.user._id, isDeleted: false };
  if (status) filter.status = status;

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [orders, total] = await Promise.all([
    RepairOrder.find(filter)
      .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo")
      .populate("assignedTo", "fullName")
      .select(
        "orderNo status services parts totalAmount scheduledAt estimatedDeliveryAt customerNote assignedTo createdAt",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    RepairOrder.countDocuments(filter),
  ]);

  // Derive stats
  const stats = await RepairOrder.aggregate([
    { $match: { customerId: req.user._id, isDeleted: false } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        total: { $sum: "$totalAmount" },
      },
    },
  ]);

  const summary = { total: 0, active: 0, completed: 0, totalSpent: 0 };
  stats.forEach((s) => {
    summary.total += s.count;
    if (s._id === "completed") {
      summary.completed += s.count;
      summary.totalSpent += s.total;
    } else if (!["cancelled"].includes(s._id)) {
      summary.active += s.count;
    }
  });

  return sendSuccess(res, 200, "Orders fetched.", {
    orders,
    total,
    page: safePage,
    summary,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/orders/:id
// ─────────────────────────────────────────────────────────────────
const getOrderDetail = asyncHandler(async (req, res) => {
  const order = await RepairOrder.findOne({
    _id: req.params.id,
    customerId: req.user._id,
    isDeleted: false,
  })
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleVariant vehicleKmDriven")
    .populate("assignedTo", "fullName phoneNo")
    .lean();

  if (!order) return sendError(res, 404, "Order not found.");

  // Attach invoice if present
  const invoice = await Invoice.findOne({
    repairOrderId: order._id,
    isDeleted: false,
  })
    .select("invoiceNo status paymentStatus totalAmount createdAt")
    .lean();

  return sendSuccess(res, 200, "Order fetched.", {
    order,
    invoice: invoice ?? null,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/customer/orders
//  Customer submits a service/repair request
// ─────────────────────────────────────────────────────────────────
const createOrder = asyncHandler(async (req, res) => {
  const gid = garageId(req.user);
  if (!gid)
    return sendError(
      res,
      400,
      "Your account is not linked to any garage. Contact the garage.",
    );

  const { vehicleId, customerNote, services = [], estimatedDeliveryAt, scheduledAt } =
    req.body;
  if (!vehicleId) return sendError(res, 400, "vehicleId is required.");

  // Ensure vehicle belongs to this customer
  const vehicle = await Vehicle.findOne({ _id: vehicleId, user: req.user._id });
  if (!vehicle) return sendError(res, 404, "Vehicle not found.");

  // Auto-generate order number
  const count = await RepairOrder.countDocuments({ garageId: gid });
  const orderNo = `RO-${String(count + 1).padStart(5, "0")}`;

  // Map service selections (pricing finalised by owner; customer just names them)
  const serviceLines = Array.isArray(services)
    ? services.map((s) => {
        const price = Number(s.price) || 0;
        return {
          catalogId: s.catalogId || null,
          name: String(s.name || "Service Request"),
          price,
          discount: 0,
          taxPercent: 0,
          lineTotal: price,
        };
      })
    : [];

  // Use customer-provided date/time or fall back to submission time
  const resolvedScheduledAt = scheduledAt ? new Date(scheduledAt) : new Date();

  const order = await RepairOrder.create({
    garageId: gid,
    customerId: req.user._id,
    vehicleId: vehicle._id,
    orderNo,
    customerNote: customerNote?.trim() || null,
    status: "created",
    createdBy: req.user._id,
    scheduledAt: resolvedScheduledAt,
    estimatedDeliveryAt: estimatedDeliveryAt || null,
    services: serviceLines,
  });

  return sendSuccess(res, 201, "Service request submitted successfully.", {
    order,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/invoices?page=&limit=
// ─────────────────────────────────────────────────────────────────
const getMyInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const filter = { customerId: req.user._id, isDeleted: false };

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo")
      .populate("repairOrderId", "orderNo status")
      .select(
        "invoiceNo status paymentStatus totalAmount createdAt services parts",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Invoices fetched.", {
    invoices,
    total,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/customer/invoices/:id
// ─────────────────────────────────────────────────────────────────
const getInvoiceDetail = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    customerId: req.user._id,
    isDeleted: false,
  })
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleVariant vehicleKmDriven")
    .populate("repairOrderId", "orderNo status customerNote")
    .lean();

  if (!invoice) return sendError(res, 404, "Invoice not found.");

  const garage = await Garage.findById(invoice.garageId)
    .select(
      "garageName garageOwnerName garageAddress garageContactNumber garageLogo isGstApplicable gstNumber",
    )
    .lean();

  return sendSuccess(res, 200, "Invoice fetched.", { invoice, garage });
});

// ─────────────────────────────────────────────────────────────────
//  GET  /api/v1/customer/profile
//  PUT  /api/v1/customer/profile
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

// ─────────────────────────────────────────────────────────────────
//  PATCH /api/v1/customer/orders/:id/cancel
//
//  Customer can cancel their own order only if work has NOT started
//  (i.e. status is still "created"). Once in_progress or beyond,
//  they must contact the garage directly.
//
//  On success: notifies the garage owner via push notification.
// ─────────────────────────────────────────────────────────────────
const cancelMyOrder = asyncHandler(async (req, res) => {
  const order = await RepairOrder.findOne({
    _id: req.params.id,
    customerId: req.user._id,
    isDeleted: false,
  });

  if (!order) return sendError(res, 404, "Order not found.");

  if (order.status !== "created") {
    return sendError(
      res,
      400,
      "This order cannot be cancelled. Work has already started. Please contact your garage.",
    );
  }

  order.status = "cancelled";
  await order.save();

  // Fire-and-forget: notify the garage owner
  (async () => {
    try {
      const garage = await Garage.findById(order.garageId).select("owner").lean();
      if (garage?.owner) {
        const customerName = req.user.fullName || req.user.phoneNo || "A customer";
        await notifyUser(
          garage.owner,
          TEMPLATES.OWNER_ORDER_CANCELLED(order.orderNo, customerName),
        );
      }
    } catch (err) {
      console.error("[Push] Cancel notification to owner failed:", err.message);
    }
  })();

  return sendSuccess(res, 200, "Order cancelled successfully.", { order });
});

module.exports = {
  getGarageInfo,
  getServices,
  getMyVehicles,
  addMyVehicle,
  getMyOrders,
  getOrderDetail,
  createOrder,
  cancelMyOrder,
  getMyInvoices,
  getInvoiceDetail,
  getMyProfile,
  updateMyProfile,
};
