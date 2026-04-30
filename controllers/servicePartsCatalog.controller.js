const XLSX = require("xlsx");
const GarageServiceCatalog = require("../models/GarageServiceCatalog.model");
const Inventory = require("../models/Inventry.model");
const Garage = require("../models/Garage.model");
const Franchise = require("../models/Franchise.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendError, sendSuccess } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const escapeRegex = require("../utils/escapeRegex");

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

const normalizeText = (value) => (value ?? "").toString().trim();

const parseCsvList = (value) =>
  normalizeText(value)
    .split(",")
    .map((v) => normalizeText(v))
    .filter(Boolean);

const buildApplicabilityQuery = ({ brand, model }) => {
  const orConditions = [{ applicability: "generic" }];
  const specificAnd = [{ applicability: "specific" }];

  if (brand) {
    specificAnd.push({
      applicableBrands: {
        $elemMatch: { $regex: new RegExp(`^${escapeRegex(brand)}$`, "i") },
      },
    });
  }
  if (model) {
    specificAnd.push({
      applicableModels: {
        $elemMatch: { $regex: new RegExp(`^${escapeRegex(model)}$`, "i") },
      },
    });
  }

  if (specificAnd.length > 1) {
    orConditions.push({ $and: specificAnd });
  } else {
    orConditions.push({ applicability: "specific" });
  }

  return { $or: orConditions };
};

// Normalize a raw GarageServiceCatalog doc to a consistent shape for the frontend
const mapServiceItem = (item) => ({
  _id: item._id,
  itemType: "service",
  name: item.name,
  no: item.serviceNo || "",        // frontend uses "no" consistently
  serviceNo: item.serviceNo || "",
  category: item.category || "",
  mrp: item.mrp || 0,
  applicability: item.applicability || "generic",
  applicableBrands: item.applicableBrands || [],
  applicableModels: item.applicableModels || [],
  isActive: item.isActive ?? true,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// Normalize a raw Inventory doc to a consistent shape for the frontend
const mapInventoryItem = (item) => ({
  _id: item._id,
  itemType: "part",
  name: item.partName,
  no: item.partCode || "",
  category: item.category || "",
  manufacturer: item.manufacturer || item.brand || "",
  mrp: item.sellingPrice || 0,
  purchasePrice: item.purchasePrice || 0,
  stock: item.quantityInHand || 0,
  minimumStockLevel: item.minimumStockLevel ?? 5,
  manageInventory: item.manageInventory ?? true,
  unit: item.unit || "pcs",
  description: item.description || "",
  taxPercent: item.taxPercent || 0,
  applicability: item.applicability || "generic",
  applicableBrands: item.applicableBrands || [],
  applicableModels: item.applicableModels || [],
  isActive: item.isActive,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/catalog?itemType=service|part
//      &search=&category=&brand=&model=&page=1&limit=100
// ─────────────────────────────────────────────────────────────────
const listCatalogItems = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId)
    return sendError(res, 404, "Garage not found for this account.");

  const {
    itemType,
    search = "",
    category = "",
    brand = "",
    model = "",
    page = 1,
    limit = 100,
  } = req.query;

  if (!["service", "part"].includes(itemType)) {
    return sendError(
      res,
      400,
      "itemType is required and must be 'service' or 'part'.",
    );
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const skip = (safePage - 1) * safeLimit;

  // ── PARTS ───────────────────────────────────────────────────────
  if (itemType === "part") {
    const query = { garageId, isActive: true };
    const andConditions = [
      buildApplicabilityQuery({
        brand: normalizeText(brand),
        model: normalizeText(model),
      }),
    ];

    if (normalizeText(search)) {
      const rx = new RegExp(escapeRegex(normalizeText(search)), "i");
      andConditions.push({
        $or: [
          { partName: rx },
          { partCode: rx },
          { category: rx },
          { brand: rx },
          { manufacturer: rx },
        ],
      });
    }

    if (normalizeText(category)) {
      query.category = new RegExp(`^${escapeRegex(normalizeText(category))}$`, "i");
    }

    query.$and = andConditions;

    const [items, total] = await Promise.all([
      Inventory.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Inventory.countDocuments(query),
    ]);

    return sendSuccess(res, 200, "Parts fetched successfully.", {
      items: items.map(mapInventoryItem),
      pagination: { page: safePage, limit: safeLimit, total },
    });
  }

  // ── SERVICES ────────────────────────────────────────────────────
  const query = { garageId, isDeleted: false };
  const currentGarage = await Garage.findById(garageId).select("franchiseId").lean();
  if (currentGarage?.franchiseId) {
    const franchise = await Franchise.findById(currentGarage.franchiseId)
      .select("sharingPolicy.shareServices")
      .lean();
    if (franchise?.sharingPolicy?.shareServices) {
      const garageIds = await Garage.distinct("_id", {
        franchiseId: currentGarage.franchiseId,
      });
      query.garageId = { $in: garageIds };
    }
  }
  const andConditions = [
    buildApplicabilityQuery({
      brand: normalizeText(brand),
      model: normalizeText(model),
    }),
  ];

  if (normalizeText(search)) {
    const rx = new RegExp(escapeRegex(normalizeText(search)), "i");
    andConditions.push({
      $or: [{ name: rx }, { serviceNo: rx }, { category: rx }],
    });
  }

  if (normalizeText(category)) {
    query.category = new RegExp(`^${escapeRegex(normalizeText(category))}$`, "i");
  }

  query.$and = andConditions;

  const [items, total] = await Promise.all([
    GarageServiceCatalog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    GarageServiceCatalog.countDocuments(query),
  ]);

  return sendSuccess(res, 200, "Services fetched successfully.", {
    items: items.map(mapServiceItem),
    pagination: { page: safePage, limit: safeLimit, total },
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/catalog/categories?itemType=service|part
// ─────────────────────────────────────────────────────────────────
const listCategories = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendSuccess(res, 200, "OK", { categories: [] });

  const { itemType } = req.query;

  let categories = [];
  if (itemType === "part") {
    categories = await Inventory.distinct("category", {
      garageId,
      isActive: true,
    });
  } else {
    const serviceFilter = { garageId, isDeleted: false };
    const currentGarage = await Garage.findById(garageId).select("franchiseId").lean();
    if (currentGarage?.franchiseId) {
      const franchise = await Franchise.findById(currentGarage.franchiseId)
        .select("sharingPolicy.shareServices")
        .lean();
      if (franchise?.sharingPolicy?.shareServices) {
        const garageIds = await Garage.distinct("_id", {
          franchiseId: currentGarage.franchiseId,
        });
        serviceFilter.garageId = { $in: garageIds };
      }
    }

    categories = await GarageServiceCatalog.distinct("category", serviceFilter);
  }

  return sendSuccess(res, 200, "Categories fetched.", {
    categories: categories.filter(Boolean).sort(),
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/catalog
//  Body: { itemType, name, no, category, mrp, purchasePrice, stock,
//          manufacturer, unit, description, taxPercent, manageInventory,
//          minimumStockLevel, applicability, applicableBrands, applicableModels }
// ─────────────────────────────────────────────────────────────────
const createCatalogItem = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId)
    return sendError(res, 404, "Garage not found for this account.");

  const {
    itemType,
    name,
    no = "",
    category = "",
    manufacturer = "",
    unit = "pcs",
    description = "",
    mrp = 0,
    purchasePrice = 0,
    stock = 0,
    minimumStockLevel = 5,
    taxPercent = 0,
    manageInventory = false,
    applicability = "generic",
    applicableBrands = [],
    applicableModels = [],
  } = req.body;

  if (!["service", "part"].includes(itemType))
    return sendError(res, 400, "itemType must be 'service' or 'part'.");
  if (!normalizeText(name)) return sendError(res, 400, "name is required.");

  const normalizedApplicability =
    applicability === "specific" ? "specific" : "generic";
  const normalizedBrands = (
    Array.isArray(applicableBrands)
      ? applicableBrands
      : parseCsvList(applicableBrands)
  )
    .map(normalizeText)
    .filter(Boolean);
  const normalizedModels = (
    Array.isArray(applicableModels)
      ? applicableModels
      : parseCsvList(applicableModels)
  )
    .map(normalizeText)
    .filter(Boolean);

  // ── PART ──────────────────────────────────────────────────────
  if (itemType === "part") {
    const inventoryItem = await Inventory.create({
      garageId,
      partName: normalizeText(name),
      partCode: normalizeText(no) || null,
      category: normalizeText(category) || "general",
      brand: normalizeText(manufacturer) || null,
      manufacturer: normalizeText(manufacturer) || null,
      unit: normalizeText(unit) || "pcs",
      description: normalizeText(description) || null,
      quantityInHand: Number(stock) || 0,
      minimumStockLevel: Number(minimumStockLevel) || 5,
      purchasePrice: Number(purchasePrice) || 0,
      sellingPrice: Number(mrp) || 0,
      taxPercent: Number(taxPercent) || 0,
      manageInventory: Boolean(manageInventory),
      applicability: normalizedApplicability,
      applicableBrands: normalizedBrands,
      applicableModels: normalizedModels,
      isActive: true,
    });

    return sendSuccess(res, 201, "Part created successfully.", {
      item: mapInventoryItem(inventoryItem.toObject()),
    });
  }

  // ── SERVICE ───────────────────────────────────────────────────
  // Auto-generate serviceNo if not provided.
  // Max-based generation is immune to soft-deletes and race conditions.
  let serviceNo = normalizeText(no) || null;
  if (!serviceNo) {
    const existing = await GarageServiceCatalog.find(
      { garageId, serviceNo: { $regex: /^S\d+$/ } },
      { serviceNo: 1 },
    ).lean();
    const maxNum = existing.reduce((max, doc) => {
      const n = parseInt(doc.serviceNo.slice(1), 10);
      return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0);
    serviceNo = `S${String(maxNum + 1).padStart(3, "0")}`;
  }

  const service = await GarageServiceCatalog.create({
    garageId,
    name: normalizeText(name),
    serviceNo,
    category: normalizeText(category) || "Other",
    mrp: Number(mrp) || 0,
    applicability: normalizedApplicability,
    applicableBrands: normalizedBrands,
    applicableModels: normalizedModels,
  });

  return sendSuccess(res, 201, "Service created successfully.", {
    item: mapServiceItem(service.toObject()),
  });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/catalog/:id?itemType=service|part
// ─────────────────────────────────────────────────────────────────
const updateCatalogItem = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId)
    return sendError(res, 404, "Garage not found for this account.");

  const { itemType } = req.query;
  if (!["service", "part"].includes(itemType))
    return sendError(res, 400, "itemType must be 'service' or 'part'.");

  if (itemType === "part") {
    const {
      name,
      no,
      category,
      manufacturer,
      unit,
      description,
      mrp,
      purchasePrice,
      stock,
      minimumStockLevel,
      taxPercent,
      manageInventory,
      applicability,
      applicableBrands,
      applicableModels,
    } = req.body;

    const update = {};
    if (name !== undefined) update.partName = normalizeText(name);
    if (no !== undefined) update.partCode = normalizeText(no) || null;
    if (category !== undefined) update.category = normalizeText(category);
    if (manufacturer !== undefined) {
      update.manufacturer = normalizeText(manufacturer) || null;
      update.brand = normalizeText(manufacturer) || null;
    }
    if (unit !== undefined) update.unit = normalizeText(unit);
    if (description !== undefined)
      update.description = normalizeText(description);
    if (mrp !== undefined) update.sellingPrice = Number(mrp) || 0;
    if (purchasePrice !== undefined)
      update.purchasePrice = Number(purchasePrice) || 0;
    if (stock !== undefined) update.quantityInHand = Number(stock) || 0;
    if (minimumStockLevel !== undefined)
      update.minimumStockLevel = Number(minimumStockLevel) || 5;
    if (taxPercent !== undefined) update.taxPercent = Number(taxPercent) || 0;
    if (manageInventory !== undefined)
      update.manageInventory = Boolean(manageInventory);
    if (applicability !== undefined)
      update.applicability =
        applicability === "specific" ? "specific" : "generic";
    if (applicableBrands !== undefined)
      update.applicableBrands = (
        Array.isArray(applicableBrands)
          ? applicableBrands
          : parseCsvList(applicableBrands)
      )
        .map(normalizeText)
        .filter(Boolean);
    if (applicableModels !== undefined)
      update.applicableModels = (
        Array.isArray(applicableModels)
          ? applicableModels
          : parseCsvList(applicableModels)
      )
        .map(normalizeText)
        .filter(Boolean);

    const item = await Inventory.findOneAndUpdate(
      { _id: req.params.id, garageId, isActive: true },
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();

    if (!item) return sendError(res, 404, "Part not found.");

    return sendSuccess(res, 200, "Part updated successfully.", {
      item: mapInventoryItem(item),
    });
  }

  // SERVICE update
  const {
    name,
    no,
    category,
    mrp,
    applicability,
    applicableBrands,
    applicableModels,
  } = req.body;

  const update = {};
  if (name !== undefined) update.name = normalizeText(name);
  if (no !== undefined) update.serviceNo = normalizeText(no) || null;
  if (category !== undefined) update.category = normalizeText(category);
  if (mrp !== undefined) update.mrp = Number(mrp) || 0;
  if (applicability !== undefined)
    update.applicability =
      applicability === "specific" ? "specific" : "generic";
  if (applicableBrands !== undefined)
    update.applicableBrands = (
      Array.isArray(applicableBrands)
        ? applicableBrands
        : parseCsvList(applicableBrands)
    )
      .map(normalizeText)
      .filter(Boolean);
  if (applicableModels !== undefined)
    update.applicableModels = (
      Array.isArray(applicableModels)
        ? applicableModels
        : parseCsvList(applicableModels)
    )
      .map(normalizeText)
      .filter(Boolean);

  const item = await GarageServiceCatalog.findOneAndUpdate(
    { _id: req.params.id, garageId, isDeleted: false },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!item) return sendError(res, 404, "Service not found.");

  return sendSuccess(res, 200, "Service updated successfully.", {
    item: mapServiceItem(item),
  });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/catalog/:id?itemType=service|part  (soft delete)
// ─────────────────────────────────────────────────────────────────
const deleteCatalogItem = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId)
    return sendError(res, 404, "Garage not found for this account.");

  const { itemType } = req.query;
  if (!["service", "part"].includes(itemType))
    return sendError(res, 400, "itemType must be 'service' or 'part'.");

  if (itemType === "part") {
    const item = await Inventory.findOneAndUpdate(
      { _id: req.params.id, garageId },
      { isActive: false },
      { returnDocument: "after" },
    );
    if (!item) return sendError(res, 404, "Part not found.");
    return sendSuccess(res, 200, "Part deleted successfully.");
  }

  const item = await GarageServiceCatalog.findOneAndUpdate(
    { _id: req.params.id, garageId, isDeleted: false },
    { isDeleted: true },
    { returnDocument: "after" },
  );
  if (!item) return sendError(res, 404, "Service not found.");
  return sendSuccess(res, 200, "Service deleted successfully.");
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/catalog/bulk-upload?itemType=service|part
//  Accepts Excel (.xlsx) or CSV — column names are flexible
//
//  SERVICE columns: name*, no/service_no, category, mrp, applicability,
//                   applicableBrands/brands, applicableModels/models
//  PART columns:    name/partName*, no/code/partCode, category, mrp/sellingPrice,
//                   purchasePrice, stock, manufacturer/brand, unit,
//                   minimumStockLevel, manageInventory,
//                   applicability, applicableBrands/brands, applicableModels/models
// ─────────────────────────────────────────────────────────────────
const bulkUploadCatalogItems = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId)
    return sendError(res, 404, "Garage not found for this account.");

  const itemType = normalizeText(
    req.body?.itemType || req.query?.itemType,
  ).toLowerCase();
  if (!["service", "part"].includes(itemType))
    return sendError(res, 400, "itemType must be 'service' or 'part'.");

  if (!req.file) return sendError(res, 400, "Upload file is required.");

  // Parse file — supports both XLSX and CSV
  let rows = [];
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return sendError(res, 400, "File has no sheets.");
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
      defval: "",
      raw: false,
    });
  } catch (e) {
    return sendError(res, 400, `Could not parse file: ${e.message}`);
  }

  if (!rows.length) return sendError(res, 400, "File has no data rows.");

  const docs = [];
  const failedRows = [];

  rows.forEach((rawRow, index) => {
    // Normalize keys: lowercase + trim
    const row = {};
    Object.keys(rawRow).forEach((k) => {
      row[k.toLowerCase().trim().replace(/\s+/g, "_")] = normalizeText(
        rawRow[k],
      );
    });

    const name =
      row.name ||
      row.servicename ||
      row.partname ||
      row.service_name ||
      row.part_name;
    if (!name) {
      failedRows.push({ row: index + 2, reason: "name is required" });
      return;
    }

    const applicability =
      (row.applicability || "generic").toLowerCase() === "specific"
        ? "specific"
        : "generic";
    const applicableBrands = parseCsvList(
      row.applicablebrands || row.applicable_brands || row.brands || "",
    );
    const applicableModels = parseCsvList(
      row.applicablemodels || row.applicable_models || row.models || "",
    );

    if (
      applicability === "specific" &&
      !applicableBrands.length &&
      !applicableModels.length
    ) {
      failedRows.push({
        row: index + 2,
        reason: "specific applicability needs brands or models",
      });
      return;
    }

    if (itemType === "part") {
      docs.push({
        garageId,
        partName: name,
        partCode: row.no || row.code || row.partcode || row.part_code || null,
        category: row.category || "general",
        brand: row.manufacturer || row.brand || null,
        manufacturer: row.manufacturer || row.brand || null,
        unit: row.unit || "pcs",
        description: row.description || null,
        quantityInHand: Number(row.stock || 0) || 0,
        minimumStockLevel:
          Number(row.minimumstocklevel || row.minimum_stock_level || 5) || 5,
        purchasePrice:
          Number(row.purchaseprice || row.purchase_price || 0) || 0,
        sellingPrice:
          Number(row.mrp || row.sellingprice || row.selling_price || 0) || 0,
        taxPercent: Number(row.taxpercent || row.tax_percent || 0) || 0,
        manageInventory: ["true", "1", "yes"].includes(
          (row.manageinventory || row.manage_inventory || "").toLowerCase(),
        ),
        applicability,
        applicableBrands,
        applicableModels,
        isActive: true,
      });
    } else {
      docs.push({
        garageId,
        name,
        serviceNo: row.no || row.service_no || row.serviceno || null,
        category: row.category || "Other",
        mrp: Number(row.mrp || row.price || 0) || 0,
        applicability,
        applicableBrands,
        applicableModels,
      });
    }
  });

  let insertedCount = 0;
  if (docs.length) {
    const inserted =
      itemType === "part"
        ? await Inventory.insertMany(docs, { ordered: false })
        : await GarageServiceCatalog.insertMany(docs, { ordered: false });
    insertedCount = inserted.length;
  }

  return sendSuccess(res, 200, "Bulk upload completed.", {
    totalRows: rows.length,
    inserted: insertedCount,
    skipped: failedRows.length,
    failedRows,
  });
});

// GET /api/v1/catalog/inventory-stats
const getInventoryStats = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const [result] = await Inventory.aggregate([
    { $match: { garageId, isActive: true } },
    {
      $group: {
        _id:             null,
        totalParts:      { $sum: 1 },
        totalStock:      { $sum: "$quantityInHand" },
        totalStockValue: { $sum: { $multiply: ["$quantityInHand", "$purchasePrice"] } },
      },
    },
  ]);

  return sendSuccess(res, 200, "Inventory stats fetched.", {
    totalParts:      result?.totalParts      ?? 0,
    totalStock:      result?.totalStock      ?? 0,
    totalStockValue: result?.totalStockValue ?? 0,
  });
});

module.exports = {
  listCatalogItems,
  listCategories,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  bulkUploadCatalogItems,
  getInventoryStats,
};
