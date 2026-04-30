const router = require("express").Router();
const protect = require("../middlewares/auth");

// Vehicle CRUD (add/get real vehicles linked to customers)
const {
  addVehicle,
  getVehiclesByUser,
  getVehicleById,
  updateVehicle,
} = require("../controllers/vehicle.controller");

// Vehicle meta (brands/models master list for dropdowns)
const {
  bulkUpsertMeta,
  addBrand,
  addModel,
  getMetaBrands,
  getMetaModelsByBrand,
} = require("../controllers/vehicleMeta.controller");

// ── All routes require authentication — must be FIRST ─────────────
router.use(protect);

// ─────────────────────────────────────────────────────────────────
//  Vehicle Meta routes — MUST be before /:vehicleId wildcard
// ─────────────────────────────────────────────────────────────────

// POST /api/v1/vehicle/bulk
//   Body : single object OR array of { type, brand, models[] }
//   Use  : Postman seed upload — upserts brands and merges models
router.post("/bulk", bulkUpsertMeta);

// POST /api/v1/vehicle/brand
//   Body : { type: "2W", brand: "Honda", models: ["Activa", "Shine"] }
router.post("/brand", addBrand);

// POST /api/v1/vehicle/model
//   Body : { type: "2W", brand: "Honda", model: "CB300R" }
router.post("/model", addModel);

// GET /api/v1/vehicle/brands?type=2W  — all brands (optionally filtered)
router.get("/brands", getMetaBrands);

// GET /api/v1/vehicle/models?brand=Honda&type=2W
router.get("/models", getMetaModelsByBrand);

// ─────────────────────────────────────────────────────────────────
//  Vehicle CRUD routes — wildcard /:vehicleId must come last
// ─────────────────────────────────────────────────────────────────

// POST /api/v1/vehicle/add  — add vehicle to existing customer
router.post("/add", addVehicle);

// GET /api/v1/vehicle/customer/:customerId — all vehicles of a customer + user info
router.get("/customer/:customerId", getVehiclesByUser);

// PUT /api/v1/vehicle/:vehicleId — update vehicle fields
router.put("/:vehicleId", updateVehicle);

// GET /api/v1/vehicle/:vehicleId — single vehicle with customer info populated
router.get("/:vehicleId", getVehicleById);

module.exports = router;
