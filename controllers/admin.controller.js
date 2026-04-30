// controllers/admin.controller.js
//
// Thin HTTP layer. Validates request shape, calls a service, shapes the
// response. No DB calls, no business logic.

const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response.utils");
const garageService = require("../services/garage.service");
const { BadRequestError, UnauthorizedError } = require("../core/errors");
const {
  ACCESS_TOKEN_EXPIRY,
  getTokenExpiryDate,
} = require("../utils/token.utils");

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/admin/login
// ─────────────────────────────────────────────────────────────────
const adminLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    throw new BadRequestError("username and password are required.");
  }
  if (username !== "admin" || password !== "admin") {
    throw new UnauthorizedError("Invalid credentials.");
  }
  const token = jwt.sign(
    { role: "superadmin", username: "admin" },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );
  return sendSuccess(res, 200, "Login successful", {
    token,
    tokenExpiresAt: getTokenExpiryDate(token)?.toISOString() ?? null,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/admin/garages
// ─────────────────────────────────────────────────────────────────
const getAllGarages = asyncHandler(async (req, res) => {
  const garages = await garageService.listGarages({
    status: req.query.status,
    ownerId: req.query.ownerId,
    franchiseId: req.query.franchiseId,
  });
  return sendSuccess(res, 200, "Garages fetched", { garages });
});

const getGarageStats = asyncHandler(async (_req, res) => {
  const stats = await garageService.getGarageStats();
  return sendSuccess(res, 200, "Stats fetched", stats);
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/admin/garages
//  Body supports two modes:
//    1. Existing owner: { ownerId, garage… }
//    2. New owner:      { phoneNo, fullName?, emailId?, garage… }
//  Optional: setAsDefault (boolean)
// ─────────────────────────────────────────────────────────────────
const createGarage = asyncHandler(async (req, res) => {
  const { ownerId, phoneNo } = req.body || {};
  if (!ownerId && !phoneNo) {
    throw new BadRequestError(
      "Provide either ownerId (existing owner) or phoneNo (to create a new owner).",
    );
  }
  const result = await garageService.createGarage(req.body);
  return sendSuccess(res, 201, "Garage created successfully", result);
});

const updateGarage = asyncHandler(async (req, res) => {
  const garage = await garageService.updateGarage(req.params.id, req.body);
  return sendSuccess(res, 200, "Garage updated successfully", { garage });
});

const deleteGarage = asyncHandler(async (req, res) => {
  const result = await garageService.deleteGarage(req.params.id);
  return sendSuccess(res, 200, "Garage deleted successfully", result);
});

const approveGarage = asyncHandler(async (req, res) => {
  const garage = await garageService.setApprovalStatus(req.params.id, "approved");
  return sendSuccess(res, 200, "Garage approved", { garage });
});

const rejectGarage = asyncHandler(async (req, res) => {
  const garage = await garageService.setApprovalStatus(req.params.id, "rejected");
  return sendSuccess(res, 200, "Garage rejected", { garage });
});

module.exports = {
  adminLogin,
  getAllGarages,
  getGarageStats,
  createGarage,
  updateGarage,
  deleteGarage,
  approveGarage,
  rejectGarage,
};
