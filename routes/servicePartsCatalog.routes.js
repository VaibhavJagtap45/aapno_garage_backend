// const router = require("express").Router();
// const multer = require("multer");
// const protect = require("../middlewares/auth");
// const {
//   listCatalogItems,
//   createCatalogItem,
//   bulkUploadCatalogItems,
// } = require("../controllers/servicePartsCatalog.controller");

// const upload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 5 * 1024 * 1024 },
// });

// router.use(protect);

// router.get("/", listCatalogItems);
// router.post("/", createCatalogItem);
// router.post("/bulk-upload", upload.single("file"), bulkUploadCatalogItems);

// module.exports = router;

const router = require("express").Router();
const multer = require("multer");
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkFeature = require("../middlewares/checkFeature");
const {
  listCatalogItems,
  listCategories,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  bulkUploadCatalogItems,
  getInventoryStats,
} = require("../controllers/servicePartsCatalog.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "text/csv",
      "text/plain",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (
      allowed.includes(file.mimetype) ||
      /\.(csv|xlsx|xls)$/i.test(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and Excel files are accepted."));
    }
  },
});

router.use(protect, checkSubscription);

// GET  /api/v1/catalog/inventory-stats
router.get("/inventory-stats", getInventoryStats);

// GET  /api/v1/catalog?itemType=service|part&search=&category=&brand=&model=&page=&limit=
router.get("/", listCatalogItems);

// GET  /api/v1/catalog/categories?itemType=service|part
router.get("/categories", listCategories);

// POST /api/v1/catalog   — create one item (service or part)
router.post("/", createCatalogItem);

// POST /api/v1/catalog/bulk-upload?itemType=service|part  — file upload (field: "file") (feature-gated)
router.post("/bulk-upload", checkFeature("bulk_upload"), upload.single("file"), bulkUploadCatalogItems);

// PUT  /api/v1/catalog/:id?itemType=service|part
router.put("/:id", updateCatalogItem);

// DELETE /api/v1/catalog/:id?itemType=service|part  (soft delete)
router.delete("/:id", deleteCatalogItem);

module.exports = router;
