const mongoose = require("mongoose");

const servicePartSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      default: null,
    },

    partName: {
      type: String,
      required: true,
      trim: true,
    },

    partCode: {
      type: String,
      trim: true,
      default: null,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    taxPercent: {
      type: Number,
      default: 0,
      min: 0,
    },

    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const reminderSchema = new mongoose.Schema(
  {
    reminderType: {
      type: String,
      required: true,
      enum: ["engine_oil", "oil_filter", "general_service", "custom"],
    },

    dueDate: {
      type: Date,
      required: true,
    },

    sent: {
      type: Boolean,
      default: false,
    },

    sentAt: {
      type: Date,
      default: null,
    },

    channel: {
      type: String,
      enum: ["push", "sms", "whatsapp", "email"],
      default: "push",
    },

    message: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

const serviceSchema = new mongoose.Schema(
  {
    garageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      required: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    serviceNo: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      default: null,
    },

    odometerReading: {
      type: Number,
      default: null,
      min: 0,
    },

    serviceType: {
      type: String,
      required: true,
      trim: true,
    },

    complaint: {
      type: String,
      trim: true,
      default: null,
    },

    diagnosis: {
      type: String,
      trim: true,
      default: null,
    },

    workDone: {
      type: String,
      trim: true,
      default: null,
    },

    serviceDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expectedDeliveryDate: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    partsUsed: {
      type: [servicePartSchema],
      default: [],
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "partial", "paid", "refunded"],
      default: "pending",
      index: true,
    },

    paymentMode: {
      type: String,
      enum: ["cash", "upi", "card", "bank_transfer", "online", "other"],
      default: "cash",
    },

    serviceStatus: {
      type: String,
      enum: ["open", "in_progress", "ready", "completed", "cancelled"],
      default: "open",
      index: true,
    },

    nextServiceAt: {
      type: Date,
      default: null,
    },

    reminders: {
      type: [reminderSchema],
      default: [],
    },

    notes: {
      type: String,
      trim: true,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

serviceSchema.index({ garageId: 1, serviceDate: -1 });
serviceSchema.index({ garageId: 1, customerId: 1 });
serviceSchema.index({ garageId: 1, vehicleId: 1 });

serviceSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("Service", serviceSchema);
