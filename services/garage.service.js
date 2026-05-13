// services/garage.service.js
// All garage business logic for the admin flow lives here.
// Controllers should only validate, call these, and shape the response.

const mongoose = require("mongoose");
const Garage = require("../models/Garage.model");
const User = require("../models/User.model");
const Inventory = require("../models/Inventry.model");
const Service = require("../models/Service.model");
const RepairOrder = require("../models/RepairOrder.model");
const Booking = require("../models/Booking.model");
const Vehicle = require("../models/Vehicle.model");
const { findOrCreateOwner } = require("./owner.service");
const { ensureFranchiseCapacity } = require("./franchiseCapacity.service");
const {
  BadRequestError,
  NotFoundError,
} = require("../core/errors");

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["pending", "approved", "rejected"];

function buildStatusFilter(status) {
  if (!status || !VALID_STATUSES.includes(status)) return {};
  if (status === "pending") {
    return {
      $or: [
        { approvalStatus: "pending" },
        { approvalStatus: { $exists: false } },
        { approvalStatus: null },
      ],
    };
  }
  return { approvalStatus: status };
}

// ─────────────────────────────────────────────────────────────────
// List + stats
// ─────────────────────────────────────────────────────────────────

async function listGarages({ status, ownerId, franchiseId } = {}) {
  const filter = { ...buildStatusFilter(status) };
  if (ownerId) filter.owner = ownerId;
  if (franchiseId) filter.franchiseId = franchiseId;

  const garages = await Garage.find(filter)
    .populate("owner", "fullName phoneNo emailId isVerified createdAt")
    .populate("manager", "fullName phoneNo emailId role")
    .populate("franchiseId", "name code approvalStatus")
    .sort({ createdAt: -1 })
    .lean();

  return garages.map((g) => ({
    ...g,
    approvalStatus: g.approvalStatus || "pending",
  }));
}

async function getGarageStats() {
  const pendingFilter = buildStatusFilter("pending");
  const [total, pending, approved, rejected] = await Promise.all([
    Garage.countDocuments(),
    Garage.countDocuments(pendingFilter),
    Garage.countDocuments({ approvalStatus: "approved" }),
    Garage.countDocuments({ approvalStatus: "rejected" }),
  ]);
  return { total, pending, approved, rejected };
}

async function getGarageDetail(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BadRequestError("Invalid garage id.");
  }

  const garage = await Garage.findById(id)
    .populate("owner", "fullName phoneNo emailId isVerified role state createdAt")
    .populate("manager", "fullName phoneNo emailId role")
    .populate("franchiseId", "name code approvalStatus plan sharingPolicy")
    .lean();

  if (!garage) throw new NotFoundError("Garage not found.");

  const [inventory, services, repairOrders, bookings] = await Promise.all([
    Inventory.find({ garageId: id }).sort({ updatedAt: -1 }).lean(),
    Service.find({ garageId: id, isDeleted: { $ne: true } })
      .sort({ serviceDate: -1, createdAt: -1 })
      .lean(),
    RepairOrder.find({ garageId: id, isDeleted: { $ne: true } })
      .populate("customerId", "fullName phoneNo emailId")
      .populate("assignedTo", "fullName phoneNo role")
      .sort({ createdAt: -1 })
      .lean(),
    Booking.find({ garage: id })
      .populate("customer", "fullName phoneNo emailId")
      .sort({ scheduledAt: -1, createdAt: -1 })
      .lean(),
  ]);

  const vehicleIds = [
    ...services.map((s) => s.vehicleId),
    ...repairOrders.map((r) => r.vehicleId),
    ...bookings.map((b) => b.vehicle),
  ]
    .filter(Boolean)
    .map(String);
  const uniqueVehicleIds = [...new Set(vehicleIds)];
  const vehicles = uniqueVehicleIds.length
    ? await Vehicle.find({ _id: { $in: uniqueVehicleIds } })
        .populate("user", "fullName phoneNo emailId")
        .sort({ updatedAt: -1 })
        .lean()
    : [];

  const totals = {
    inventoryItems: inventory.length,
    lowStockItems: inventory.filter(
      (item) =>
        item.manageInventory !== false &&
        Number(item.quantityInHand || 0) <= Number(item.minimumStockLevel || 0),
    ).length,
    services: services.length,
    repairOrders: repairOrders.length,
    bookings: bookings.length,
    vehicles: vehicles.length,
    revenue:
      services.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0) +
      repairOrders.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0),
  };

  return {
    garage: { ...garage, approvalStatus: garage.approvalStatus || "pending" },
    totals,
    inventory,
    services,
    repairOrders,
    bookings,
    vehicles,
  };
}

// ─────────────────────────────────────────────────────────────────
// Create — supports new OR existing owner, multi-branch, setAsDefault
// ─────────────────────────────────────────────────────────────────

async function createGarage(input) {
  const {
    // Owner identity (one-of: ownerId | phoneNo)
    ownerId,
    phoneNo,
    fullName,
    emailId,

    // Garage fields
    garageName,
    garageOwnerName,
    garageAddress,
    garageContactNumber,
    garageType,
    garageLogo,
    state,
    isGstApplicable,
    gstNumber,
    approvalStatus = "approved",
    franchiseId,
    manager,
    setAsDefault = false,
  } = input || {};

  if (!garageName || !garageAddress || !garageContactNumber || !garageType) {
    throw new BadRequestError(
      "garageName, garageAddress, garageContactNumber, garageType are required.",
    );
  }

  if (franchiseId) {
    await ensureFranchiseCapacity(franchiseId, 1);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { user: owner, created: ownerWasCreated } = await findOrCreateOwner(
      { ownerId, phoneNo, fullName, emailId, state },
      session,
    );

    // First branch automatically becomes primary unless caller opts out.
    const existingCount = await Garage.countDocuments({ owner: owner._id }).session(
      session,
    );

    if (!franchiseId && existingCount > 0) {
      throw new BadRequestError(
        "This owner already has a garage. Add extra garages from a franchise only.",
      );
    }

    const shouldBePrimary =
      setAsDefault === true || (existingCount === 0 && setAsDefault !== false);

    if (shouldBePrimary) {
      // Demote any other primary branch for this owner
      await Garage.updateMany(
        { owner: owner._id, isPrimaryBranch: true },
        { $set: { isPrimaryBranch: false } },
        { session },
      );
    }

    const [garage] = await Garage.create(
      [
        {
          owner: owner._id,
          garageName,
          garageOwnerName: garageOwnerName || owner.fullName || null,
          garageAddress,
          garageContactNumber,
          garageType,
          garageLogo: garageLogo || null,
          state: state || owner.state || null,
          isGstApplicable: !!isGstApplicable,
          gstNumber: isGstApplicable ? gstNumber || null : null,
          isProfileComplete: true,
          approvalStatus,
          franchiseId: franchiseId || null,
          manager: manager || null,
          isPrimaryBranch: shouldBePrimary,
        },
      ],
      { session },
    );

    // Update owner pointers:
    //   - legacy `garage` field is set when missing (so old code still works)
    //   - `activeGarageId` is set if this is the primary branch or if owner has none
    const ownerUpdate = {};
    if (!owner.garage) ownerUpdate.garage = garage._id;
    if (shouldBePrimary || !owner.activeGarageId) {
      ownerUpdate.activeGarageId = garage._id;
    }
    if (franchiseId && !owner.franchiseId) {
      ownerUpdate.franchiseId = franchiseId;
    }
    if (Object.keys(ownerUpdate).length) {
      await User.findByIdAndUpdate(owner._id, ownerUpdate, { session });
    }

    await session.commitTransaction();

    const populated = await Garage.findById(garage._id)
      .populate("owner", "fullName phoneNo emailId isVerified")
      .populate("manager", "fullName phoneNo emailId role")
      .populate("franchiseId", "name code approvalStatus")
      .lean();

    return { garage: populated, ownerWasCreated };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────

async function updateGarage(id, input) {
  const garage = await Garage.findById(id);
  if (!garage) throw new NotFoundError("Garage not found.");

  const {
    fullName,
    emailId,
    garageName,
    garageOwnerName,
    garageAddress,
    garageContactNumber,
    garageType,
    garageLogo,
    state,
    isGstApplicable,
    gstNumber,
    approvalStatus,
    franchiseId,
    manager,
    setAsDefault,
  } = input || {};

  if (
    franchiseId !== undefined &&
    franchiseId &&
    String(franchiseId) !== String(garage.franchiseId || "")
  ) {
    await ensureFranchiseCapacity(franchiseId, 1);
  }

  // Owner-level updates (safe fields only)
  const userUpdate = {};
  if (fullName !== undefined) userUpdate.fullName = fullName;
  if (emailId !== undefined) userUpdate.emailId = emailId || undefined;
  if (state !== undefined) userUpdate.state = state;
  if (Object.keys(userUpdate).length > 0) {
    await User.findByIdAndUpdate(garage.owner, userUpdate, {
      runValidators: true,
    });
  }

  // setAsDefault — flip primary flag and update owner.activeGarageId
  if (setAsDefault === true) {
    await Garage.updateMany(
      { owner: garage.owner, _id: { $ne: garage._id }, isPrimaryBranch: true },
      { $set: { isPrimaryBranch: false } },
    );
    await User.findByIdAndUpdate(garage.owner, {
      activeGarageId: garage._id,
    });
    garage.isPrimaryBranch = true;
  }

  if (garageName !== undefined) garage.garageName = garageName;
  if (garageOwnerName !== undefined) garage.garageOwnerName = garageOwnerName;
  if (garageAddress !== undefined) garage.garageAddress = garageAddress;
  if (garageContactNumber !== undefined)
    garage.garageContactNumber = garageContactNumber;
  if (garageType !== undefined) garage.garageType = garageType;
  if (garageLogo !== undefined) garage.garageLogo = garageLogo;
  if (state !== undefined) garage.state = state;
  if (approvalStatus !== undefined) garage.approvalStatus = approvalStatus;
  if (franchiseId !== undefined) garage.franchiseId = franchiseId || null;
  if (manager !== undefined) garage.manager = manager || null;
  if (isGstApplicable !== undefined) {
    garage.isGstApplicable = !!isGstApplicable;
    garage.gstNumber = isGstApplicable ? gstNumber || null : null;
  }

  await garage.save();

  return Garage.findById(garage._id)
    .populate("owner", "fullName phoneNo emailId isVerified")
    .populate("manager", "fullName phoneNo emailId role")
    .populate("franchiseId", "name code approvalStatus")
    .lean();
}

// ─────────────────────────────────────────────────────────────────
// Safe delete — never kills the owner if other branches remain
// ─────────────────────────────────────────────────────────────────

async function deleteGarage(id) {
  const garage = await Garage.findById(id);
  if (!garage) throw new NotFoundError("Garage not found.");

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await Garage.findByIdAndDelete(id, { session });

    // Count remaining garages for this owner
    const remaining = await Garage.find({ owner: garage.owner })
      .sort({ isPrimaryBranch: -1, createdAt: 1 })
      .session(session);

    if (remaining.length === 0) {
      // Owner has no garages left — clear pointers but DO NOT delete the user.
      // (The user might still log in, see an empty state, and create a new garage.)
      await User.findByIdAndUpdate(
        garage.owner,
        { $set: { garage: null, activeGarageId: null } },
        { session },
      );
    } else {
      // Re-elect a primary if the deleted garage was primary or the active one
      const wasPrimary = garage.isPrimaryBranch;
      const owner = await User.findById(garage.owner).session(session);
      const wasActive =
        owner?.activeGarageId &&
        String(owner.activeGarageId) === String(garage._id);

      if (wasPrimary || wasActive) {
        const next = remaining[0];
        if (wasPrimary && !next.isPrimaryBranch) {
          next.isPrimaryBranch = true;
          await next.save({ session });
        }
        await User.findByIdAndUpdate(
          garage.owner,
          { $set: { activeGarageId: next._id, garage: next._id } },
          { session },
        );
      }
    }

    await session.commitTransaction();
    return { ok: true, remainingGarages: remaining.length };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────
// Approval helpers
// ─────────────────────────────────────────────────────────────────

async function setApprovalStatus(id, approvalStatus) {
  if (!VALID_STATUSES.includes(approvalStatus)) {
    throw new BadRequestError(`Invalid approvalStatus '${approvalStatus}'.`);
  }
  const garage = await Garage.findByIdAndUpdate(
    id,
    { approvalStatus },
    { returnDocument: "after" },
  ).populate("owner", "fullName phoneNo emailId");
  if (!garage) throw new NotFoundError("Garage not found.");
  return garage;
}

module.exports = {
  listGarages,
  getGarageDetail,
  getGarageStats,
  createGarage,
  updateGarage,
  deleteGarage,
  setApprovalStatus,
};
