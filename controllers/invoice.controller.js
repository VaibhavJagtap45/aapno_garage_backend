const mongoose = require("mongoose");
const Invoice = require("../models/Invoice.model");
const RepairOrder = require("../models/RepairOrder.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const escapeRegex = require("../utils/escapeRegex");
const {
  normalizeInvoiceServiceLines,
  normalizeInvoicePartLines,
  computeInvoiceTotals,
} = require("../utils/lineItemMath");
const { assertCustomerAndVehicle } = require("../utils/assertOwnership");
const { applyInventoryDelta } = require("../utils/inventoryTxn");

function clampAmount(value, max) {
  const amount = Number(value) || 0;
  return Math.min(Math.max(amount, 0), Math.max(Number(max) || 0, 0));
}

function resolvePaidAmount(paymentStatus, totalAmount, paidAmount, existingPaidAmount = 0) {
  if (paymentStatus === "paid") return Number(totalAmount) || 0;
  if (paymentStatus === "unpaid") return 0;
  if (paymentStatus === "partial") {
    return clampAmount(paidAmount ?? existingPaidAmount, totalAmount);
  }
  return clampAmount(paidAmount ?? existingPaidAmount, totalAmount);
}

// ─── Helper ───────────────────────────────────────────────────────
const resolveGarageId = require("../utils/resolveGarageId");
const incrementUsage = require("../utils/incrementUsage");
const { resolveFranchiseAccountsScope, garageFilter } = require("../utils/resolveFranchiseAccountsScope");

async function nextInvoiceNo(garageId) {
  const count = await Invoice.countDocuments({ garageId });
  return `INV-${String(count + 1).padStart(5, "0")}`;
}

// ─── Compute totals from lines ────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/invoices?status=&customerId=&page=&limit=&search=
// ─────────────────────────────────────────────────────────────────
const listInvoices = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { status, customerId, repairOrderId, paymentStatus, dateFrom, dateTo, search, page = 1, limit = 20 } = req.query;
  const filter = { garageId: garageFilter(scope), isDeleted: false };
  if (status) filter.status = status;
  if (customerId) filter.customerId = customerId;
  if (repairOrderId) filter.repairOrderId = repairOrderId;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
  }

  if (search && search.trim()) {
    const User = require("../models/User.model");
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    const matchingCustomers = await User.find({
      $or: [{ fullName: rx }, { phoneNo: rx }],
    })
      .select("_id")
      .lean();
    filter.$or = [
      { invoiceNo: rx },
      { customerId: { $in: matchingCustomers.map((c) => c._id) } },
    ];
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate("customerId", "fullName phoneNo emailId")
      .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
      .populate("garageId", "garageName")
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Invoices fetched.", {
    invoices,
    total,
    page: safePage,
    isFranchiseView: scope.isFranchiseView,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/invoices/:id
// ─────────────────────────────────────────────────────────────────
const getInvoice = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  })
    .populate("customerId", "fullName phoneNo emailId")
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
    .populate("repairOrderId", "orderNo status")
    .lean();

  if (!invoice) return sendError(res, 404, "Invoice not found.");
  return sendSuccess(res, 200, "Invoice fetched.", { invoice });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/invoices
//  Supports prefill from a repairOrderId
// ─────────────────────────────────────────────────────────────────
const createInvoice = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  let {
    repairOrderId = null,
    customerId = null,
    vehicleId = null,
    services = [],
    parts = [],
    tags = [],
    discountAmount = 0,
    paidAmount = 0,
    paymentStatus = "unpaid",
    notifyCustomer = false,
    notes = null,
    paymentMode = "cash",
  } = req.body;

  // If coming from a repair order — prefill from it
  if (repairOrderId) {
    const ro = await RepairOrder.findOne({
      _id: repairOrderId,
      garageId,
    }).lean();
    if (!ro) return sendError(res, 404, "Repair order not found.");

    // Only prefill fields not explicitly supplied
    if (!customerId) customerId = ro.customerId;
    if (!vehicleId) vehicleId = ro.vehicleId;
    if (!services.length) services = ro.services ?? [];
    if (!parts.length) parts = ro.parts ?? [];
    if (!tags.length) tags = ro.tags ?? [];
  }

  if (!customerId) return sendError(res, 400, "customerId is required.");

  // Tenant isolation: even after repair-order prefill, prove that the
  // customer (and vehicle, if supplied) actually belong to this garage.
  // Without this check a forged ObjectId from another tenant could be
  // stamped onto a new invoice.
  await assertCustomerAndVehicle({ customerId, vehicleId, garageId });

  const normalizedServices = normalizeInvoiceServiceLines(services);
  const normalizedParts = normalizeInvoicePartLines(parts);
  const totals = computeInvoiceTotals(
    normalizedServices,
    normalizedParts,
    Number(discountAmount) || 0,
  );

  // Invoice + inventory must succeed or fail together. Otherwise an
  // invoice can land with parts that were never debited (or stock can
  // be debited for an invoice that ultimately fails to save).
  const session = await mongoose.startSession();
  let createdId;
  try {
    await session.withTransaction(async () => {
      const invoiceNo = await nextInvoiceNo(garageId);
      const [doc] = await Invoice.create(
        [
          {
            garageId,
            invoiceNo,
            repairOrderId: repairOrderId || null,
            customerId,
            vehicleId: vehicleId || null,
            services: normalizedServices,
            parts: normalizedParts,
            tags,
            servicesSubTotal: totals.servicesSubTotal,
            partsSubTotal: totals.partsSubTotal,
            discountAmount: totals.discountAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            paymentStatus,
            paidAmount: resolvePaidAmount(
              paymentStatus,
              totals.totalAmount,
              paidAmount,
            ),
            notifyCustomer,
            notes: notes?.trim() || null,
            paymentMode,
            createdBy: req.user._id,
            status: "draft",
          },
        ],
        { session },
      );
      createdId = doc._id;

      await applyInventoryDelta({
        garageId,
        previousParts: [],
        nextParts: normalizedParts,
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  // Legacy no-op retained for compatibility with older usage hooks.
  incrementUsage(garageId, "invoices");

  // Populate so the frontend can display customer & vehicle immediately
  const invoice = await Invoice.findById(createdId)
    .populate("customerId", "fullName phoneNo emailId")
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
    .lean();

  return sendSuccess(res, 201, "Invoice created.", { invoice });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/invoices/:id
// ─────────────────────────────────────────────────────────────────
const updateInvoice = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!invoice) return sendError(res, 404, "Invoice not found.");

  const previousParts = invoice.parts.map((part) =>
    typeof part.toObject === "function" ? part.toObject() : part,
  );
  const { services, parts, discountAmount, ...rest } = req.body;

  // Tenant isolation for reassigned customer/vehicle. The update path
  // allows changing customerId/vehicleId, so we must re-verify against
  // the current garage (not the invoice's stored garage — that's already
  // validated by the findOne filter above).
  if (rest.customerId !== undefined || rest.vehicleId !== undefined) {
    const nextCustomerId = rest.customerId ?? invoice.customerId;
    const nextVehicleId = rest.vehicleId ?? invoice.vehicleId;
    await assertCustomerAndVehicle({
      customerId: nextCustomerId,
      vehicleId: nextVehicleId,
      garageId,
    });
  }

  // If line items changed — recompute totals
  if (
    services !== undefined ||
    parts !== undefined ||
    discountAmount !== undefined
  ) {
    const newServices = normalizeInvoiceServiceLines(services ?? invoice.services);
    const newParts = normalizeInvoicePartLines(parts ?? invoice.parts);
    const dis = Number(discountAmount ?? invoice.discountAmount) || 0;

    const totals = computeInvoiceTotals(newServices, newParts, dis);
    Object.assign(invoice, {
      services: newServices,
      parts: newParts,
      servicesSubTotal: totals.servicesSubTotal,
      partsSubTotal: totals.partsSubTotal,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
    });
  }

  const allowed = [
    "tags",
    "notifyCustomer",
    "notes",
    "paymentMode",
    "paymentStatus",
    "status",
    "customerId",
    "vehicleId",
  ];
  allowed.forEach((k) => {
    if (rest[k] !== undefined) invoice[k] = rest[k];
  });

  if (
    rest.paymentStatus !== undefined ||
    rest.paidAmount !== undefined ||
    services !== undefined ||
    parts !== undefined ||
    discountAmount !== undefined
  ) {
    invoice.paidAmount = resolvePaidAmount(
      invoice.paymentStatus,
      invoice.totalAmount,
      rest.paidAmount,
      invoice.paidAmount,
    );
  }

  // Save invoice + adjust stock in one transaction so they cannot drift.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await invoice.save({ session });
      if (parts !== undefined) {
        await applyInventoryDelta({
          garageId,
          previousParts,
          nextParts: invoice.parts,
          session,
        });
      }
    });
  } finally {
    await session.endSession();
  }

  // Always return populated refs so frontend can display customer/vehicle name
  const populated = await Invoice.findById(invoice._id)
    .populate("customerId", "fullName phoneNo emailId")
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
    .populate("repairOrderId", "orderNo status")
    .lean();

  return sendSuccess(res, 200, "Invoice updated.", { invoice: populated });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/invoices/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────
const deleteInvoice = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  // Soft-delete + release reserved stock in one transaction. Release is
  // always a non-negative delta (delta < 0 from inventoryTxn's POV) so
  // the stock check never blocks, but we still want the two writes to
  // succeed or fail together.
  const session = await mongoose.startSession();
  let invoice;
  try {
    await session.withTransaction(async () => {
      invoice = await Invoice.findOneAndUpdate(
        { _id: req.params.id, garageId, isDeleted: false },
        { isDeleted: true },
        { returnDocument: "after", session },
      );
      if (!invoice) {
        // Throw to abort the transaction — the asyncHandler/global
        // error handler will surface a 404.
        const err = new Error("Invoice not found.");
        err.status = 404;
        throw err;
      }
      await applyInventoryDelta({
        garageId,
        previousParts: invoice.parts,
        nextParts: [],
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  return sendSuccess(res, 200, "Invoice deleted.");
});

// GET /api/v1/invoices/stats?dateFrom=&dateTo=
const getInvoiceStats = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo } = req.query;
  const filter = { garageId: garageFilter(scope), isDeleted: false };
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
  }

  const [result] = await Invoice.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total:  { $sum: "$totalAmount" },
        paid: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ["$paymentStatus", "paid"] }, then: "$totalAmount" },
                { case: { $eq: ["$paymentStatus", "partial"] }, then: { $ifNull: ["$paidAmount", 0] } },
              ],
              default: 0,
            },
          },
        },
        credit: {
          $sum: {
            $switch: {
              branches: [
                { case: { $eq: ["$paymentStatus", "unpaid"] }, then: "$totalAmount" },
                {
                  case: { $eq: ["$paymentStatus", "partial"] },
                  then: {
                    $max: [
                      { $subtract: ["$totalAmount", { $ifNull: ["$paidAmount", 0] }] },
                      0,
                    ],
                  },
                },
              ],
              default: 0,
            },
          },
        },
      },
    },
  ]);

  return sendSuccess(res, 200, "Invoice stats fetched.", {
    total:  result?.total  ?? 0,
    paid:   result?.paid   ?? 0,
    credit: result?.credit ?? 0,
  });
});

module.exports = {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceStats,
};
