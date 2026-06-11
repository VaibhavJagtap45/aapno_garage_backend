const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const adminActAsGarage = require("../middlewares/adminActAsGarage");
const {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  setPaymentStatus,
  deleteInvoice,
  getInvoiceStats,
  getMarginReport,
} = require("../controllers/invoice.controller");

router.use(adminProtect);

router.get("/stats", adminActAsGarage(), getInvoiceStats);
router.get("/margin-report", adminActAsGarage(), getMarginReport);
router.get("/", adminActAsGarage(), listInvoices);
router.get("/:id", adminActAsGarage(), getInvoice);
router.post("/", adminActAsGarage(), createInvoice);
router.patch("/:id/payment-status", adminActAsGarage(), setPaymentStatus);
router.put("/:id", adminActAsGarage(), updateInvoice);
router.delete("/:id", adminActAsGarage(), deleteInvoice);

module.exports = router;
