const VehicleMeta = require("../models/VehicleMeta.model");
const { VEHICLE_TYPES } = require("../models/VehicleMeta.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const escapeRegex = require("../utils/escapeRegex");

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

/** Owner-only guard. Returns true if blocked. */
const isNotOwner = (req, res) => {
  if (req.user.role !== "owner") {
    sendError(res, 403, "Only owners can manage vehicle meta data.");
    return true;
  }
  return false;
};

/** Normalize + de-dupe a list of model strings (case-insensitive). */
const cleanModels = (raw = []) => {
  const seen = new Set();
  const out = [];
  for (const m of raw) {
    if (typeof m !== "string") continue;
    const trimmed = m.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

/** Validate a single record `{ type, brand, models }`. Returns error string or null. */
const validateRecord = (rec, idx) => {
  if (!rec || typeof rec !== "object") return `Item #${idx}: invalid payload`;
  const { type, brand, models } = rec;
  if (!type || !VEHICLE_TYPES.includes(String(type).toUpperCase())) {
    return `Item #${idx} (${brand || "unknown"}): "type" must be one of ${VEHICLE_TYPES.join(", ")}`;
  }
  if (!brand || typeof brand !== "string" || !brand.trim()) {
    return `Item #${idx}: "brand" is required`;
  }
  if (models !== undefined && !Array.isArray(models)) {
    return `Item #${idx} (${brand}): "models" must be an array`;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────
//  BULK UPSERT — for Postman / seed data
//  Route : POST /api/v1/vehicle/bulk
//  Body  : single object OR array of { type, brand, models[] }
//  Behavior:
//    - Existing (type, brand) → merges new models (no duplicates)
//    - New (type, brand)      → creates document
//    - Per-record validation, returns full report
// ─────────────────────────────────────────────────────────────────
const bulkUpsertMeta = asyncHandler(async (req, res) => {
  if (isNotOwner(req, res)) return;

  // Accept either a single object or an array
  const payload = Array.isArray(req.body) ? req.body : [req.body];

  if (payload.length === 0) {
    return sendError(res, 400, "Request body must be a non-empty object or array.");
  }

  // ── Phase 1: validate everything up front ──────────────────────
  const validationErrors = [];
  const normalized = [];

  payload.forEach((rec, idx) => {
    const err = validateRecord(rec, idx);
    if (err) {
      validationErrors.push(err);
      return;
    }
    normalized.push({
      idx,
      type:  String(rec.type).toUpperCase().trim(),
      brand: rec.brand.trim(),
      models: cleanModels(rec.models),
    });
  });

  if (validationErrors.length > 0) {
    return sendError(res, 400, "Validation failed for one or more items.", {
      errors: validationErrors,
    });
  }

  // ── Phase 2: load existing docs in one query ───────────────────
  const existing = await VehicleMeta.find({
    $or: normalized.map((n) => ({
      type: n.type,
      brand: { $regex: new RegExp(`^${escapeRegex(n.brand)}$`, "i") },
    })),
  }).lean();

  const existingMap = new Map(
    existing.map((d) => [`${d.type}::${d.brand.toLowerCase()}`, d]),
  );

  // ── Phase 3: build bulkWrite ops ───────────────────────────────
  const ops = [];
  const report = { created: [], updated: [], unchanged: [] };

  for (const rec of normalized) {
    const key = `${rec.type}::${rec.brand.toLowerCase()}`;
    const found = existingMap.get(key);

    if (found) {
      const existingLower = (found.models || []).map((m) => m.toLowerCase());
      const newOnes = rec.models.filter(
        (m) => !existingLower.includes(m.toLowerCase()),
      );

      if (newOnes.length === 0) {
        report.unchanged.push({
          type: rec.type,
          brand: found.brand,
          message: "All models already present",
        });
        continue;
      }

      ops.push({
        updateOne: {
          filter: { _id: found._id },
          update: { $addToSet: { models: { $each: newOnes } } },
        },
      });

      report.updated.push({
        type: rec.type,
        brand: found.brand,
        addedModels: newOnes,
        addedCount: newOnes.length,
      });
    } else {
      ops.push({
        updateOne: {
          filter: { type: rec.type, brand: rec.brand },
          update: { $setOnInsert: { type: rec.type, brand: rec.brand, models: rec.models } },
          upsert: true,
        },
      });

      report.created.push({
        type: rec.type,
        brand: rec.brand,
        modelCount: rec.models.length,
      });
    }
  }

  if (ops.length > 0) {
    await VehicleMeta.bulkWrite(ops, { ordered: false });
  }

  return sendSuccess(res, 200, "Bulk upsert complete.", {
    summary: {
      received:  payload.length,
      created:   report.created.length,
      updated:   report.updated.length,
      unchanged: report.unchanged.length,
    },
    ...report,
  });
});

// ─────────────────────────────────────────────────────────────────
//  ADD SINGLE BRAND
//  Route : POST /api/v1/vehicle/brand
//  Body  : { type, brand, models: [] }
// ─────────────────────────────────────────────────────────────────
const addBrand = asyncHandler(async (req, res) => {
  if (isNotOwner(req, res)) return;

  const err = validateRecord(req.body, 0);
  if (err) return sendError(res, 400, err);

  const type   = String(req.body.type).toUpperCase().trim();
  const brand  = req.body.brand.trim();
  const models = cleanModels(req.body.models);

  const existing = await VehicleMeta.findOne({
    type,
    brand: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
  });

  if (existing) {
    const existingLower = existing.models.map((m) => m.toLowerCase());
    const newModels = models.filter((m) => !existingLower.includes(m.toLowerCase()));

    if (newModels.length === 0) {
      return sendError(res, 409, `Brand "${brand}" (${type}) already exists with all provided models.`);
    }

    existing.models.push(...newModels);
    await existing.save();

    return sendSuccess(res, 200, "Models added to existing brand.", {
      vehicleMeta: existing,
      addedModels: newModels,
    });
  }

  const vehicleMeta = await VehicleMeta.create({ type, brand, models });
  return sendSuccess(res, 201, "Brand added successfully.", { vehicleMeta });
});

// ─────────────────────────────────────────────────────────────────
//  ADD MODEL TO EXISTING BRAND
//  Route : POST /api/v1/vehicle/model
//  Body  : { type, brand, model }
// ─────────────────────────────────────────────────────────────────
const addModel = asyncHandler(async (req, res) => {
  if (isNotOwner(req, res)) return;

  const { type, brand, model } = req.body;

  if (!type || !VEHICLE_TYPES.includes(String(type).toUpperCase())) {
    return sendError(res, 400, `"type" must be one of ${VEHICLE_TYPES.join(", ")}`);
  }
  if (!brand || !model) {
    return sendError(res, 400, "brand and model both are required.");
  }

  const normType  = String(type).toUpperCase().trim();
  const trimModel = String(model).trim();

  const vehicleMeta = await VehicleMeta.findOne({
    type: normType,
    brand: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
  });

  if (!vehicleMeta) {
    return sendError(res, 404, `Brand "${brand}" (${normType}) not found. Add the brand first.`);
  }

  const alreadyExists = vehicleMeta.models.some(
    (m) => m.toLowerCase() === trimModel.toLowerCase(),
  );

  if (alreadyExists) {
    return sendError(res, 409, `Model "${trimModel}" already exists under "${brand}" (${normType}).`);
  }

  vehicleMeta.models.push(trimModel);
  await vehicleMeta.save();

  return sendSuccess(res, 200, "Model added successfully.", { vehicleMeta });
});

// ─────────────────────────────────────────────────────────────────
//  GET ALL BRANDS (optionally filtered by ?type=2W)
//  Route : GET /api/v1/vehicle/brands?type=2W
// ─────────────────────────────────────────────────────────────────
const getMetaBrands = asyncHandler(async (req, res) => {
  const { type } = req.query;
  const filter = {};

  if (type) {
    const normType = String(type).toUpperCase().trim();
    if (!VEHICLE_TYPES.includes(normType)) {
      return sendError(res, 400, `"type" must be one of ${VEHICLE_TYPES.join(", ")}`);
    }
    filter.type = normType;
  }

  const docs = await VehicleMeta.find(filter, "type brand").sort({ brand: 1 }).lean();

  return sendSuccess(res, 200, "Brands fetched successfully.", {
    total:  docs.length,
    brands: docs.map((d) => d.brand),
    items:  docs.map((d) => ({ type: d.type, brand: d.brand })),
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET MODELS BY BRAND (optionally scoped by ?type=2W)
//  Route : GET /api/v1/vehicle/models?brand=Honda&type=2W
// ─────────────────────────────────────────────────────────────────
const getMetaModelsByBrand = asyncHandler(async (req, res) => {
  const { brand, type } = req.query;

  if (!brand) {
    return sendError(res, 400, "brand query param is required.");
  }

  const filter = {
    brand: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
  };

  if (type) {
    const normType = String(type).toUpperCase().trim();
    if (!VEHICLE_TYPES.includes(normType)) {
      return sendError(res, 400, `"type" must be one of ${VEHICLE_TYPES.join(", ")}`);
    }
    filter.type = normType;
  }

  // If type isn't passed and the same brand exists for multiple types,
  // merge models from all matches.
  const matches = await VehicleMeta.find(filter).lean();

  if (matches.length === 0) {
    return sendError(res, 404, `Brand "${brand}"${type ? ` (${type})` : ""} not found.`);
  }

  const merged = cleanModels(matches.flatMap((m) => m.models || []));

  return sendSuccess(res, 200, "Models fetched successfully.", {
    brand:  matches[0].brand,
    type:   type ? String(type).toUpperCase() : matches.map((m) => m.type),
    total:  merged.length,
    models: merged.sort(),
  });
});

module.exports = {
  bulkUpsertMeta,
  addBrand,
  addModel,
  getMetaBrands,
  getMetaModelsByBrand,
};
