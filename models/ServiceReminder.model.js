const mongoose = require("mongoose");

const serviceReminderSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    repairOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RepairOrder",
      default: null,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    reminderType: {
      type: String,
      enum: ["service", "insurance", "puc", "general"],
      default: "service",
    },
    // Human-readable label, e.g. "Engine Oil Change" — used in the message.
    serviceLabel: { type: String, trim: true, default: "" },

    // ── km context (drives the reminder + message body) ───────────
    currentOdometer: { type: Number, min: 0, default: null },
    nextServiceKm: { type: Number, min: 0, default: null },
    serviceIntervalKm: { type: Number, min: 0, default: null },
    dailyRunningKm: { type: Number, min: 0, default: null },

    dueDate: { type: Date, required: true },
    notes: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "done"],
      default: "pending",
    },

    // ── Auto-dispatch (WhatsApp + push) ───────────────────────────
    // Which channels the scheduler should use when this reminder is due.
    channels: {
      type: [String],
      enum: ["push", "whatsapp", "sms"],
      default: ["whatsapp", "push"],
    },
    // Fire the reminder this many days before dueDate.
    notifyDaysBefore: { type: Number, min: 0, default: 3 },
    notifyStatus: {
      type: String,
      enum: ["scheduled", "sent", "failed", "skipped"],
      default: "scheduled",
    },
    notifiedAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Scheduler hot-path: find pending, not-yet-sent reminders coming due.
serviceReminderSchema.index({ status: 1, notifyStatus: 1, dueDate: 1 });

module.exports = mongoose.model("ServiceReminder", serviceReminderSchema);
