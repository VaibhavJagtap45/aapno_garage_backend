const ServiceReminder = require("../models/ServiceReminder.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageId = require("../utils/resolveGarageId");

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

  const { customerId, vehicleId, repairOrderId, reminderType, dueDate, notes } = req.body;
  if (!customerId) return sendError(res, 400, "customerId is required.");
  if (!dueDate)    return sendError(res, 400, "dueDate is required.");

  const reminder = await ServiceReminder.create({
    garageId,
    customerId,
    vehicleId:      vehicleId      || null,
    repairOrderId:  repairOrderId  || null,
    reminderType:   reminderType   || "service",
    dueDate:        new Date(dueDate),
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
  deleteServiceReminder,
};
