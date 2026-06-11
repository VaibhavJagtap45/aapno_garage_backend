const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ["rent", "salary", "utilities", "repairs", "fuel", "food", "misc", "other"],
      default: "misc",
    },
    description: { type: String, trim: true, default: "" },
    amount:       { type: Number, required: true, min: 0 },
    date:         { type: Date, required: true },
    paymentMethod:{
      type: String,
      enum: ["CASH", "CARD", "UPI", "BANK", "OTHER"],
      default: "CASH",
    },
    notes:      { type: String, trim: true, default: "" },
    paidStatus: {
      type: String,
      enum: ["paid", "credit"],
      default: "paid",
    },

    // ── Salary linkage (only set on category === "salary" rows) ───
    // Lets payroll/accounting tell which mechanic was paid for which
    // month, so a month shows as "done" vs "pending" per mechanic.
    mechanicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    payrollMonth: { type: String, default: null }, // "YYYY-MM"

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Fast lookup of "was this mechanic paid for this month?"
expenseSchema.index({ garageId: 1, category: 1, payrollMonth: 1, mechanicId: 1 });

module.exports = mongoose.model("Expense", expenseSchema);
