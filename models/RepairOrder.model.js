const mongoose = require("mongoose");

const repairServiceLineSchema = new mongoose.Schema(
  {
    catalogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GarageServiceCatalog",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const repairPartLineSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      default: null,
    },
    partCode: { type: String, trim: true, default: null },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const repairOrderSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    orderNo: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    odometerReading: {
      type: Number,
      default: null,
    },
    vehicleVariant: {
      type: String,
      trim: true,
      default: null,
    },
    // Services performed
    services: {
      type: [repairServiceLineSchema],
      default: [],
    },
    applyDiscountToAllServices: {
      type: Boolean,
      default: false,
    },
    // Parts used
    parts: {
      type: [repairPartLineSchema],
      default: [],
    },
    applyDiscountToAllParts: {
      type: Boolean,
      default: false,
    },
    // Images (URLs)
    images: {
      type: [String],
      default: [],
    },
    // Financials
    servicesTotal: { type: Number, default: 0 },
    partsTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ["rupees", "percentage"],
      default: "rupees",
    },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    // Tags (string array)
    tags: { type: [String], default: [] },
    // Customer remarks
    customerRemarks: { type: [String], default: [] },
    // Delivery
    estimatedDeliveryAt: { type: Date, default: null },
    notifyCustomer: { type: Boolean, default: false },
    // Status
    status: {
      type: String,
      enum: [
        "created",
        "in_progress",
        "vehicle_ready",
        "completed",
        "cancelled",
      ],
      default: "created",
      index: true,
    },
    // Member assignment
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    assignedAt: { type: Date, default: null },
    // Customer's preferred service date/time (set when customer submits request; defaults to submission time)
    scheduledAt: { type: Date, default: null, index: true },
    // Customer's initial complaint / note (set when customer creates request)
    customerNote: { type: String, trim: true, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

repairOrderSchema.index({ garageId: 1, status: 1 });
repairOrderSchema.index({ garageId: 1, customerId: 1 });
repairOrderSchema.index({ garageId: 1, createdAt: -1 });

repairOrderSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("RepairOrder", repairOrderSchema);
