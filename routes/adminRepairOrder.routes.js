const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const adminActAsGarage = require("../middlewares/adminActAsGarage");
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

router.use(adminProtect);

// Customer search is global (no garage scoping in the controller),
// so garageId is optional here.
router.get("/search-customers", adminActAsGarage({ optional: true }), searchCustomers);

router.get("/garage-members", adminActAsGarage(), getGarageMembers);
router.get("/search-vehicle", adminActAsGarage(), searchVehicleByRegNo);
router.get("/cancelled", adminActAsGarage(), getCancelledOrders);
router.get("/tally-export", adminActAsGarage(), tallyExport);
router.get("/calendar", adminActAsGarage(), getCalendarOrders);

router.get("/", adminActAsGarage(), listRepairOrders);
router.get("/:id", adminActAsGarage(), getRepairOrder);
router.post("/", adminActAsGarage(), createRepairOrder);
router.put("/:id", adminActAsGarage(), updateRepairOrder);
router.delete("/:id", adminActAsGarage(), deleteRepairOrder);

module.exports = router;
