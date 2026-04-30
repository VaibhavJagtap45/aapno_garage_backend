const router = require("express").Router();
const protect = require("../middlewares/auth");
const requireRole = require("../middlewares/requireRole");
const checkSubscription = require("../middlewares/checkSubscription");
const {
  listBookings,
  createBooking,
  getBookingDetail,
  updateBookingStatus,
  convertToRepairOrder,
  linkRepairOrder,
} = require("../controllers/booking.controller");

router.use(protect, requireRole("owner"), checkSubscription);

router.get("/", listBookings);
router.post("/", createBooking);
router.get("/:id", getBookingDetail);
router.patch("/:id/status", updateBookingStatus);
router.post("/:id/convert", convertToRepairOrder);
router.patch("/:id/link-ro", linkRepairOrder);

module.exports = router;
