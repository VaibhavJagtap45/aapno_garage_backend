const RepairOrder = require("../models/RepairOrder.model");
const Vehicle = require("../models/Vehicle.model");
const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const GarageServiceCatalog = require("../models/GarageServiceCatalog.model");
const Inventory = require("../models/Inventry.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const escapeRegex = require("../utils/escapeRegex");
const { assertCustomerAndVehicle } = require("../utils/assertOwnership");
const {
  normalizeRepairServiceLines,
  normalizeRepairPartLines,
  computeRepairOrderTotals,
  computeRepairOrderTotalsWithDiscount,
} = require("../utils/lineItemMath");
const {
  notifyStatusTransition,
  notifyOrderCreated,
} = require("../services/repairOrderNotification.service");
const incrementUsage = require("../utils/incrementUsage");

async function nextOrderNo(garageId) {
  // Find the actual highest orderNo for this garage — safe against deletions and
  // concurrent inserts (unlike countDocuments which drifts when rows are removed).
  const last = await RepairOrder.findOne(
    { garageId, orderNo: { $exists: true, $ne: null } },
    { orderNo: 1 },
    { sort: { orderNo: -1 } },
  ).lean();
  const lastNum = last?.orderNo
    ? parseInt(last.orderNo.replace(/\D/g, ""), 10) || 0
    : 0;
  return `RO-${String(lastNum + 1).padStart(5, "0")}`;
}

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/repair-orders/resolve-customer
//  Smart customer resolution: check if customer exists (by phone/email)
//  If exists: return customer + all their vehicles (for selection/add new vehicle)
//  If new: return success signal with customer creation payload
//  This enables seamless "already exists? add vehicle instead" UX pattern.
// ─────────────────────────────────────────────────────────────────
const resolveCustomer = asyncHandler(async (req, res) => {
  const { phoneNo, emailId, fullName } = req.body;

  // At least one identifier must be provided
  if (!phoneNo && !emailId && !fullName) {
    return sendError(
      res,
      400,
      "Provide phoneNo, emailId, or fullName to resolve customer.",
    );
  }

  // Build search conditions — match by phone or email (primary), then name fallback
  const searchConditions = [];
  if (phoneNo?.trim()) searchConditions.push({ phoneNo: phoneNo.trim() });
  if (emailId?.trim())
    searchConditions.push({ emailId: emailId.toLowerCase().trim() });
  if (fullName?.trim()) {
    const nameRx = new RegExp(`^${escapeRegex(fullName.trim())}$`, "i");
    searchConditions.push({ fullName: nameRx });
  }

  if (searchConditions.length === 0) {
    return sendSuccess(res, 200, "New customer (no identifiers).", {
      isExisting: false,
      customer: null,
      vehicles: [],
    });
  }

  // Try to find existing customer
  const existingCustomer = await User.findOne({ $or: searchConditions })
    .select("_id fullName phoneNo emailId")
    .lean();

  if (!existingCustomer) {
    // Customer doesn't exist
    return sendSuccess(res, 200, "New customer.", {
      isExisting: false,
      customer: null,
      vehicles: [],
    });
  }

  // Customer exists — fetch all their vehicles
  const vehicles = await Vehicle.find({ user: existingCustomer._id })
    .select("_id vehicleBrand vehicleModel vehicleRegisterNo")
    .lean();

  return sendSuccess(res, 200, "Existing customer found.", {
    isExisting: true,
    customer: existingCustomer,
    vehicles: vehicles || [],
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/search-customers?q=John
//  Live search: matches by customer name/phone OR vehicle reg number.
//  Returns up to 20 { customer, vehicle } pairs for the dropdown list.
// ─────────────────────────────────────────────────────────────────
const searchCustomers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q?.trim() || q.trim().length < 2) {
    return sendSuccess(res, 200, "Results.", { results: [] });
  }

  const rx = new RegExp(escapeRegex(q.trim()), "i");

  // 1. Find customers matching name/phone  AND  vehicles matching reg number — parallel
  const [matchingCustomers, matchingVehiclesByReg] = await Promise.all([
    User.find({ $or: [{ fullName: rx }, { phoneNo: rx }] })
      .select("_id fullName phoneNo emailId")
      .limit(15)
      .lean(),
    Vehicle.find({ vehicleRegisterNo: rx })
      .select("_id vehicleBrand vehicleModel vehicleRegisterNo user")
      .limit(10)
      .lean(),
  ]);

  // 2. Collect all unique customer IDs from both result sets
  const customerIdSet = new Set(matchingCustomers.map((c) => String(c._id)));
  for (const v of matchingVehiclesByReg) {
    if (v.user) customerIdSet.add(String(v.user));
  }

  if (customerIdSet.size === 0) {
    return sendSuccess(res, 200, "Results.", { results: [] });
  }

  // 3. Fetch all those customers and ALL their vehicles in 2 parallel queries
  const allCustomerIds = [...customerIdSet];
  const [allCustomers, allVehicles] = await Promise.all([
    User.find({ _id: { $in: allCustomerIds } })
      .select("_id fullName phoneNo emailId")
      .lean(),
    Vehicle.find({ user: { $in: allCustomerIds } })
      .select("_id vehicleBrand vehicleModel vehicleRegisterNo user")
      .lean(),
  ]);

  // 4. Build lookup maps
  const customerMap = {};
  allCustomers.forEach((c) => {
    customerMap[String(c._id)] = c;
  });

  const vehiclesByCustomer = {};
  allVehicles.forEach((v) => {
    const cid = String(v.user);
    if (!vehiclesByCustomer[cid]) vehiclesByCustomer[cid] = [];
    vehiclesByCustomer[cid].push({ ...v, user: undefined });
  });

  // 5. Build one result row per customer-vehicle pair
  const results = [];
  for (const cid of allCustomerIds) {
    const customer = customerMap[cid];
    if (!customer) continue;
    const vehicles = vehiclesByCustomer[cid] ?? [];
    if (vehicles.length === 0) {
      results.push({ customer, vehicle: null });
    } else {
      for (const v of vehicles) {
        results.push({ customer, vehicle: v });
      }
    }
  }

  return sendSuccess(res, 200, "Results.", { results: results.slice(0, 20) });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/search-vehicle?regNo=&q=
//  When q or regNo is provided: searches vehicles by reg number,
//  customer name, or phone number.
//  When neither is provided: returns all customer-vehicle pairs
//  for this garage (most recent first, capped at 50).
// ─────────────────────────────────────────────────────────────────
const searchVehicleByRegNo = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  const { regNo, q } = req.query;
  const query = (q || regNo || "").trim();

  const garageCustomerIds = await RepairOrder.distinct("customerId", {
    garageId,
    isDeleted: false,
  });

  if (!garageCustomerIds.length) {
    return sendSuccess(res, 200, "Vehicles found.", { results: [] });
  }

  if (!query) {
    const [customers, vehicles] = await Promise.all([
      User.find({ _id: { $in: garageCustomerIds } })
        .select("_id fullName phoneNo emailId")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Vehicle.find({ user: { $in: garageCustomerIds } })
        .select(
          "_id vehicleBrand vehicleModel vehicleVariant vehicleRegisterNo user",
        )
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const vehiclesByUser = {};
    vehicles.forEach((v) => {
      const uid = String(v.user);
      if (!vehiclesByUser[uid]) vehiclesByUser[uid] = [];
      vehiclesByUser[uid].push(v);
    });

    const results = [];
    for (const c of customers) {
      const cvehicles = vehiclesByUser[String(c._id)] || [];
      if (cvehicles.length === 0) {
        results.push({ customer: c, vehicle: null });
      } else {
        for (const v of cvehicles) {
          results.push({ customer: c, vehicle: v });
        }
      }
    }

    return sendSuccess(res, 200, "Vehicles found.", {
      results: results.slice(0, 50),
    });
  }

  const rx = new RegExp(escapeRegex(query), "i");

  const [vehiclesByReg, customersByName] = await Promise.all([
    Vehicle.find({
      user: { $in: garageCustomerIds },
      vehicleRegisterNo: rx,
    })
      .select(
        "_id vehicleBrand vehicleModel vehicleVariant vehicleRegisterNo user",
      )
      .limit(20)
      .lean(),
    User.find({
      _id: { $in: garageCustomerIds },
      $or: [{ fullName: rx }, { phoneNo: rx }],
    })
      .select("_id fullName phoneNo emailId")
      .limit(15)
      .lean(),
  ]);

  const customerIdSet = new Set(customersByName.map((c) => String(c._id)));
  for (const v of vehiclesByReg) {
    if (v.user) customerIdSet.add(String(v.user));
  }

  if (customerIdSet.size === 0) {
    return sendSuccess(res, 200, "Vehicles found.", { results: [] });
  }

  const allIds = [...customerIdSet];
  const [allCustomers, allVehicles] = await Promise.all([
    User.find({ _id: { $in: allIds } })
      .select("_id fullName phoneNo emailId")
      .lean(),
    Vehicle.find({ user: { $in: allIds } })
      .select(
        "_id vehicleBrand vehicleModel vehicleVariant vehicleRegisterNo user",
      )
      .lean(),
  ]);

  const customerMap = {};
  allCustomers.forEach((c) => {
    customerMap[String(c._id)] = c;
  });

  const vehiclesByUser = {};
  allVehicles.forEach((v) => {
    const uid = String(v.user);
    if (!vehiclesByUser[uid]) vehiclesByUser[uid] = [];
    vehiclesByUser[uid].push(v);
  });

  const results = [];
  for (const cid of allIds) {
    const customer = customerMap[cid];
    if (!customer) continue;
    const cvehicles = vehiclesByUser[cid] || [];
    if (cvehicles.length === 0) {
      results.push({ customer, vehicle: null });
    } else {
      for (const v of cvehicles) {
        results.push({ customer, vehicle: v });
      }
    }
  }

  return sendSuccess(res, 200, "Vehicles found.", {
    results: results.slice(0, 30),
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders?status=&page=&limit=
// ─────────────────────────────────────────────────────────────────
const listRepairOrders = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { status, page = 1, limit = 50, search } = req.query;
  const filter = { garageId, isDeleted: false };
  if (status) filter.status = status;

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  // ── Text search: match on orderNo, customer name/phone, vehicle reg ──────────
  // We do this in two passes:
  // 1. If search term looks like a reg no or order no, add direct filter
  // 2. For name/phone, find matching customer IDs first, then filter by those
  if (search?.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");

    // Find customers matching name or phone
    const matchingCustomers = await User.find({
      $or: [{ fullName: rx }, { phoneNo: rx }],
    })
      .select("_id")
      .lean();

    const customerIds = matchingCustomers.map((u) => u._id);

    // Find vehicles matching reg number
    const matchingVehicles = await Vehicle.find({
      vehicleRegisterNo: rx,
    })
      .select("_id")
      .lean();

    const vehicleIds = matchingVehicles.map((v) => v._id);

    filter.$or = [
      { orderNo: rx },
      ...(customerIds.length ? [{ customerId: { $in: customerIds } }] : []),
      ...(vehicleIds.length ? [{ vehicleId: { $in: vehicleIds } }] : []),
    ];
  }

  const [orders, total] = await Promise.all([
    RepairOrder.find(filter)
      .populate("customerId", "fullName phoneNo")
      .populate(
        "vehicleId",
        "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    RepairOrder.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Repair orders fetched.", {
    orders,
    total,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/:id
// ─────────────────────────────────────────────────────────────────
const getRepairOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

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
    .lean();

  if (!order) return sendError(res, 404, "Repair order not found.");
  return sendSuccess(res, 200, "Repair order fetched.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/repair-orders
// ─────────────────────────────────────────────────────────────────
const createRepairOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const {
    customerId,
    vehicleId,
    odometerReading,
    vehicleVariant,
    services = [],
    applyDiscountToAllServices = false,
    parts = [],
    applyDiscountToAllParts = false,
    images = [],
    tags = [],
    customerRemarks = [],
    scheduledAt,
    estimatedDeliveryAt,
    notifyCustomer = false,
    discountAmount = 0,
    discountType = "rupees",
    discountPercent = 0,
  } = req.body;

  if (!customerId) return sendError(res, 400, "customerId is required.");
  if (!vehicleId) return sendError(res, 400, "vehicleId is required.");

  // Tenant isolation: prove the customer + vehicle actually belong to
  // this garage before we let them onto a new repair order. Stops a
  // forged ObjectId from another tenant being attached here.
  await assertCustomerAndVehicle({ customerId, vehicleId, garageId });

  const { services: syncedServices, parts: syncedParts } =
    await syncManualRepairOrderItems(garageId, services, parts);
  const normalizedServices = normalizeRepairServiceLines(syncedServices);
  const normalizedParts = normalizeRepairPartLines(syncedParts);

  // Determine discount value based on type
  let discountValue = 0;
  const type = String(discountType || "rupees").toLowerCase();
  if (type === "percentage") {
    discountValue = Number(discountPercent) || 0;
  } else {
    discountValue = Number(discountAmount) || 0;
  }

  const totals = computeRepairOrderTotalsWithDiscount(
    normalizedServices,
    normalizedParts,
    type,
    discountValue,
  );

  const payload = {
    garageId,
    customerId,
    vehicleId,
    odometerReading: odometerReading ?? null,
    vehicleVariant: vehicleVariant ?? null,
    services: normalizedServices,
    applyDiscountToAllServices,
    parts: normalizedParts,
    applyDiscountToAllParts,
    images,
    servicesTotal: totals.servicesTotal,
    partsTotal: totals.partsTotal,
    taxTotal: totals.taxTotal,
    totalAmount: totals.totalAmount,
    discountAmount: totals.appliedDiscount,
    discountType: type,
    discountPercent: type === "percentage" ? discountValue : 0,
    tags,
    customerRemarks,
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    estimatedDeliveryAt: estimatedDeliveryAt
      ? new Date(estimatedDeliveryAt)
      : null,
    notifyCustomer,
    createdBy: req.user._id,
    status: "created",
  };

  // Retry up to 5 times on duplicate orderNo (handles concurrent requests).
  // Each retry re-queries the max orderNo so it always picks the next free slot.
  let order;
  for (let attempt = 0; attempt < 5; attempt++) {
    payload.orderNo = await nextOrderNo(garageId);
    try {
      order = await RepairOrder.create(payload);
      break;
    } catch (err) {
      if (err.code === 11000 && attempt < 4) continue; // duplicate key — retry
      throw err;
    }
  }

  // Legacy no-op retained for compatibility with older usage hooks.
  incrementUsage(garageId, "repairOrders");

  // Fire-and-forget notification. The service catches its own errors —
  // a push outage must not block the API response.
  if (order.customerId) {
    notifyOrderCreated({ garageId, order });
  }

  return sendSuccess(res, 201, "Repair order created.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/repair-orders/:id
// ─────────────────────────────────────────────────────────────────
const updateRepairOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const order = await RepairOrder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!order) return sendError(res, 404, "Repair order not found.");

  const allowed = [
    "services",
    "applyDiscountToAllServices",
    "parts",
    "applyDiscountToAllParts",
    "images",
    "tags",
    "customerRemarks",
    "scheduledAt", // advance booking date — editable by owner
    "estimatedDeliveryAt",
    "notifyCustomer",
    "status",
    "odometerReading",
    "vehicleVariant",
    "assignedTo", // owner assigns a mechanic (member)
    "assignedAt",
    "discountAmount",
    "discountType",
    "discountPercent",
  ];

  const previousStatus = order.status;

  allowed.forEach((k) => {
    if (req.body[k] === undefined) return;
    if (k === "services" || k === "parts") return;
    order[k] = req.body[k];
  });

  if (
    req.body.services !== undefined ||
    req.body.parts !== undefined ||
    req.body.discountAmount !== undefined ||
    req.body.discountType !== undefined ||
    req.body.discountPercent !== undefined
  ) {
    const rawServices =
      req.body.services !== undefined
        ? req.body.services
        : (order.services || []).map((l) =>
            typeof l?.toObject === "function" ? l.toObject() : { ...l },
          );
    const rawParts =
      req.body.parts !== undefined
        ? req.body.parts
        : (order.parts || []).map((l) =>
            typeof l?.toObject === "function" ? l.toObject() : { ...l },
          );

    const { services: syncedServices, parts: syncedParts } =
      await syncManualRepairOrderItems(garageId, rawServices, rawParts);
    const normalizedServices = normalizeRepairServiceLines(syncedServices);
    const normalizedParts = normalizeRepairPartLines(syncedParts);

    // Determine discount value based on type
    const type = String(
      req.body.discountType ?? order.discountType ?? "rupees",
    ).toLowerCase();
    let discountValue = 0;
    if (type === "percentage") {
      discountValue =
        Number(req.body.discountPercent ?? order.discountPercent) || 0;
    } else {
      discountValue =
        Number(req.body.discountAmount ?? order.discountAmount) || 0;
    }

    const totals = computeRepairOrderTotalsWithDiscount(
      normalizedServices,
      normalizedParts,
      type,
      discountValue,
    );

    order.services = normalizedServices;
    order.parts = normalizedParts;
    order.servicesTotal = totals.servicesTotal;
    order.partsTotal = totals.partsTotal;
    order.taxTotal = totals.taxTotal;
    order.totalAmount = totals.totalAmount;
    order.discountAmount = totals.appliedDiscount;
    order.discountType = type;
    order.discountPercent = type === "percentage" ? discountValue : 0;
  }

  await order.save();

  // Fire-and-forget. Push/WhatsApp must never block the API response;
  // the service catches its own errors and only logs.
  if (req.body.status && req.body.status !== previousStatus) {
    notifyStatusTransition({ garageId, order, status: req.body.status });
  }

  return sendSuccess(res, 200, "Repair order updated.", { order });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/repair-orders/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────
const deleteRepairOrder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const order = await RepairOrder.findOneAndUpdate(
    { _id: req.params.id, garageId, isDeleted: false },
    { isDeleted: true },
    { returnDocument: "after" },
  );

  if (!order) return sendError(res, 404, "Repair order not found.");
  return sendSuccess(res, 200, "Repair order deleted.");
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/cancelled?page=&limit=&dateFrom=&dateTo=
// ─────────────────────────────────────────────────────────────────
const getCancelledOrders = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { page = 1, limit = 20, dateFrom, dateTo, search } = req.query;
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { garageId, isDeleted: false, status: "cancelled" };

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo)
      filter.createdAt.$lte = new Date(
        new Date(dateTo).setHours(23, 59, 59, 999),
      );
  }

  if (search?.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    const matchingCustomers = await User.find({
      $or: [{ fullName: rx }, { phoneNo: rx }],
    })
      .select("_id")
      .lean();
    filter.$or = [
      { orderNo: rx },
      { customerId: { $in: matchingCustomers.map((c) => c._id) } },
    ];
  }

  const [orders, total] = await Promise.all([
    RepairOrder.find(filter)
      .populate("customerId", "fullName phoneNo")
      .populate(
        "vehicleId",
        "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    RepairOrder.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Cancelled orders fetched.", {
    orders,
    total,
    page: safePage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/tally-export?dateFrom=&dateTo=
//  Returns structured data for Tally export (JSON, frontend converts to CSV)
// ─────────────────────────────────────────────────────────────────
const tallyExport = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo } = req.query;
  if (!dateFrom || !dateTo)
    return sendError(res, 400, "dateFrom and dateTo are required.");

  const filter = {
    garageId,
    isDeleted: false,
    status: { $nin: ["cancelled"] },
    createdAt: {
      $gte: new Date(dateFrom),
      $lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)),
    },
  };

  const orders = await RepairOrder.find(filter)
    .populate("customerId", "fullName phoneNo emailId")
    .populate(
      "vehicleId",
      "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven",
    )
    .sort({ createdAt: 1 })
    .lean();

  const rows = orders.map((o) => ({
    orderNo: o.orderNo ?? "",
    date: o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN") : "",
    customerName: o.customerId?.fullName ?? "",
    customerPhone: o.customerId?.phoneNo ?? "",
    vehicleRegNo: o.vehicleId?.vehicleRegisterNo ?? "",
    vehicle: o.vehicleId
      ? `${o.vehicleId.vehicleBrand ?? ""} ${o.vehicleId.vehicleModel ?? ""}`.trim()
      : "",
    status: o.status ?? "",
    servicesTotal: o.servicesTotal ?? 0,
    partsTotal: o.partsTotal ?? 0,
    discountAmount: o.discountAmount ?? 0,
    taxTotal: o.taxTotal ?? 0,
    totalAmount: o.totalAmount ?? 0,
    paymentMode: o.paymentMode ?? "cash",
  }));

  return sendSuccess(res, 200, "Tally export data.", {
    rows,
    total: rows.length,
    dateFrom,
    dateTo,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/garage-members
//  Returns all member-role users linked to the owner's garage
//  (used by the owner to pick a mechanic when assigning an order)
// ─────────────────────────────────────────────────────────────────
const getGarageMembers = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const members = await User.find({ garage: garageId, role: "member" })
    .select("fullName phoneNo")
    .sort({ fullName: 1 })
    .lean();

  return sendSuccess(res, 200, "Members fetched.", { members });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/repair-orders/calendar?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
//  Returns repair orders within a date range for the calendar screen.
//  Includes:
//    • Orders with a scheduledAt (advance bookings) falling in the range
//    • Same-day walk-in orders (scheduledAt is null) whose createdAt falls in the range
// ─────────────────────────────────────────────────────────────────
const getCalendarOrders = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo } = req.query;
  if (!dateFrom || !dateTo)
    return sendError(
      res,
      400,
      "dateFrom and dateTo query params are required.",
    );

  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start) || isNaN(end))
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");

  const orders = await RepairOrder.find({
    garageId,
    isDeleted: false,
    $or: [
      { scheduledAt: { $gte: start, $lte: end } },
      { scheduledAt: null, createdAt: { $gte: start, $lte: end } },
    ],
  })
    .populate("customerId", "fullName phoneNo")
    .populate(
      "vehicleId",
      "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven",
    )
    .select(
      "orderNo scheduledAt estimatedDeliveryAt createdAt status customerId vehicleId services",
    )
    .sort({ scheduledAt: 1, createdAt: 1 })
    .lean();

  return sendSuccess(res, 200, "Calendar orders fetched.", { orders });
});

function normalizeManualText(value) {
  return String(value ?? "").trim();
}

function isManualServiceLine(line) {
  const mode = String(line?.entryMode || line?.mode || "").toLowerCase();
  if (mode === "manual") return true;
  if (mode === "catalog") return false;
  return !(
    line?.catalogId ||
    line?.serviceId ||
    line?.service?._id ||
    line?.service?.id
  );
}

function isManualPartLine(line) {
  const mode = String(line?.entryMode || line?.mode || "").toLowerCase();
  if (mode === "manual") return true;
  if (mode === "catalog") return false;
  return !(
    line?.inventoryId ||
    line?.itemId ||
    line?.part?._id ||
    line?.part?.id
  );
}

async function nextCatalogServiceNo(garageId) {
  const existing = await GarageServiceCatalog.find(
    { garageId, serviceNo: { $regex: /^S\d+$/ } },
    { serviceNo: 1 },
  ).lean();
  const maxNum = existing.reduce((max, doc) => {
    const n = parseInt((doc.serviceNo || "").slice(1), 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return `S${String(maxNum + 1).padStart(3, "0")}`;
}

async function syncManualRepairOrderItems(garageId, services = [], parts = []) {
  // Process services serially so concurrent inserts can't collide on the
  // unique (garageId, serviceNo) index when generating new catalog entries.
  const syncedServices = [];
  for (const line of Array.isArray(services) ? services : []) {
    const existingId =
      line?.catalogId ||
      line?.serviceId ||
      line?.service?._id ||
      line?.service?.id;
    const manual = isManualServiceLine(line);

    if (!manual || existingId) {
      syncedServices.push(line);
      continue;
    }

    const name = normalizeManualText(
      line?.name || line?.serviceName || line?.title,
    );
    if (!name) {
      syncedServices.push(line);
      continue;
    }

    const serviceRx = new RegExp(`^${escapeRegex(name)}$`, "i");
    let service = await GarageServiceCatalog.findOne({
      garageId,
      isDeleted: false,
      name: serviceRx,
    })
      .select("_id name mrp")
      .lean();

    if (!service) {
      const price =
        Number(line?.price ?? line?.mrp ?? line?.lineTotal ?? 0) || 0;
      // Retry up to 5x to dodge race conditions on the serviceNo sequence.
      let created;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          created = await GarageServiceCatalog.create({
            garageId,
            name,
            serviceNo: await nextCatalogServiceNo(garageId),
            category: "Other",
            mrp: price,
            applicability: "generic",
            applicableBrands: [],
            applicableModels: [],
            isActive: true,
          });
          break;
        } catch (err) {
          if (err.code === 11000 && attempt < 4) continue;
          throw err;
        }
      }
      service = created.toObject();
    }

    syncedServices.push({
      ...line,
      entryMode: "manual",
      catalogId: service._id,
      name: service.name,
      price: Number(line?.price ?? service.mrp ?? 0) || 0,
    });
  }

  const syncedParts = await Promise.all(
    (Array.isArray(parts) ? parts : []).map(async (line) => {
      const existingId =
        line?.inventoryId || line?.itemId || line?.part?._id || line?.part?.id;
      const manual = isManualPartLine(line);

      if (!manual || existingId) {
        return line;
      }

      const name = normalizeManualText(
        line?.name || line?.partName || line?.title,
      );
      if (!name) return line;

      const partCode = normalizeManualText(
        line?.partCode || line?.code || line?.no,
      );

      const lookup = partCode
        ? {
            garageId,
            $or: [
              { partCode: new RegExp(`^${escapeRegex(partCode)}$`, "i") },
              { partName: new RegExp(`^${escapeRegex(name)}$`, "i") },
            ],
          }
        : {
            garageId,
            partName: new RegExp(`^${escapeRegex(name)}$`, "i"),
          };

      let part = await Inventory.findOne(lookup)
        .select("_id partName partCode sellingPrice manageInventory")
        .lean();

      if (!part) {
        const unitPrice =
          Number(
            line?.unitPrice ??
              line?.price ??
              line?.mrp ??
              line?.sellingPrice ??
              0,
          ) || 0;

        part = await Inventory.create({
          garageId,
          partName: name,
          partCode: partCode || null,
          category: "general",
          brand: null,
          manufacturer: null,
          unit: "pcs",
          description: null,
          quantityInHand: 0,
          minimumStockLevel: 5,
          purchasePrice: 0,
          sellingPrice: unitPrice,
          taxPercent: Number(line?.taxPercent ?? 0) || 0,
          manageInventory: false,
          applicability: "generic",
          applicableBrands: [],
          applicableModels: [],
          isActive: true,
        });
        part = part.toObject();
      }

      return {
        ...line,
        entryMode: "manual",
        inventoryId: part._id,
        partCode: line?.partCode ?? part.partCode ?? null,
        name: part.partName,
        unitPrice:
          Number(line?.unitPrice ?? line?.price ?? part.sellingPrice ?? 0) || 0,
      };
    }),
  );

  return { services: syncedServices, parts: syncedParts };
}

module.exports = {
  resolveCustomer,
  searchCustomers,
  searchVehicleByRegNo,
  listRepairOrders,
  getRepairOrder,
  createRepairOrder,
  updateRepairOrder,
  deleteRepairOrder,
  getCancelledOrders,
  tallyExport,
  getGarageMembers,
  getCalendarOrders,
};
