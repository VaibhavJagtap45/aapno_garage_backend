// controllers/payroll.controller.js
// ─────────────────────────────────────────────────────────────────
//  Mechanic payroll: base salary, monthly completed-service count, and
//  the flat bonus a mechanic earns when they cross the monthly threshold.
//  Scoped to the authenticated owner/manager's garage.
// ─────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");
const User = require("../models/User.model");
const RepairOrder = require("../models/RepairOrder.model");
const Expense = require("../models/Expense.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const {
  BONUS_SERVICE_THRESHOLD,
  BONUS_PERCENT,
  computePayout,
} = require("../config/payroll");

// Resolve a "YYYY-MM" string to an inclusive-start / exclusive-end range.
// Defaults to the current month.
function monthRange(monthStr) {
  let year;
  let month;
  if (/^\d{4}-\d{2}$/.test(monthStr || "")) {
    [year, month] = monthStr.split("-").map(Number);
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0); // exclusive
  const label = `${year}-${String(month).padStart(2, "0")}`;
  return { start, end, label };
}

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/payroll?month=YYYY-MM
//  One row per mechanic (member) with base salary, services completed
//  that month, and the resulting bonus + total payable.
// ─────────────────────────────────────────────────────────────────
const getPayroll = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { start, end, label } = monthRange(req.query.month);

  const mechanics = await User.find({ garage: garageId, role: "member" })
    .select("fullName phoneNo baseSalary")
    .sort({ fullName: 1 })
    .lean();

  // Completed-service counts for the month, grouped by mechanic — one query.
  const counts = await RepairOrder.aggregate([
    {
      $match: {
        garageId: new mongoose.Types.ObjectId(String(garageId)),
        status: "completed",
        isDeleted: false,
        assignedTo: { $ne: null },
        completedAt: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: "$assignedTo", count: { $sum: 1 } } },
  ]);
  const countByMechanic = Object.fromEntries(
    counts.map((c) => [String(c._id), c.count]),
  );

  // Which mechanics have already been paid for this month? One query.
  const paidDocs = await Expense.find({
    garageId,
    category: "salary",
    payrollMonth: label,
    mechanicId: { $ne: null },
    isDeleted: false,
  })
    .select("mechanicId amount createdAt")
    .lean();
  const paidByMechanic = Object.fromEntries(
    paidDocs.map((d) => [String(d.mechanicId), d]),
  );

  const rows = mechanics.map((m) => {
    const servicesCompleted = countByMechanic[String(m._id)] || 0;
    const paidDoc = paidByMechanic[String(m._id)];
    return {
      mechanicId: m._id,
      fullName: m.fullName,
      phoneNo: m.phoneNo,
      ...computePayout(m.baseSalary, servicesCompleted),
      // Per-month payout status: "done" once recorded, else "pending".
      salaryStatus: paidDoc ? "paid" : "pending",
      paidAmount: paidDoc ? paidDoc.amount : 0,
      paidAt: paidDoc ? paidDoc.createdAt : null,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.baseSalary += r.baseSalary;
      acc.bonusAmount += r.bonusAmount;
      acc.totalPayable += r.totalPayable;
      acc.servicesCompleted += r.servicesCompleted;
      if (r.salaryStatus === "paid") {
        acc.paidAmount += r.paidAmount;
        acc.paidCount += 1;
      } else if (r.totalPayable > 0) {
        acc.pendingAmount += r.totalPayable;
        acc.pendingCount += 1;
      }
      return acc;
    },
    {
      baseSalary: 0,
      bonusAmount: 0,
      totalPayable: 0,
      servicesCompleted: 0,
      paidAmount: 0,
      pendingAmount: 0,
      paidCount: 0,
      pendingCount: 0,
    },
  );

  return sendSuccess(res, 200, "Payroll fetched.", {
    month: label,
    threshold: BONUS_SERVICE_THRESHOLD,
    bonusPercent: BONUS_PERCENT,
    mechanics: rows,
    totals,
  });
});

// ─────────────────────────────────────────────────────────────────
//  PATCH /api/v1/payroll/:mechanicId/salary
//  Body: { baseSalary: number }
// ─────────────────────────────────────────────────────────────────
const setMechanicSalary = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { baseSalary } = req.body;
  if (baseSalary == null || Number.isNaN(Number(baseSalary)) || Number(baseSalary) < 0) {
    return sendError(res, 400, "baseSalary must be a number >= 0.");
  }

  const mechanic = await User.findOneAndUpdate(
    { _id: req.params.mechanicId, garage: garageId, role: "member" },
    { $set: { baseSalary: Number(baseSalary) } },
    { returnDocument: "after", runValidators: true },
  )
    .select("fullName phoneNo baseSalary")
    .lean();

  if (!mechanic) return sendError(res, 404, "Mechanic not found in your garage.");
  return sendSuccess(res, 200, "Salary updated.", { mechanic });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/payroll/:mechanicId/pay
//  Records the month's payout (base + bonus) as a garage salary expense.
//  Body/query: { month?: "YYYY-MM", paymentMethod? }
// ─────────────────────────────────────────────────────────────────
const paySalary = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { start, end, label } = monthRange(req.query.month || req.body.month);

  const mechanic = await User.findOne({
    _id: req.params.mechanicId,
    garage: garageId,
    role: "member",
  })
    .select("fullName baseSalary")
    .lean();
  if (!mechanic) return sendError(res, 404, "Mechanic not found in your garage.");

  // Guard double payment — one salary record per mechanic per month.
  const alreadyPaid = await Expense.findOne({
    garageId,
    category: "salary",
    mechanicId: mechanic._id,
    payrollMonth: label,
    isDeleted: false,
  }).lean();
  if (alreadyPaid) {
    return sendError(
      res,
      409,
      `${mechanic.fullName || "This mechanic"}'s salary for ${label} is already recorded.`,
    );
  }

  const servicesCompleted = await RepairOrder.countDocuments({
    garageId,
    assignedTo: mechanic._id,
    status: "completed",
    isDeleted: false,
    completedAt: { $gte: start, $lt: end },
  });
  const payout = computePayout(mechanic.baseSalary, servicesCompleted);

  const expense = await Expense.create({
    garageId,
    category: "salary",
    description: `Salary ${label} — ${mechanic.fullName || "mechanic"}`,
    amount: payout.totalPayable,
    date: new Date(),
    paymentMethod: req.body.paymentMethod || "CASH",
    notes: payout.bonusEligible
      ? `Base ₹${payout.baseSalary} + ${payout.bonusPercent}% bonus ₹${payout.bonusAmount} (${servicesCompleted} services)`
      : `Base ₹${payout.baseSalary} (${servicesCompleted} services)`,
    paidStatus: "paid",
    mechanicId: mechanic._id,
    payrollMonth: label,
  });

  return sendSuccess(res, 201, "Salary recorded as expense.", {
    expense,
    payout,
    month: label,
  });
});

module.exports = { getPayroll, setMechanicSalary, paySalary };
