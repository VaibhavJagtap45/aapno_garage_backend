const router = require("express").Router();
const multer = require("multer");
const protect = require("../middlewares/auth");
const {
  getServices,
  addService,
  updateService,
  deleteService,
  bulkImportCsv,
  getCategories,
} = require("../controllers/Garageservice.controller");

// Store uploaded CSV in memory (no disk writes needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["text/csv", "application/vnd.ms-excel", "text/plain"];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted."));
    }
  },
});

const checkSubscription = require("../middlewares/checkSubscription");
const checkFeature = require("../middlewares/checkFeature");

// All routes require authentication.
router.use(protect, checkSubscription);

// ── Service Catalog CRUD ──────────────────────────────────────────

// GET  /api/v1/garage-services?search=&category=&brand=&model=&page=&limit=
router.get("/", getServices);

// GET  /api/v1/garage-services/categories
router.get("/categories", getCategories);

// POST /api/v1/garage-services
router.post("/", addService);

// POST /api/v1/garage-services/bulk-csv  (multipart, field: "file") (feature-gated)
router.post("/bulk-csv", checkFeature("bulk_upload"), upload.single("file"), bulkImportCsv);

// PUT  /api/v1/garage-services/:id
router.put("/:id", updateService);

// DELETE /api/v1/garage-services/:id  (soft delete)
router.delete("/:id", deleteService);

module.exports = router;
