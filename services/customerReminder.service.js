// services/customerReminder.service.js
// ─────────────────────────────────────────────────────────────────
//  Customer service-reminder side-effects.
//
//   • createReminderForInvoice — called right after an invoice is saved.
//       Stamps the vehicle's km/next-service info, fires an immediate
//       "service done — next service due …" confirmation (WhatsApp + push),
//       and persists a ServiceReminder the scheduler will fire near due date.
//
//   • dispatchDueReminders — called on an interval by the scheduler. Finds
//       pending reminders whose (dueDate − notifyDaysBefore) has arrived and
//       sends them on their configured channels.
//
//  Every public function is fire-and-forget: it catches its own errors and
//  never throws, so a messaging outage can't break the invoice write or
//  crash the scheduler.
// ─────────────────────────────────────────────────────────────────

const ServiceReminder = require("../models/ServiceReminder.model");
const Vehicle = require("../models/Vehicle.model");
const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const { notifyUser, TEMPLATES } = require("./pushNotification.service");
const { sendWhatsApp } = require("../utils/whatsapp");
const { sendSms } = require("./sms.service");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_KM = Number(process.env.REMINDER_DEFAULT_DAILY_KM) || 40;
// How far ahead the scheduler looks for "coming due" reminders before
// applying each reminder's own notifyDaysBefore lead time.
const SCAN_HORIZON_DAYS = 45;

function formatDate(date) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function resolveNextServiceKm({ currentKm, nextServiceKm, serviceIntervalKm }) {
  const current = numberOrNull(currentKm);
  const target = numberOrNull(nextServiceKm);
  const interval = numberOrNull(serviceIntervalKm);

  if (interval !== null && interval > 0 && current !== null) {
    return current + interval;
  }
  return target;
}

// ── Predict the next-service due date ─────────────────────────────
//  If staff supplied an explicit dueDate, that wins. Otherwise estimate
//  from how far the customer rides per day:
//      days = (nextServiceKm − currentKm) / dailyRunningKm
//  Falls back to a default daily distance when none is known.
function predictDueDate({
  currentKm,
  nextServiceKm,
  serviceIntervalKm,
  dailyRunningKm,
  explicitDueDate,
}) {
  if (explicitDueDate) return new Date(explicitDueDate);

  const current = numberOrNull(currentKm);
  const target = resolveNextServiceKm({ currentKm, nextServiceKm, serviceIntervalKm });
  const remaining = target !== null && current !== null ? target - current : null;
  const perDay = Number(dailyRunningKm) > 0 ? Number(dailyRunningKm) : DEFAULT_DAILY_KM;

  if (remaining !== null && remaining > 0 && perDay > 0) {
    const days = Math.ceil(remaining / perDay);
    return new Date(Date.now() + days * DAY_MS);
  }
  // No usable km signal — default to 90 days out so the reminder still exists.
  return new Date(Date.now() + 90 * DAY_MS);
}

function buildServiceDoneWhatsApp({ customerName, garageName, serviceLabel, nextServiceKm, dueDateLabel }) {
  const lines = [
    `Hi ${customerName || "there"}! 👋`,
    "",
    `✅ ${serviceLabel || "Your service"} is complete at *${garageName}*.`,
  ];
  if (nextServiceKm || dueDateLabel) {
    lines.push("");
    lines.push("🔔 *Next service due:*");
    if (nextServiceKm) lines.push(`• At ${nextServiceKm} km`);
    if (dueDateLabel) lines.push(`• Around ${dueDateLabel}`);
  }
  lines.push("", "We'll remind you when it's time. Thank you! 🙏");
  return lines.join("\n");
}

function buildReminderWhatsApp({ customerName, garageName, serviceLabel, nextServiceKm, dueDateLabel, vehicleLabel }) {
  const lines = [
    `Hi ${customerName || "there"}! 🔔`,
    "",
    `This is a friendly reminder that *${serviceLabel || "your next service"}*` +
      (vehicleLabel ? ` for ${vehicleLabel}` : "") +
      ` is due${nextServiceKm ? ` around ${nextServiceKm} km` : " soon"}` +
      (dueDateLabel ? ` (${dueDateLabel})` : "") +
      ".",
    "",
    `Reply or call us to book a slot at *${garageName}*. See you soon! 🛵`,
  ];
  return lines.join("\n");
}

// ── Send a single reminder on its configured channels ─────────────
//  Returns { ok, errors } — never throws.
async function sendReminder(reminder, ctx) {
  const { customer, vehicle, garageName } = ctx;
  const errors = [];

  const dueDateLabel = formatDate(reminder.dueDate);
  const vehicleLabel = vehicle
    ? [vehicle.vehicleBrand, vehicle.vehicleModel].filter(Boolean).join(" ") ||
      vehicle.vehicleRegisterNo
    : null;

  const channels = reminder.channels?.length ? reminder.channels : ["whatsapp", "push"];

  for (const channel of channels) {
    try {
      if (channel === "push") {
        await notifyUser(
          reminder.customerId,
          TEMPLATES.SERVICE_REMINDER_DUE({
            serviceLabel: reminder.serviceLabel,
            nextServiceKm: reminder.nextServiceKm,
            garageName,
          }),
        );
      } else if (channel === "whatsapp" && customer?.phoneNo) {
        await sendWhatsApp(
          customer.phoneNo,
          buildReminderWhatsApp({
            customerName: customer.fullName,
            garageName,
            serviceLabel: reminder.serviceLabel,
            nextServiceKm: reminder.nextServiceKm,
            dueDateLabel,
            vehicleLabel,
          }),
        );
      } else if (channel === "sms" && customer?.phoneNo) {
        await sendSms(
          customer.phoneNo,
          `Reminder: ${reminder.serviceLabel || "your next service"} is due` +
            `${reminder.nextServiceKm ? ` around ${reminder.nextServiceKm} km` : " soon"}` +
            `${dueDateLabel ? ` (${dueDateLabel})` : ""}. - ${garageName}`,
        );
      }
    } catch (err) {
      errors.push(`${channel}: ${err.message}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Resolve the shared context (customer, vehicle, garage) once ───
async function loadContext({ garageId, customerId, vehicleId }) {
  const [garage, customer, vehicle] = await Promise.all([
    Garage.findById(garageId).select("garageName").lean(),
    customerId ? User.findById(customerId).select("fullName phoneNo").lean() : null,
    vehicleId
      ? Vehicle.findById(vehicleId)
          .select(
            "vehicleBrand vehicleModel vehicleRegisterNo vehicleKmDriven dailyRunningKm serviceIntervalKm nextServiceKm nextServiceDueDate",
          )
          .lean()
      : null,
  ]);
  return { garage, customer, vehicle, garageName: garage?.garageName || "your garage" };
}

// ─────────────────────────────────────────────────────────────────
//  createReminderForInvoice — fire-and-forget post-invoice hook.
//  opts: { garageId, customerId, vehicleId, invoiceId, repairOrderId,
//          serviceLabel, currentOdometer, nextServiceKm, dailyRunningKm,
//          dueDate, channels, notifyDaysBefore, notes }
//  Returns the created reminder (or null on failure / when disabled).
// ─────────────────────────────────────────────────────────────────
async function createReminderForInvoice(opts = {}) {
  try {
    const {
      garageId,
      customerId,
      vehicleId = null,
      invoiceId = null,
      repairOrderId = null,
      serviceLabel = "",
      currentOdometer = null,
      nextServiceKm = null,
      serviceIntervalKm = null,
      dailyRunningKm = null,
      dueDate = null,
      channels,
      notifyDaysBefore = 3,
      notes = "",
    } = opts;

    if (!garageId || !customerId) return null;

    const resolvedNextServiceKm = resolveNextServiceKm({
      currentKm: currentOdometer,
      nextServiceKm,
      serviceIntervalKm,
    });

    const resolvedDue = predictDueDate({
      currentKm: currentOdometer,
      nextServiceKm: resolvedNextServiceKm,
      serviceIntervalKm,
      dailyRunningKm,
      explicitDueDate: dueDate,
    });

    if (invoiceId) {
      await ServiceReminder.updateMany(
        {
          invoiceId,
          reminderType: "service",
          status: "pending",
          isDeleted: false,
        },
        {
          $set: {
            isDeleted: true,
            notifyStatus: "skipped",
            lastError: "Replaced by a newer invoice reminder.",
          },
        },
      ).catch(() => {});
    }

    // Persist the prediction + km context onto the vehicle so the next visit
    // and the reminders list can show it without recomputing.
    if (vehicleId) {
      const vehicleUpdate = { nextServiceDueDate: resolvedDue };
      if (currentOdometer != null) {
        vehicleUpdate.lastServiceKm = currentOdometer;
        vehicleUpdate.lastServiceAt = new Date();
        vehicleUpdate.vehicleKmDriven = currentOdometer;
      }
      if (resolvedNextServiceKm != null) vehicleUpdate.nextServiceKm = resolvedNextServiceKm;
      if (serviceIntervalKm != null) vehicleUpdate.serviceIntervalKm = serviceIntervalKm;
      if (dailyRunningKm != null && Number(dailyRunningKm) > 0) {
        vehicleUpdate.dailyRunningKm = dailyRunningKm;
      }
      await Vehicle.updateOne({ _id: vehicleId }, { $set: vehicleUpdate }).catch(() => {});
    }

    const reminder = await ServiceReminder.create({
      garageId,
      customerId,
      vehicleId,
      invoiceId,
      repairOrderId,
      reminderType: "service",
      serviceLabel,
      currentOdometer,
      nextServiceKm: resolvedNextServiceKm,
      serviceIntervalKm,
      dailyRunningKm,
      dueDate: resolvedDue,
      channels: channels?.length ? channels : ["whatsapp", "push"],
      notifyDaysBefore,
      notes,
    });

    // Immediate "service done — next service due …" confirmation.
    const ctx = await loadContext({ garageId, customerId, vehicleId });
    const dueDateLabel = formatDate(resolvedDue);

    await Promise.allSettled([
      notifyUser(
        customerId,
        TEMPLATES.SERVICE_DONE({
          serviceLabel,
          nextServiceKm: resolvedNextServiceKm,
          dueDateLabel,
        }),
      ),
      ctx.customer?.phoneNo
        ? sendWhatsApp(
            ctx.customer.phoneNo,
            buildServiceDoneWhatsApp({
              customerName: ctx.customer.fullName,
              garageName: ctx.garageName,
              serviceLabel,
              nextServiceKm: resolvedNextServiceKm,
              dueDateLabel,
            }),
          )
        : Promise.resolve(),
    ]);

    return reminder;
  } catch (err) {
    console.error("[Reminder] createReminderForInvoice failed:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
//  dispatchDueReminders — scheduler entrypoint.
//  Finds pending, not-yet-sent reminders whose lead time has arrived and
//  sends them. Returns a summary { scanned, sent, failed }.
// ─────────────────────────────────────────────────────────────────
async function dispatchDueReminders({ limit = 200 } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + SCAN_HORIZON_DAYS * DAY_MS);

  const candidates = await ServiceReminder.find({
    isDeleted: false,
    status: "pending",
    notifyStatus: "scheduled",
    dueDate: { $lte: horizon },
  })
    .sort({ dueDate: 1 })
    .limit(limit)
    .lean();

  // Keep only those whose (dueDate − notifyDaysBefore) has actually arrived.
  const due = candidates.filter((r) => {
    const lead = (Number(r.notifyDaysBefore) || 0) * DAY_MS;
    return new Date(r.dueDate).getTime() - lead <= now.getTime();
  });

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const ctx = await loadContext({
      garageId: reminder.garageId,
      customerId: reminder.customerId,
      vehicleId: reminder.vehicleId,
    });

    const { ok, errors } = await sendReminder(reminder, ctx);

    await ServiceReminder.updateOne(
      { _id: reminder._id },
      ok
        ? { $set: { notifyStatus: "sent", notifiedAt: new Date(), lastError: null } }
        : { $set: { notifyStatus: "failed", lastError: errors.join("; ") } },
    ).catch(() => {});

    if (ok) sent += 1;
    else failed += 1;
  }

  return { scanned: candidates.length, sent, failed };
}

module.exports = {
  createReminderForInvoice,
  dispatchDueReminders,
  sendReminder,
  predictDueDate,
  loadContext,
};
