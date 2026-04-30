// ─── repairOrder.routes.js ────────────────────────────────────────
const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkQuota = require("../middlewares/checkQuota");
const {
  searchCustomers,
  searchVehicleByRegNo,
  listRepairOrders,
  getRepairOrder,
  createRepairOrder,
  updateRepairOrder,
  deleteRepairOrder,
  getCancelledOrders,
  tallyExport,
  getGarageMembers,
  getCalendarOrders,
} = require("../controllers/RepairOrder.controller");

router.use(protect, checkSubscription);

// GET  /api/v1/repair-orders/search-customers?q=John
router.get("/search-customers", searchCustomers);

// GET  /api/v1/repair-orders/garage-members
router.get("/garage-members", getGarageMembers);

// GET  /api/v1/repair-orders/search-vehicle?regNo=MH12AB1234
router.get("/search-vehicle", searchVehicleByRegNo);

// GET  /api/v1/repair-orders/cancelled
router.get("/cancelled", getCancelledOrders);

// GET  /api/v1/repair-orders/tally-export
router.get("/tally-export", tallyExport);

// GET  /api/v1/repair-orders/calendar?dateFrom=&dateTo=
router.get("/calendar", getCalendarOrders);

// GET  /api/v1/repair-orders
router.get("/", listRepairOrders);

// GET  /api/v1/repair-orders/:id
router.get("/:id", getRepairOrder);

// POST /api/v1/repair-orders  (quota-gated)
router.post("/", checkQuota("repairOrders"), createRepairOrder);

// PUT  /api/v1/repair-orders/:id
router.put("/:id", updateRepairOrder);

// DELETE /api/v1/repair-orders/:id
router.delete("/:id", deleteRepairOrder);

module.exports = router;
