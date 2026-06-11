const mongoose = require("mongoose");

const VehicleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      // default: null,
    },

    vehicleBrand: {
      type: String,
      trim: true,
    },

    vehicleModel: {
      type: String,
      trim: true,
    },

    vehicleRegisterNo: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    vehiclePurchaseDate: {
      type: Date,
    },

    vehicleKmDriven: {
      type: Number,
      min: [0, "Kilometers driven cannot be negative"],
      default: 0,
    },

    // ── Service-reminder tracking ─────────────────────────────────
    // Average distance the customer rides per day (manually entered by
    // staff). Used to predict the next-service due date:
    //   dueDate ≈ today + (nextServiceKm − currentKm) / dailyRunningKm
    dailyRunningKm: {
      type: Number,
      min: [0, "Daily running cannot be negative"],
      default: 0,
    },

    serviceIntervalKm: {
      type: Number,
      min: [0, "Service interval cannot be negative"],
      default: null,
    },

    // Odometer + date captured at the most recent service.
    lastServiceKm: {
      type: Number,
      min: 0,
      default: null,
    },

    lastServiceAt: {
      type: Date,
      default: null,
    },

    // Target odometer / date for the next service (set per job by staff).
    nextServiceKm: {
      type: Number,
      min: 0,
      default: null,
    },

    nextServiceDueDate: {
      type: Date,
      default: null,
    },

    vehicleEngineNo: {
      type: String,
      trim: true,
    },

    vehicleVinNo: {
      type: String,
      trim: true,
    },

    vehicleInsuranceProvider: {
      type: String,
      trim: true,
    },

    vehiclePolicyNo: {
      type: String,
      trim: true,
    },

    vehicleInsuranceExpire: {
      type: Date,
    },

    vehicleRegCertificate: {
      type: String,
    },

    vehicleInsuranceDoc: {
      type: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Vehicle", VehicleSchema);
