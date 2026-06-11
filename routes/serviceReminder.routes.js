const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkFeature = require("../middlewares/checkFeature");
const {
  listServiceReminders,
  createServiceReminder,
  markServiceReminderDone,
  sendServiceReminderNow,
  deleteServiceReminder,
} = require("../controllers/serviceReminder.controller");

router.use(protect, checkSubscription, checkFeature("service_reminders"));

// GET  /api/v1/service-reminders?tab=due|overdue|done
router.get("/", listServiceReminders);

// POST /api/v1/service-reminders
router.post("/", createServiceReminder);

// PUT  /api/v1/service-reminders/:id/done
router.put("/:id/done", markServiceReminderDone);

// POST /api/v1/service-reminders/:id/send  — dispatch now (WhatsApp + push)
router.post("/:id/send", sendServiceReminderNow);

// DELETE /api/v1/service-reminders/:id
router.delete("/:id", deleteServiceReminder);

module.exports = router;
