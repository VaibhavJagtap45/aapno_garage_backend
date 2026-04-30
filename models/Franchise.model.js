const mongoose = require("mongoose");

const sharingPolicySchema = new mongoose.Schema(
  {
    shareServices: { type: Boolean, default: true },
    allowInventoryTransfer: { type: Boolean, default: true },
    shareCustomers: { type: Boolean, default: false },
    shareMembers: { type: Boolean, default: false },
  },
  { _id: false },
);

const franchiseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    headOfficeAddress: { type: String, trim: true, default: null },
    contactNumber: { type: String, trim: true, default: null },
    gstNumber: { type: String, trim: true, uppercase: true, default: null },
    logo: { type: String, trim: true, default: null },
    franchiseOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    createdBySuperAdmin: { type: Boolean, default: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    plan: {
      type: String,
      trim: true,
      default: "basic",
      enum: ["free", "basic", "franchise", "premium", "starter", "pro"],
    },
    sharingPolicy: { type: sharingPolicySchema, default: () => ({}) },
  },
  { timestamps: true },
);

franchiseSchema.index({ name: 1 });

module.exports = mongoose.model("Franchise", franchiseSchema);
