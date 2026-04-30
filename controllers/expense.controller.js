const Expense = require("../models/Expense.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const { resolveFranchiseAccountsScope, garageFilter } = require("../utils/resolveFranchiseAccountsScope");

function buildDateFilter(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return {};
  const f = {};
  if (dateFrom) f.$gte = new Date(dateFrom);
  if (dateTo)   f.$lte = new Date(dateTo);
  return { date: f };
}

const listExpenses = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo, page = 1, limit = 100 } = req.query;
  const safePage  = Math.max(Number(page)  || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const skip = (safePage - 1) * safeLimit;

  const filter = { garageId: garageFilter(scope), isDeleted: false, ...buildDateFilter(dateFrom, dateTo) };

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate("garageId", "garageName")
      .sort({ date: -1 }).skip(skip).limit(safeLimit).lean(),
    Expense.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Expenses fetched.", {
    expenses, total, page: safePage,
    isFranchiseView: scope.isFranchiseView,
    isPrimaryBranch: scope.isPrimaryBranch,
    branches: scope.isPrimaryBranch ? scope.branches : undefined,
  });
});

const getExpenseStats = asyncHandler(async (req, res) => {
  const scope = await resolveFranchiseAccountsScope(req.user, req.query.branch);
  if (!scope) return sendError(res, 404, "Garage not found.");

  const { dateFrom, dateTo } = req.query;
  const filter = { garageId: garageFilter(scope), isDeleted: false, ...buildDateFilter(dateFrom, dateTo) };

  const [result] = await Expense.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total:  { $sum: "$amount" },
        paid:   { $sum: { $cond: [{ $eq: ["$paidStatus", "paid"] }, "$amount", 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$paidStatus", "credit"] }, "$amount", 0] } },
      },
    },
  ]);

  return sendSuccess(res, 200, "Expense stats fetched.", {
    total:  result?.total  ?? 0,
    paid:   result?.paid   ?? 0,
    credit: result?.credit ?? 0,
  });
});

// POST /api/v1/expenses
const createExpense = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { category, description, amount, date, paymentMethod, notes, paidStatus } = req.body;
  if (!amount || amount < 0) return sendError(res, 400, "amount is required.");
  if (!date)                 return sendError(res, 400, "date is required.");

  const expense = await Expense.create({
    garageId,
    category:      category      || "misc",
    description:   description?.trim() || "",
    amount:        Number(amount),
    date:          new Date(date),
    paymentMethod: paymentMethod || "CASH",
    notes:         notes?.trim() || "",
    paidStatus:    paidStatus    || "paid",
  });

  return sendSuccess(res, 201, "Expense created.", { expense });
});

// DELETE /api/v1/expenses/:id
const deleteExpense = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const expense = await Expense.findOne({ _id: req.params.id, garageId, isDeleted: false });
  if (!expense) return sendError(res, 404, "Expense not found.");

  expense.isDeleted = true;
  await expense.save();

  return sendSuccess(res, 200, "Expense deleted.");
});

module.exports = { listExpenses, getExpenseStats, createExpense, deleteExpense };
