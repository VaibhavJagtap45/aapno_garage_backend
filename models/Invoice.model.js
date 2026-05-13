const mongoose = require("mongoose");

const invoiceServiceLineSchema = new mongoose.Schema(
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

const invoicePartLineSchema = new mongoose.Schema(
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

const invoiceSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },
    invoiceNo: { type: String, trim: true, unique: true, sparse: true },
    repairOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RepairOrder",
      default: null,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      default: null,
    },

    services: { type: [invoiceServiceLineSchema], default: [] },
    parts: { type: [invoicePartLineSchema], default: [] },
    tags: { type: [String], default: [] },

    servicesSubTotal: { type: Number, default: 0 },
    partsSubTotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },

    notifyCustomer: { type: Boolean, default: false },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
      index: true,
    },
    paymentMode: {
      type: String,
      enum: ["cash", "upi", "card", "bank_transfer", "other"],
      default: "cash",
    },
    status: {
      type: String,
      enum: ["draft", "sent", "paid", "cancelled"],
      default: "draft",
      index: true,
    },

    notes: { type: String, trim: true, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

invoiceSchema.index({ garageId: 1, status: 1 });
invoiceSchema.index({ garageId: 1, customerId: 1 });
invoiceSchema.index({ garageId: 1, createdAt: -1 });

invoiceSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("Invoice", invoiceSchema);
