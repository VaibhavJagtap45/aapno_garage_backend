const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const adminActAsGarage = require("../middlewares/adminActAsGarage");
const {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceStats,
} = require("../controllers/invoice.controller");

router.use(adminProtect);

router.get("/stats", adminActAsGarage(), getInvoiceStats);
router.get("/", adminActAsGarage(), listInvoices);
router.get("/:id", adminActAsGarage(), getInvoice);
router.post("/", adminActAsGarage(), createInvoice);
router.put("/:id", adminActAsGarage(), updateInvoice);
router.delete("/:id", adminActAsGarage(), deleteInvoice);

module.exports = router;
