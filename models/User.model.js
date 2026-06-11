const mongoose = require("mongoose");

//  User Schema
const UserSchema = new mongoose.Schema(
  {
    // ── Tenant association ────────────────────────────────────────
    // `garage` is kept for legacy callers (member/vendor/customer assignments).
    // For owners, the active tenant is `activeGarageId` — owners may operate
    // many garages, but only one is "active" per session.
    garage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      default: null,
      index: true,
    },
    activeGarageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Garage",
      default: null,
      index: true,
    },
    franchiseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Franchise",
      default: null,
      index: true,
    },

    // ── Identity ──────────────────────────────────────────────────
    fullName: {
      type: String,
      trim: true,
      default: null,
    },
    emailId: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      // No default — field must be absent (not null) for sparse index to exclude it.
    },
    phoneNo: {
      type: String,
      unique: true,
      sparse: true,
    },

    // ── Auth ──────────────────────────────────────────────────────
    // select: false — never returned in queries unless explicitly requested
    password: {
      type: String,
      select: false,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      required: true,
      enum: {
        values: [
          // SaaS roles
          "superAdmin",
          "franchiseAdmin",
          "owner",
          "manager",
          "staff",
          // Legacy / domain roles (preserved for backward compat)
          "franchiseOwner",
          "member",
          "customer",
          "vendor",
        ],
        message: "Invalid role",
      },
      default: "owner",
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Refresh Token (hashed) ────────────────────────────────────
    refreshToken: {
      token: { type: String },
      expiresAt: { type: Date },
    },

    // ── Expo Push Token ───────────────────────────────────────────
    pushToken: {
      type: String,
      default: null,
    },

    // ── Payroll (mechanics / members) ─────────────────────────────
    // Fixed monthly base salary. Mechanics who complete >= the monthly
    // service threshold earn a flat bonus on top (see config/payroll.js).
    baseSalary: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

// ── Strip sensitive fields from API responses ─────────────────────
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.pushToken;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", UserSchema);
