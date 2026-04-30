const express = require("express");
const router  = express.Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkFeature = require("../middlewares/checkFeature");
const {
  accountsPayable,
  stockInReport,
  stockOutReport,
  partsSalesReport,
  inventoryAgeing,
  gstReport,
} = require("../controllers/Reports.controller");

router.use(protect, checkSubscription, checkFeature("all_reports"));

router.get("/accounts-payable", accountsPayable);
router.get("/stock-in",         stockInReport);
router.get("/stock-out",        stockOutReport);
router.get("/parts-sales",      partsSalesReport);
router.get("/inventory-ageing", inventoryAgeing);
router.get("/gst",              gstReport);

module.exports = router;
