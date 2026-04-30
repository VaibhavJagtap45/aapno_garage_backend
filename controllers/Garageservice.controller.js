const csv = require("csv-parse/sync");
const GarageServiceCatalog = require("../models/GarageServiceCatalog.model");
const VehicleMeta = require("../models/VehicleMeta.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const escapeRegex = require("../utils/escapeRegex");

// ─────────────────────────────────────────────────────────────────
//  Helper — auto-generate next service number for a garage
// ─────────────────────────────────────────────────────────────────
async function nextServiceNo(garageId) {
  const last = await GarageServiceCatalog.findOne({
    garageId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select("serviceNo")
    .lean();

  if (last?.serviceNo) {
    const num = parseInt(last.serviceNo.replace(/\D/g, ""), 10);
    if (!isNaN(num)) {
      return `S${String(num + 1).padStart(3, "0")}`;
    }
  }

  const count = await GarageServiceCatalog.countDocuments({ garageId });
  return `S${String(count + 1).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/garage-services
//  Query params: search, category, brand, model, page, limit
// ─────────────────────────────────────────────────────────────────
const getServices = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) {
    return sendSuccess(res, 200, "Services fetched.", {
      total: 0,
      services: [],
    });
  }

  const { search, category, brand, model, page = 1, limit = 100 } = req.query;

  const filter = { garageId, isDeleted: false };

  if (category) filter.category = { $regex: escapeRegex(category), $options: "i" };

  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { serviceNo: { $regex: safeSearch, $options: "i" } },
      { category: { $regex: safeSearch, $options: "i" } },
    ];
  }

  // Filter by brand / model — return generic + matching specific
  if (brand || model) {
    const conditions = [{ applicability: "generic" }];

    if (brand) {
      conditions.push({
        applicability: "specific",
        applicableBrands: { $in: [new RegExp(`^${escapeRegex(brand)}$`, "i")] },
      });
    }
    if (model) {
      conditions.push({
        applicability: "specific",
        applicableModels: { $in: [new RegExp(`^${escapeRegex(model)}$`, "i")] },
      });
    }

    // combine with existing filter
    filter.$and = filter.$and
      ? [...filter.$and, { $or: conditions }]
      : [{ $or: conditions }];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [services, total] = await Promise.all([
    GarageServiceCatalog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    GarageServiceCatalog.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, "Services fetched successfully.", {
    total,
    page: parseInt(page),
    services,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/garage-services
//  Body: { name, mrp, serviceNo, category, applicability, applicableBrands, applicableModels }
// ─────────────────────────────────────────────────────────────────
const addService = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) {
    return sendError(res, 404, "Garage not found for this account.");
  }

  const {
    name,
    mrp = 0,
    serviceNo,
    category = "Other",
    applicability = "generic",
    applicableBrands = [],
    applicableModels = [],
  } = req.body;

  if (!name || !name.trim()) {
    return sendError(res, 400, "Service name is required.");
  }

  // Validate brand/model names against VehicleMeta if specific
  if (applicability === "specific" && applicableBrands.length > 0) {
    const found = await VehicleMeta.find({
      brand: { $in: applicableBrands.map((b) => new RegExp(`^${escapeRegex(b)}$`, "i")) },
    }).lean();
    if (found.length !== applicableBrands.length) {
      const foundNames = found.map((f) => f.brand.toLowerCase());
      const invalid = applicableBrands.filter(
        (b) => !foundNames.includes(b.toLowerCase()),
      );
      return sendError(
        res,
        400,
        `Unknown brand(s): ${invalid.join(", ")}. Add them via /api/v1/vehicle/brand first.`,
      );
    }
  }

  const sNo = serviceNo?.trim() || (await nextServiceNo(garageId));

  // Check duplicate serviceNo within garage
  if (sNo) {
    const dup = await GarageServiceCatalog.findOne({
      garageId,
      serviceNo: sNo,
      isDeleted: false,
    });
    if (dup) {
      return sendError(res, 409, `Service number "${sNo}" already exists.`);
    }
  }

  const service = await GarageServiceCatalog.create({
    garageId,
    name: name.trim(),
    mrp: parseFloat(mrp) || 0,
    serviceNo: sNo,
    category: category.trim(),
    applicability,
    applicableBrands,
    applicableModels,
  });

  return sendSuccess(res, 201, "Service added successfully.", { service });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/garage-services/:id
// ─────────────────────────────────────────────────────────────────
const updateService = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const service = await GarageServiceCatalog.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });

  if (!service) return sendError(res, 404, "Service not found.");

  const allowed = [
    "name",
    "mrp",
    "serviceNo",
    "category",
    "applicability",
    "applicableBrands",
    "applicableModels",
    "isActive",
  ];

  allowed.forEach((key) => {
    if (req.body[key] !== undefined) service[key] = req.body[key];
  });

  await service.save();

  return sendSuccess(res, 200, "Service updated successfully.", { service });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/garage-services/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────
const deleteService = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const service = await GarageServiceCatalog.findOneAndUpdate(
    { _id: req.params.id, garageId, isDeleted: false },
    { isDeleted: true },
    { returnDocument: "after" },
  );

  if (!service) return sendError(res, 404, "Service not found.");

  return sendSuccess(res, 200, "Service deleted successfully.");
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/garage-services/bulk-csv
//
//  Accepts multipart/form-data with field "file" containing a CSV/XLSX text.
//  Expected CSV columns (case-insensitive, trimmed):
//    name, mrp, service_no (optional), category (optional),
//    applicability (optional: generic|specific),
//    applicable_brands (optional: comma-separated),
//    applicable_models (optional: comma-separated)
//
//  Returns: { inserted, skipped, errors[] }
// ─────────────────────────────────────────────────────────────────
const bulkImportCsv = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  if (!req.file) {
    return sendError(res, 400, "CSV file is required. Upload as field 'file'.");
  }

  let records;
  try {
    records = csv.parse(req.file.buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    return sendError(res, 400, `CSV parse error: ${e.message}`);
  }

  if (!records.length) {
    return sendError(res, 400, "CSV file is empty.");
  }

  // Normalise column headers (lowercase + underscore)
  const normalise = (row) => {
    const out = {};
    Object.entries(row).forEach(([k, v]) => {
      out[k.toLowerCase().replace(/\s+/g, "_")] = v?.toString().trim() ?? "";
    });
    return out;
  };

  const inserted = [];
  const skippedRows = [];
  const errors = [];

  for (let i = 0; i < records.length; i++) {
    const row = normalise(records[i]);
    const rowNum = i + 2; // 1-based + header row

    const name = row.name || row.service_name || row.servicename;
    if (!name) {
      errors.push({ row: rowNum, reason: "Missing 'name' column." });
      continue;
    }

    const mrp = parseFloat(row.mrp || row.price || "0") || 0;
    const category = row.category || "Other";
    const serviceNo =
      row.service_no || row.serviceno || row.service_number || null;
    const applicability =
      (row.applicability || "generic").toLowerCase() === "specific"
        ? "specific"
        : "generic";

    const applicableBrands = row.applicable_brands
      ? row.applicable_brands
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean)
      : [];

    const applicableModels = row.applicable_models
      ? row.applicable_models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean)
      : [];

    // Check for duplicate name within this garage (skip silently)
    const dupName = await GarageServiceCatalog.findOne({
      garageId,
      name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
      isDeleted: false,
    });

    if (dupName) {
      skippedRows.push({ row: rowNum, name, reason: "Duplicate name" });
      continue;
    }

    const sNo = serviceNo || (await nextServiceNo(garageId));

    try {
      const service = await GarageServiceCatalog.create({
        garageId,
        name,
        mrp,
        serviceNo: sNo,
        category,
        applicability,
        applicableBrands,
        applicableModels,
      });
      inserted.push(service._id);
    } catch (e) {
      errors.push({ row: rowNum, name, reason: e.message });
    }
  }

  return sendSuccess(res, 200, "CSV import completed.", {
    inserted: inserted.length,
    skipped: skippedRows.length,
    skippedRows,
    errors,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/garage-services/categories
//  Returns distinct categories used by this garage
// ─────────────────────────────────────────────────────────────────
const getCategories = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendSuccess(res, 200, "OK", { categories: [] });

  const cats = await GarageServiceCatalog.distinct("category", {
    garageId,
    isDeleted: false,
  });

  return sendSuccess(res, 200, "Categories fetched.", {
    categories: cats.sort(),
  });
});

module.exports = {
  getServices,
  addService,
  updateService,
  deleteService,
  bulkImportCsv,
  getCategories,
};
