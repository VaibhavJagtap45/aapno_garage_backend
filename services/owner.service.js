// services/owner.service.js
// Owner-related business operations.
// Used by the admin garage flow (create-with-existing-or-new-owner).

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User.model");
const {
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require("../core/errors");

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "Aapnogarage123";

/**
 * Find an owner by id or by phoneNo. If neither exists, create a new
 * verified owner with a default password. Idempotent on phoneNo.
 *
 * @returns {Promise<{ user: object, created: boolean }>}
 */
async function findOrCreateOwner(input, session = null) {
  const { ownerId, phoneNo, fullName, emailId, state } = input || {};

  // 1. Explicit existing owner by id
  if (ownerId) {
    if (!mongoose.isValidObjectId(ownerId)) {
      throw new BadRequestError("Invalid ownerId.");
    }
    const existing = await User.findById(ownerId).session(session);
    if (!existing) throw new NotFoundError("Owner not found.");
    if (existing.role !== "owner") {
      throw new BadRequestError(
        `User ${existing._id} is role '${existing.role}', not 'owner'.`,
      );
    }
    return { user: existing, created: false };
  }

  // 2. By phone — re-use if it exists, create otherwise
  if (!phoneNo) {
    throw new BadRequestError("Owner phoneNo is required.");
  }

  const byPhone = await User.findOne({ phoneNo }).session(session);
  if (byPhone) {
    if (byPhone.role !== "owner") {
      throw new ConflictError(
        `Phone ${phoneNo} is registered as '${byPhone.role}', cannot be used as garage owner.`,
      );
    }
    return { user: byPhone, created: false };
  }

  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  const [created] = await User.create(
    [
      {
        fullName: fullName || null,
        phoneNo,
        emailId: emailId || undefined,
        isVerified: true,
        role: "owner",
        state: state || null,
        password: hashedPassword,
      },
    ],
    session ? { session } : undefined,
  );
  return { user: created, created: true };
}

module.exports = {
  findOrCreateOwner,
  DEFAULT_PASSWORD,
};
