const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const requireRole = require("../middlewares/requireRole");
const {
  getPayroll,
  setMechanicSalary,
  paySalary,
} = require("../controllers/payroll.controller");

// Payroll is owner/manager territory only.
router.use(protect, checkSubscription, requireRole("owner", "manager"));

// GET   /api/v1/payroll?month=YYYY-MM
router.get("/", getPayroll);

// PATCH /api/v1/payroll/:mechanicId/salary
router.patch("/:mechanicId/salary", setMechanicSalary);

// POST  /api/v1/payroll/:mechanicId/pay
router.post("/:mechanicId/pay", paySalary);

module.exports = router;
