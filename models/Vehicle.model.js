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
