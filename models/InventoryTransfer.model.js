const mongoose = require("mongoose");

const transferItemSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
    },
    partName: { type: String, required: true, trim: true },
    partCode: { type: String, trim: true, default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const inventoryTransferSchema = new mongoose.Schema(
  {
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
      index: true,
    },
    fromGarageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    toGarageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestType: {
      type: String,
      enum: ["send", "receive"],
      required: true,
    },
    counterpartyApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    items: {
      type: [transferItemSchema],
      validate: [(arr) => Array.isArray(arr) && arr.length > 0, "At least one item is required"],
    },
    status: {
      type: String,
      enum: ["pending_approval", "approved", "in_transit", "received", "rejected", "cancelled"],
      default: "pending_approval",
      index: true,
    },
    approvedAt: { type: Date, default: null },
    inTransitAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

inventoryTransferSchema.index({ franchiseId: 1, createdAt: -1 });
inventoryTransferSchema.index({ fromGarageId: 1, toGarageId: 1, status: 1 });

module.exports = mongoose.model("InventoryTransfer", inventoryTransferSchema);
