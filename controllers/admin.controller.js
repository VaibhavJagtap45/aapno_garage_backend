// controllers/admin.controller.js
//
// Thin HTTP layer. Validates request shape, calls a service, shapes the
// response. No DB calls, no business logic.

const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/response.utils");
const garageService = require("../services/garage.service");
const VehicleMeta = require("../models/VehicleMeta.model");
const { VEHICLE_TYPES } = require("../models/VehicleMeta.model");
const escapeRegex = require("../utils/escapeRegex");
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
  });
  return sendSuccess(res, 200, "Garages fetched", { garages });
});

const getGarageDetail = asyncHandler(async (req, res) => {
  const detail = await garageService.getGarageDetail(req.params.id);
  return sendSuccess(res, 200, "Garage detail fetched", detail);
});

const getGarageStats = asyncHandler(async (_req, res) => {
  const stats = await garageService.getGarageStats();
  return sendSuccess(res, 200, "Stats fetched", stats);
});

const cleanModels = (raw = []) => {
  const seen = new Set();
  const out = [];
  for (const model of raw) {
    const trimmed = String(model || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

const normalizeVehicleType = (type = "2W") => {
  const normalized = String(type).toUpperCase().trim();
  if (!VEHICLE_TYPES.includes(normalized)) {
    throw new BadRequestError(`type must be one of ${VEHICLE_TYPES.join(", ")}.`);
  }
  return normalized;
};

const getVehicleMeta = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = normalizeVehicleType(req.query.type);

  const items = await VehicleMeta.find(filter).sort({ type: 1, brand: 1 }).lean();
  return sendSuccess(res, 200, "Vehicle meta fetched", {
    items,
    total: items.length,
  });
});

const addVehicleBrand = asyncHandler(async (req, res) => {
  const type = normalizeVehicleType(req.body?.type || "2W");
  const brand = String(req.body?.brand || "").trim();
  const models = cleanModels(req.body?.models || []);

  if (!brand) throw new BadRequestError("brand is required.");

  const existing = await VehicleMeta.findOne({
    type,
    brand: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
  });

  if (existing) {
    const current = new Set(existing.models.map((m) => m.toLowerCase()));
    const additions = models.filter((m) => !current.has(m.toLowerCase()));
    if (additions.length) {
      existing.models.push(...additions);
      await existing.save();
    }
    return sendSuccess(res, additions.length ? 200 : 200, "Brand already exists", {
      vehicleMeta: existing,
      addedModels: additions,
    });
  }

  const vehicleMeta = await VehicleMeta.create({ type, brand, models });
  return sendSuccess(res, 201, "Brand added successfully", { vehicleMeta });
});

const addVehicleModel = asyncHandler(async (req, res) => {
  const type = normalizeVehicleType(req.body?.type || "2W");
  const brand = String(req.body?.brand || "").trim();
  const model = String(req.body?.model || "").trim();

  if (!brand || !model) throw new BadRequestError("brand and model are required.");

  const vehicleMeta = await VehicleMeta.findOne({
    type,
    brand: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
  });

  if (!vehicleMeta) {
    const created = await VehicleMeta.create({ type, brand, models: [model] });
    return sendSuccess(res, 201, "Brand and model added successfully", {
      vehicleMeta: created,
      addedModels: [model],
    });
  }

  const exists = vehicleMeta.models.some((m) => m.toLowerCase() === model.toLowerCase());
  if (!exists) {
    vehicleMeta.models.push(model);
    await vehicleMeta.save();
  }

  return sendSuccess(res, exists ? 200 : 200, exists ? "Model already exists" : "Model added successfully", {
    vehicleMeta,
    addedModels: exists ? [] : [model],
  });
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
  getGarageDetail,
  getGarageStats,
  getVehicleMeta,
  addVehicleBrand,
  addVehicleModel,
  createGarage,
  updateGarage,
  deleteGarage,
  approveGarage,
  rejectGarage,
};
