const mongoose = require("mongoose");
const Garage = require("../models/Garage.model");
const resolveGarageId = require("./resolveGarageId");

/**
 * Resolves the accounting scope for franchise-aware queries.
 *
 * If the user's garage is a primary branch in a franchise and
 * `branch` query param is "all", returns all garageIds in the franchise.
 * If `branch` is a specific garageId within the same franchise, returns that one.
 * Otherwise returns just the user's own garageId.
 *
 * @param {Object} user   - req.user from auth middleware
 * @param {string} branch - req.query.branch ("all", a garageId, or undefined)
 * @returns {Promise<{garageId: ObjectId, garageIds: ObjectId[], isFranchiseView: boolean, branches: Array}>}
 */
async function resolveFranchiseAccountsScope(user, branch) {
  const garageId = await resolveGarageId(user);
  if (!garageId) return null;

  const garage = await Garage.findById(garageId)
    .select("franchiseId isPrimaryBranch")
    .lean();
  if (!garage) return null;

  if (!garage.franchiseId || !garage.isPrimaryBranch) {
    return {
      garageId,
      garageIds: [garageId],
      isFranchiseView: false,
      isPrimaryBranch: false,
      branches: [],
    };
  }

  const allBranches = await Garage.find({ franchiseId: garage.franchiseId })
    .select("_id garageName garageAddress isPrimaryBranch")
    .sort({ isPrimaryBranch: -1, garageName: 1 })
    .lean();

  if (!branch) {
    return {
      garageId,
      garageIds: [garageId],
      isFranchiseView: false,
      isPrimaryBranch: true,
      branches: allBranches,
    };
  }

  if (branch === "all") {
    return {
      garageId,
      garageIds: allBranches.map((b) => b._id),
      isFranchiseView: true,
      isPrimaryBranch: true,
      branches: allBranches,
    };
  }

  if (mongoose.Types.ObjectId.isValid(branch)) {
    const target = allBranches.find((b) => String(b._id) === branch);
    if (target) {
      return {
        garageId,
        garageIds: [target._id],
        isFranchiseView: true,
        isPrimaryBranch: true,
        branches: allBranches,
      };
    }
  }

  return {
    garageId,
    garageIds: [garageId],
    isFranchiseView: false,
    isPrimaryBranch: true,
    branches: allBranches,
  };
}

/**
 * Builds the garageId portion of a Mongoose filter.
 * Uses $in when multiple garageIds, plain equality otherwise.
 */
function garageFilter(scope) {
  if (scope.garageIds.length === 1) return scope.garageIds[0];
  return { $in: scope.garageIds };
}

module.exports = { resolveFranchiseAccountsScope, garageFilter };
