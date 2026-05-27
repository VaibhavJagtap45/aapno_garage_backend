// utils/assertOwnership.js
// ─────────────────────────────────────────────────────────────────
//  Tenant-isolation guards.
//
//  Multi-tenant SaaS bugs are usually IDOR-shaped: the caller is
//  authenticated but supplies an ID that does not belong to their
//  tenant (garage). These helpers throw a 403 ApiError when the
//  referenced document is missing OR does not belong to the
//  caller's garage — the controller layer surfaces that as a plain
//  JSON error via sendError / asyncHandler.
//
//  Callers must always pass a resolved garageId (not req.user) so
//  this stays a pure check independent of session resolution.
// ─────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");
const User = require("../models/User.model");
const Vehicle = require("../models/Vehicle.model");

class OwnershipError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = "OwnershipError";
    this.status = status;
  }
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id ?? ""));
}

// ─── Customer must belong to garage ───────────────────────────────
//  A "customer" in this system is a User with role === "customer"
//  whose `garage` field references the tenant garage. Members,
//  vendors, owners can never be assigned as a repair-order customer.
async function assertCustomerBelongsToGarage(customerId, garageId) {
  if (!customerId) throw new OwnershipError("customerId is required.", 400);
  if (!isValidObjectId(customerId)) {
    throw new OwnershipError("Invalid customerId.", 400);
  }
  if (!garageId) throw new OwnershipError("Garage not resolved.", 400);

  const customer = await User.findOne({
    _id: customerId,
    role: "customer",
    garage: garageId,
  })
    .select("_id garage")
    .lean();

  if (!customer) {
    throw new OwnershipError("Customer does not belong to this garage.", 403);
  }
  return customer;
}

// ─── Vehicle must belong to the given customer ────────────────────
//  Vehicle ↔ garage is established transitively through the
//  vehicle's owning user (Vehicle.user). If a customerId is also
//  supplied we additionally check that the vehicle belongs to that
//  same customer — prevents stitching one customer's vehicle onto
//  another customer's repair order.
async function assertVehicleBelongsToCustomer(vehicleId, customerId) {
  if (!vehicleId) throw new OwnershipError("vehicleId is required.", 400);
  if (!isValidObjectId(vehicleId)) {
    throw new OwnershipError("Invalid vehicleId.", 400);
  }
  if (!customerId) {
    throw new OwnershipError("customerId is required to verify vehicle.", 400);
  }

  const vehicle = await Vehicle.findOne({
    _id: vehicleId,
    user: customerId,
  })
    .select("_id user")
    .lean();

  if (!vehicle) {
    throw new OwnershipError(
      "Vehicle does not belong to the specified customer.",
      403,
    );
  }
  return vehicle;
}

// ─── Convenience: run both checks together ────────────────────────
async function assertCustomerAndVehicle({ customerId, vehicleId, garageId }) {
  const customer = await assertCustomerBelongsToGarage(customerId, garageId);
  // vehicleId is optional on invoices — only validate when supplied
  if (vehicleId) {
    await assertVehicleBelongsToCustomer(vehicleId, customerId);
  }
  return { customer };
}

module.exports = {
  OwnershipError,
  assertCustomerBelongsToGarage,
  assertVehicleBelongsToCustomer,
  assertCustomerAndVehicle,
};
