// core/middleware/tenantContext.js
//
// Resolves and attaches the active tenant for the authenticated user.
// Run AFTER `protect`. Sets:
//   req.garageId    — ObjectId of the active garage
//   req.garage      — lean Garage document
//   req.franchiseId — ObjectId|null
//
// Resolution order:
//   1. Explicit override header `x-garage-id` (must belong to req.user)
//   2. user.activeGarageId
//   3. First Garage where Garage.owner === user._id   (owners only)
//   4. user.garage  (legacy: members/staff/vendors stamped at signup)
//
// On miss: 403 NO_GARAGE_CONTEXT.
//
// superAdmin / franchiseAdmin are NOT tenant-scoped — they may pass
// without a garage context. Routes that *require* a tenant should still
// call enforceTenantContext().

const mongoose = require("mongoose");
const Garage = require("../../models/Garage.model");
const { ForbiddenError, NotFoundError } = require("../errors");

const PLATFORM_ROLES = new Set(["superAdmin", "franchiseAdmin"]);

async function attachTenantContext(req, _res, next) {
  try {
    if (!req.user) return next();
    if (PLATFORM_ROLES.has(req.user.role)) return next();

    const headerOverride = req.headers["x-garage-id"];
    let garageId = null;

    if (headerOverride && mongoose.isValidObjectId(headerOverride)) {
      // Verify the override actually belongs to this user
      const candidate = await Garage.findById(headerOverride).lean();
      if (!candidate) throw new NotFoundError("Garage not found.");
      const isOwner = String(candidate.owner) === String(req.user._id);
      const isManager =
        candidate.manager && String(candidate.manager) === String(req.user._id);
      const isMember =
        req.user.garage && String(req.user.garage) === String(candidate._id);
      if (!isOwner && !isManager && !isMember) {
        throw new ForbiddenError("You do not have access to that garage.");
      }
      garageId = candidate._id;
      req.garage = candidate;
    } else if (req.user.activeGarageId) {
      garageId = req.user.activeGarageId;
    } else if (req.user.role === "owner") {
      const first = await Garage.findOne({ owner: req.user._id })
        .sort({ isPrimaryBranch: -1, createdAt: 1 })
        .lean();
      if (first) garageId = first._id;
      if (first) req.garage = first;
    } else if (req.user.garage) {
      garageId = req.user.garage;
    }

    if (garageId && !req.garage) {
      req.garage = await Garage.findById(garageId).lean();
      if (!req.garage) throw new NotFoundError("Active garage not found.");
    }

    req.garageId = garageId;
    req.franchiseId = req.garage?.franchiseId || null;
    next();
  } catch (err) {
    next(err);
  }
}

// Use on routes that absolutely require a garage context.
function enforceTenantContext(req, _res, next) {
  if (PLATFORM_ROLES.has(req.user?.role)) {
    return next(
      new ForbiddenError(
        "This action requires a garage context. Switch to a garage first.",
      ),
    );
  }
  if (!req.garageId) {
    const err = new ForbiddenError(
      "No garage associated with your account.",
    );
    err.code = "NO_GARAGE_CONTEXT";
    return next(err);
  }
  next();
}

module.exports = { attachTenantContext, enforceTenantContext };
