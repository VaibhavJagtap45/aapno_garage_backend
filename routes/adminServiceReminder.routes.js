// routes/adminServiceReminder.routes.js
// ─────────────────────────────────────────────────────────────────
//  Admin-console access to the per-garage service reminders.
//  Reuses the same controller as the garage-app routes, but swaps the
//  garage-user auth stack for the admin stack: adminProtect verifies the
//  admin token, adminActAsGarage() synthesizes req.user from ?garageId so
//  resolveGarageId(req.user) resolves to the selected garage.
//
//  Mounted at /api/v1/admin/service-reminders (before the generic
//  AdminRoutes catch-all).
// ─────────────────────────────────────────────────────────────────
const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const adminActAsGarage = require("../middlewares/adminActAsGarage");
const {
  listServiceReminders,
  createServiceReminder,
  markServiceReminderDone,
  sendServiceReminderNow,
  deleteServiceReminder,
} = require("../controllers/serviceReminder.controller");

router.use(adminProtect, adminActAsGarage());

// GET    /api/v1/admin/service-reminders?garageId=&tab=due|overdue|done
router.get("/", listServiceReminders);

// POST   /api/v1/admin/service-reminders?garageId=
router.post("/", createServiceReminder);

// PUT    /api/v1/admin/service-reminders/:id/done?garageId=
router.put("/:id/done", markServiceReminderDone);

// POST   /api/v1/admin/service-reminders/:id/send?garageId=  — dispatch now
router.post("/:id/send", sendServiceReminderNow);

// DELETE /api/v1/admin/service-reminders/:id?garageId=
router.delete("/:id", deleteServiceReminder);

module.exports = router;
