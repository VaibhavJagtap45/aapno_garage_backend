// ─── purchaseOrder.routes.js ──────────────────────────────────────
const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkFeature = require("../middlewares/checkFeature");
const {
  listPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getVendorsDue,
} = require("../controllers/PurchaseOrder.controller");

router.use(protect, checkSubscription, checkFeature("purchase_orders"));

// GET  /api/v1/purchase-orders/vendors-due
router.get("/vendors-due", getVendorsDue);

// GET  /api/v1/purchase-orders
router.get("/", listPurchaseOrders);

// POST /api/v1/purchase-orders
router.post("/", createPurchaseOrder);

// PUT  /api/v1/purchase-orders/:id
router.put("/:id", updatePurchaseOrder);

// DELETE /api/v1/purchase-orders/:id
router.delete("/:id", deletePurchaseOrder);

module.exports = router;
