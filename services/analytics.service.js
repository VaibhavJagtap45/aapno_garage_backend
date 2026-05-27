// services/analytics.service.js
//
// Cross-tenant analytics for the platform admin dashboard.
// Returns aggregated KPIs, trends, and breakdowns. All filters are optional;
// when omitted, "fromDate" defaults to 30 days ago.
//
// Filters supported:
//   fromDate, toDate           — ISO strings, inclusive
//   garageId                   — restrict to one garage

const mongoose = require("mongoose");
const Garage = require("../models/Garage.model");
const Booking = require("../models/Booking.model");
const Invoice = require("../models/Invoice.model");
const { BadRequestError } = require("../core/errors");

const DEFAULT_DAYS = 30;

function toDate(v, fallback) {
  if (!v) return fallback;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestError(`Invalid date '${v}'.`);
  }
  return d;
}

function objectId(v, label) {
  if (!v) return null;
  if (!mongoose.isValidObjectId(v)) {
    throw new BadRequestError(`Invalid ${label}.`);
  }
  return new mongoose.Types.ObjectId(v);
}

/**
 * Resolve the set of garageIds that match the filters, so every downstream
 * aggregation can scope cleanly off a single $match.
 */
async function resolveScope(filters) {
  const fromDate = toDate(
    filters.fromDate,
    new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000),
  );
  const toDateVal = toDate(filters.toDate, new Date());
  if (fromDate > toDateVal) {
    throw new BadRequestError("fromDate must be before toDate.");
  }

  const garageId = objectId(filters.garageId, "garageId");

  // Find the garages matching the structural filters
  const garageFilter = {};
  if (garageId) garageFilter._id = garageId;

  let garageIds;
  if (Object.keys(garageFilter).length > 0) {
    garageIds = (await Garage.find(garageFilter).select("_id").lean()).map(
      (g) => g._id,
    );
  } else {
    garageIds = null; // means "no restriction"
  }

  return { fromDate, toDate: toDateVal, garageId, garageIds };
}

function withScope(match, scope, garageField = "garage") {
  const m = { ...match };
  if (scope.garageIds) m[garageField] = { $in: scope.garageIds };
  return m;
}

// ─────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────
async function computeKpis(scope) {
  const dateRange = { $gte: scope.fromDate, $lte: scope.toDate };

  // Counts
  const garageCount = await Garage.countDocuments(
    scope.garageIds ? { _id: { $in: scope.garageIds } } : {},
  );

  // Revenue + bookings within range
  const [revenueAgg, bookingCount] = await Promise.all([
    Invoice.aggregate([
      {
        $match: withScope(
          { createdAt: dateRange },
          scope,
          "garageId",
        ),
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
          collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
          invoices: { $sum: 1 },
        },
      },
    ]),
    Booking.countDocuments(
      withScope({ createdAt: dateRange }, scope, "garage"),
    ),
  ]);

  const rev = revenueAgg[0] || { revenue: 0, collected: 0, invoices: 0 };

  return {
    garageCount,
    revenue: rev.revenue || 0,
    collected: rev.collected || 0,
    outstanding: Math.max(0, (rev.revenue || 0) - (rev.collected || 0)),
    invoices: rev.invoices || 0,
    bookings: bookingCount,
  };
}

// ─────────────────────────────────────────────────────────────────
// Revenue trend — daily buckets
// ─────────────────────────────────────────────────────────────────
async function computeRevenueTrend(scope) {
  const rows = await Invoice.aggregate([
    {
      $match: withScope(
        { createdAt: { $gte: scope.fromDate, $lte: scope.toDate } },
        scope,
        "garageId",
      ),
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
        collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({
    date: r._id,
    revenue: r.revenue,
    collected: r.collected,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Bookings by status
// ─────────────────────────────────────────────────────────────────
async function computeBookingsByStatus(scope) {
  const rows = await Booking.aggregate([
    {
      $match: withScope(
        { createdAt: { $gte: scope.fromDate, $lte: scope.toDate } },
        scope,
        "garage",
      ),
    },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  // Ensure every known status is present (zeroed) for clean charting
  const all = ["pending", "confirmed", "in_progress", "completed", "cancelled"];
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return all.map((s) => ({ status: s, count: map.get(s) || 0 }));
}

// ─────────────────────────────────────────────────────────────────
// Garage approval breakdown
// ─────────────────────────────────────────────────────────────────
async function computeGarageStatusBreakdown(scope) {
  const filter = scope.garageIds ? { _id: { $in: scope.garageIds } } : {};
  const rows = await Garage.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $ifNull: ["$approvalStatus", "pending"] },
        count: { $sum: 1 },
      },
    },
  ]);
  const all = ["pending", "approved", "rejected"];
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return all.map((s) => ({ status: s, count: map.get(s) || 0 }));
}

// ─────────────────────────────────────────────────────────────────
// Top garages (by revenue)
// ─────────────────────────────────────────────────────────────────
async function computeTopGarages(scope, limit = 5) {
  const rows = await Invoice.aggregate([
    {
      $match: withScope(
        { createdAt: { $gte: scope.fromDate, $lte: scope.toDate } },
        scope,
        "garageId",
      ),
    },
    {
      $group: {
        _id: "$garageId",
        revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
        invoices: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);
  if (rows.length === 0) return [];

  const garages = await Garage.find({ _id: { $in: rows.map((r) => r._id) } })
    .select("garageName garageOwnerName")
    .lean();
  const gMap = new Map(garages.map((g) => [String(g._id), g]));

  return rows.map((r) => {
    const g = gMap.get(String(r._id));
    return {
      garageId: r._id,
      name: g?.garageName || "—",
      ownerName: g?.garageOwnerName || null,
      revenue: r.revenue,
      invoices: r.invoices,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────
async function getAnalytics(filters = {}) {
  const scope = await resolveScope(filters);
  const [
    kpis,
    revenueTrend,
    bookingsByStatus,
    garageStatusBreakdown,
    topGarages,
  ] = await Promise.all([
    computeKpis(scope),
    computeRevenueTrend(scope),
    computeBookingsByStatus(scope),
    computeGarageStatusBreakdown(scope),
    computeTopGarages(scope),
  ]);
  return {
    range: { fromDate: scope.fromDate, toDate: scope.toDate },
    kpis,
    revenueTrend,
    bookingsByStatus,
    garageStatusBreakdown,
    topGarages,
  };
}

async function getMeta() {
  const garages = await Garage.find()
    .select("_id garageName")
    .sort({ garageName: 1 })
    .lean();
  return {
    garages: garages.map((g) => ({
      id: g._id,
      name: g.garageName,
    })),
  };
}

module.exports = { getAnalytics, getMeta };
