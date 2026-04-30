const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkQuota = require("../middlewares/checkQuota");
const {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceStats,
} = require("../controllers/invoice.controller");

router.use(protect, checkSubscription);

// GET  /api/v1/invoices/stats?dateFrom=&dateTo=
router.get("/stats", getInvoiceStats);

// GET  /api/v1/invoices?status=&customerId=&page=&limit=
router.get("/", listInvoices);

// GET  /api/v1/invoices/:id
router.get("/:id", getInvoice);

// POST /api/v1/invoices  (quota-gated)
router.post("/", checkQuota("invoices"), createInvoice);

// PUT  /api/v1/invoices/:id
router.put("/:id", updateInvoice);

// DELETE /api/v1/invoices/:id
router.delete("/:id", deleteInvoice);

module.exports = router;
