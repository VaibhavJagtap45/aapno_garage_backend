const ServiceReminder = require("../models/ServiceReminder.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");
const {
  predictDueDate,
  sendReminder,
  loadContext,
} = require("../services/customerReminder.service");

// ─────────────────────────────────────────────────────────────────
//  GET /api/v1/service-reminders?tab=due|overdue|done&page=1&limit=50
// ─────────────────────────────────────────────────────────────────
const listServiceReminders = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const { tab = "due", page = 1, limit = 50 } = req.query;
  const now = new Date();

  const filter = { garageId, isDeleted: false };
  if (tab === "done") {
    filter.status = "done";
  } else if (tab === "overdue") {
    filter.status = "pending";
    filter.dueDate = { $lt: now };
  } else {
    // due — pending and dueDate >= today
    filter.status = "pending";
    filter.dueDate = { $gte: now };
  }

  const safePage  = Math.max(Number(page)  || 1,  1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const [reminders, total] = await Promise.all([
    ServiceReminder.find(filter)
      .populate("customerId", "fullName phoneNo emailId")
      .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
      .sort({ dueDate: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ServiceReminder.countDocuments(filter),
  ]);

  // Also fetch counts for each tab for the badge numbers
  const [dueCount, overdueCount, doneCount] = await Promise.all([
    ServiceReminder.countDocuments({ garageId, isDeleted: false, status: "pending", dueDate: { $gte: now } }),
    ServiceReminder.countDocuments({ garageId, isDeleted: false, status: "pending", dueDate: { $lt: now } }),
    ServiceReminder.countDocuments({ garageId, isDeleted: false, status: "done" }),
  ]);

  return sendSuccess(res, 200, "Service reminders fetched.", {
    reminders,
    total,
    page: safePage,
    counts: { due: dueCount, overdue: overdueCount, done: doneCount },
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/service-reminders
// ─────────────────────────────────────────────────────────────────
const createServiceReminder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const {
    customerId,
    vehicleId,
    repairOrderId,
    invoiceId,
    reminderType,
    serviceLabel,
    currentOdometer,
    nextServiceKm,
    dailyRunningKm,
    dueDate,
    channels,
    notifyDaysBefore,
    notes,
  } = req.body;
  if (!customerId) return sendError(res, 400, "customerId is required.");

  // dueDate is optional when enough km signal is present to predict it.
  const canSchedule = Boolean(dueDate) || nextServiceKm != null;
  const resolvedDue = canSchedule
    ? predictDueDate({
        currentKm: currentOdometer,
        nextServiceKm,
        dailyRunningKm,
        explicitDueDate: dueDate,
      })
    : null;
  if (!resolvedDue) {
    return sendError(res, 400, "Provide a dueDate or nextServiceKm to schedule the reminder.");
  }

  const reminder = await ServiceReminder.create({
    garageId,
    customerId,
    vehicleId:      vehicleId      || null,
    repairOrderId:  repairOrderId  || null,
    invoiceId:      invoiceId      || null,
    reminderType:   reminderType   || "service",
    serviceLabel:   serviceLabel?.trim() || "",
    currentOdometer: currentOdometer != null ? Number(currentOdometer) : null,
    nextServiceKm:   nextServiceKm   != null ? Number(nextServiceKm)   : null,
    dailyRunningKm:  dailyRunningKm  != null ? Number(dailyRunningKm)  : null,
    dueDate:        resolvedDue,
    channels:       Array.isArray(channels) && channels.length ? channels : undefined,
    notifyDaysBefore: notifyDaysBefore != null ? Number(notifyDaysBefore) : undefined,
    notes:          notes?.trim()  || "",
  });

  const populated = await ServiceReminder.findById(reminder._id)
    .populate("customerId", "fullName phoneNo emailId")
    .populate("vehicleId", "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven")
    .lean();

  return sendSuccess(res, 201, "Service reminder created.", { reminder: populated });
});

// ─────────────────────────────────────────────────────────────────
//  PUT /api/v1/service-reminders/:id/done
// ─────────────────────────────────────────────────────────────────
const markServiceReminderDone = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const reminder = await ServiceReminder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!reminder) return sendError(res, 404, "Reminder not found.");

  reminder.status = "done";
  await reminder.save();

  return sendSuccess(res, 200, "Reminder marked as done.", { reminder });
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/service-reminders/:id/send
//  Dispatch a reminder immediately on its configured channels (WhatsApp +
//  push), independent of the scheduler. Useful for a manual "Notify now".
// ─────────────────────────────────────────────────────────────────
const sendServiceReminderNow = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const reminder = await ServiceReminder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!reminder) return sendError(res, 404, "Reminder not found.");

  const ctx = await loadContext({
    garageId,
    customerId: reminder.customerId,
    vehicleId: reminder.vehicleId,
  });
  const { ok, errors } = await sendReminder(reminder, ctx);

  reminder.notifyStatus = ok ? "sent" : "failed";
  reminder.notifiedAt = ok ? new Date() : reminder.notifiedAt;
  reminder.lastError = ok ? null : errors.join("; ");
  await reminder.save();

  if (!ok) return sendError(res, 502, `Failed to send reminder: ${errors.join("; ")}`);
  return sendSuccess(res, 200, "Reminder sent.", { reminder });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /api/v1/service-reminders/:id
// ─────────────────────────────────────────────────────────────────
const deleteServiceReminder = asyncHandler(async (req, res) => {
  const garageId = await resolveGarageId(req.user);
  if (!garageId) return sendError(res, 404, "Garage not found.");

  const reminder = await ServiceReminder.findOne({
    _id: req.params.id,
    garageId,
    isDeleted: false,
  });
  if (!reminder) return sendError(res, 404, "Reminder not found.");

  reminder.isDeleted = true;
  await reminder.save();

  return sendSuccess(res, 200, "Reminder deleted.");
});

module.exports = {
  listServiceReminders,
  createServiceReminder,
  markServiceReminderDone,
  sendServiceReminderNow,
  deleteServiceReminder,
};
