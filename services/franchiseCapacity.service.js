const Garage = require("../models/Garage.model");
const Franchise = require("../models/Franchise.model");
const { getPlan, normalizePlanSlug } = require("../config/plans");

const DEFAULT_FRANCHISE_PLAN = "basic";
const MAX_FRANCHISE_GARAGES = 3;

const getFranchisePlanDetails = (planSlug) => {
  const normalized = normalizePlanSlug(planSlug) || DEFAULT_FRANCHISE_PLAN;
  return getPlan(normalized) || getPlan(DEFAULT_FRANCHISE_PLAN);
};

const getFranchiseGarageCapacity = async (franchiseId) => {
  const franchise = await Franchise.findById(franchiseId)
    .select("name code plan approvalStatus")
    .lean();

  if (!franchise) {
    return null;
  }

  const plan = getFranchisePlanDetails(franchise.plan);
  const garageCount = await Garage.countDocuments({ franchiseId });
  const configuredLimit = plan?.garageLimit ?? 1;
  const garageLimit =
    configuredLimit === -1
      ? MAX_FRANCHISE_GARAGES
      : Math.min(configuredLimit, MAX_FRANCHISE_GARAGES);
  const remaining =
    garageLimit === -1 ? -1 : Math.max(garageLimit - garageCount, 0);

  return {
    franchise,
    plan,
    garageCount,
    garageLimit,
    remaining,
    isOverLimit: garageLimit !== -1 && garageCount > garageLimit,
  };
};

const ensureFranchiseCapacity = async (franchiseId, additionalGarages = 1) => {
  const capacity = await getFranchiseGarageCapacity(franchiseId);

  if (!capacity) {
    const error = new Error("Franchise not found.");
    error.status = 404;
    throw error;
  }

  if (
    capacity.garageLimit !== -1 &&
    capacity.garageCount + additionalGarages > capacity.garageLimit
  ) {
    const error = new Error(
      `This franchise is limited to ${capacity.garageLimit} garages on the ${capacity.plan?.name || "selected"} plan.`,
    );
    error.status = 403;
    error.code = "FRANCHISE_LIMIT_REACHED";
    error.meta = capacity;
    throw error;
  }

  return capacity;
};

module.exports = {
  DEFAULT_FRANCHISE_PLAN,
  getFranchisePlanDetails,
  getFranchiseGarageCapacity,
  ensureFranchiseCapacity,
};
