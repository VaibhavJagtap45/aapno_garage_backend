// controllers/userAdmin.controller.js
// Admin endpoints for user management across the platform.

const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");

const listUsers = asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (role) filter.role = role;

  if (search?.trim()) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ fullName: rx }, { phoneNo: rx }, { emailId: rx }];
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("fullName phoneNo emailId role isVerified garage activeGarageId franchiseId createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Users fetched", { users, total, page: safePage });
});

const getUserStats = asyncHandler(async (_req, res) => {
  const [total, owners, managers, staff, customers, vendors] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "owner" }),
    User.countDocuments({ role: "manager" }),
    User.countDocuments({ role: { $in: ["staff", "member"] } }),
    User.countDocuments({ role: "customer" }),
    User.countDocuments({ role: "vendor" }),
  ]);
  return sendSuccess(res, 200, "User stats", { total, owners, managers, staff, customers, vendors });
});

module.exports = { listUsers, getUserStats };
