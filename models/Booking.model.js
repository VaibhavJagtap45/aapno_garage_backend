const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    garage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },
    bookingNo: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    duration: {
      type: Number,
      default: 60,
      min: 15, // minutes
    },
    serviceType: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "in_progress", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    bookedBy: {
      type: String,
      enum: ["customer", "owner"],
      required: true,
    },
    repairOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RepairOrder",
      default: null,
    },
  },
  { timestamps: true },
);

bookingSchema.index({ garage: 1, scheduledAt: -1 });
bookingSchema.index({ garage: 1, status: 1 });
bookingSchema.index({ customer: 1, scheduledAt: -1 });

// Auto-generate bookingNo before first save
// Mongoose 9.x: async middleware must NOT accept or call next() — just return/throw
bookingSchema.pre("save", async function () {
  if (this.bookingNo) return;
  const count = await this.constructor.countDocuments({ garage: this.garage });
  this.bookingNo = `BK-${String(count + 1).padStart(4, "0")}`;
});

module.exports = mongoose.model("Booking", bookingSchema);
