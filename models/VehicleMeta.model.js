const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────
//  VehicleMeta Schema
//  Master list of vehicle brands + models, segmented by type
//  (2W / 4W) — used for frontend dropdowns.
// ─────────────────────────────────────────────────────────────────
const VEHICLE_TYPES = ["2W", "4W", "3W", "CV", "OTHER"];

const VehicleMetaSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: VEHICLE_TYPES,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    brand: {
      type: String,
      required: true,
      trim: true,
    },
    models: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true },
);

// Compound unique index — same brand can exist for different types
// (e.g. Honda 2W and Honda 4W are separate documents).
VehicleMetaSchema.index({ type: 1, brand: 1 }, { unique: true });

VehicleMetaSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("VehicleMeta", VehicleMetaSchema);
module.exports.VEHICLE_TYPES = VEHICLE_TYPES;
