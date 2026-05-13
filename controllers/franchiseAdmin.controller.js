const Franchise = require("../models/Franchise.model");
const Garage = require("../models/Garage.model");
const User = require("../models/User.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendError, sendSuccess } = require("../utils/response.utils");
const {
  getPlan,
  normalizePlanSlug,
} = require("../config/plans");
const {
  ensureFranchiseCapacity,
  getFranchiseGarageCapacity,
} = require("../services/franchiseCapacity.service");

const MAX_FRANCHISE_GARAGES = 3;

const normalizeFranchiseCode = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : value;

const isDuplicateFranchiseCodeError = (err) =>
  err?.code === 11000 && (err?.keyPattern?.code || err?.keyValue?.code);

const getDuplicateFranchiseCodeMessage = (code) =>
  `A franchise with code '${code || "this code"}' already exists.`;

const normalizeAllowedPlan = (plan) => {
  const slug = normalizePlanSlug(plan) || "basic";
  return slug === "premium" ? "franchise" : slug;
};

const buildGarageCountMap = async (franchiseIds = []) => {
  if (!franchiseIds.length) return new Map();

  const counts = await Garage.aggregate([
    {
      $match: {
        franchiseId: {
          $in: franchiseIds,
        },
      },
    },
    {
      $group: {
        _id: "$franchiseId",
        count: { $sum: 1 },
      },
    },
  ]);

  return new Map(counts.map((row) => [String(row._id), row.count]));
};

const enrichFranchise = (franchise, garageCount = 0) => {
  const planSlug = normalizeAllowedPlan(franchise.plan);
  const planDetails = getPlan(planSlug) || getPlan("basic");
  const configuredLimit = planDetails?.garageLimit ?? 1;
  const garageLimit =
    configuredLimit === -1
      ? MAX_FRANCHISE_GARAGES
      : Math.min(configuredLimit, MAX_FRANCHISE_GARAGES);

  return {
    ...franchise,
    plan: planSlug,
    planDetails: planDetails
      ? {
          slug: planDetails.slug,
          name: planDetails.name,
          price: planDetails.price,
          garageLimit,
          limits: planDetails.limits,
          features: planDetails.features,
          badge: planDetails.badge,
          accent: planDetails.accent,
          recommended: planDetails.recommended,
        }
      : null,
    garageCount,
    garageLimit,
    garageRemaining: garageLimit === -1 ? -1 : Math.max(garageLimit - garageCount, 0),
    garageCapacityLabel:
      garageLimit === -1 ? `${garageCount} / unlimited` : `${garageCount} / ${garageLimit}`,
    isOverGarageLimit: garageLimit !== -1 && garageCount > garageLimit,
  };
};

const listFranchises = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (["pending", "approved", "rejected"].includes(status)) {
    filter.approvalStatus = status;
  }

  const rawFranchises = await Franchise.find(filter)
    .populate("franchiseOwner", "fullName phoneNo emailId role")
    .sort({ createdAt: -1 })
    .lean();

  const countMap = await buildGarageCountMap(
    rawFranchises.map((franchise) => franchise._id),
  );

  const franchises = rawFranchises.map((franchise) =>
    enrichFranchise(franchise, countMap.get(String(franchise._id)) || 0),
  );

  return sendSuccess(res, 200, "Franchises fetched", { franchises });
});

const getFranchiseStats = asyncHandler(async (_req, res) => {
  const franchises = await Franchise.find({})
    .select("plan approvalStatus")
    .lean();

  const planBreakdown = {
    basic: 0,
    franchise: 0,
    free: 0,
    starter: 0,
    pro: 0,
  };

  franchises.forEach((franchise) => {
    const slug = normalizeAllowedPlan(franchise.plan);
    planBreakdown[slug] = (planBreakdown[slug] || 0) + 1;
  });

  const [total, pending, approved, rejected] = await Promise.all([
    Franchise.countDocuments(),
    Franchise.countDocuments({ approvalStatus: "pending" }),
    Franchise.countDocuments({ approvalStatus: "approved" }),
    Franchise.countDocuments({ approvalStatus: "rejected" }),
  ]);

  return sendSuccess(res, 200, "Franchise stats fetched", {
    total,
    pending,
    approved,
    rejected,
    planBreakdown,
  });
});

const createFranchise = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (payload.code !== undefined) {
    payload.code = normalizeFranchiseCode(payload.code);
  }
  if (payload.franchiseOwner) {
    const owner = await User.findById(payload.franchiseOwner);
    if (!owner) return sendError(res, 404, "Franchise owner user not found.");
    if (owner.role !== "franchiseOwner" && owner.role !== "owner") {
      return sendError(res, 400, "Franchise owner user must have owner/franchiseOwner role.");
    }
  }

  if (payload.plan !== undefined) {
    payload.plan = normalizeAllowedPlan(payload.plan);
  } else {
    payload.plan = "basic";
  }

  if (payload.code) {
    const existingFranchise = await Franchise.findOne({ code: payload.code })
      .select("_id")
      .lean();
    if (existingFranchise) {
      return sendError(res, 409, getDuplicateFranchiseCodeMessage(payload.code));
    }
  }

  try {
    const franchise = await Franchise.create(payload);
    const populated = await Franchise.findById(franchise._id)
      .populate("franchiseOwner", "fullName phoneNo emailId role")
      .lean();

    return sendSuccess(res, 201, "Franchise created successfully", {
      franchise: enrichFranchise(populated, 0),
    });
  } catch (err) {
    if (isDuplicateFranchiseCodeError(err)) {
      return sendError(
        res,
        409,
        getDuplicateFranchiseCodeMessage(err?.keyValue?.code || payload.code),
      );
    }
    throw err;
  }
});

const updateFranchise = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (payload.code !== undefined) {
    payload.code = normalizeFranchiseCode(payload.code);
  }
  if (payload.franchiseOwner) {
    const owner = await User.findById(payload.franchiseOwner);
    if (!owner) return sendError(res, 404, "Franchise owner user not found.");
  }

  if (payload.plan !== undefined) {
    payload.plan = normalizeAllowedPlan(payload.plan);
  }

  if (payload.sharingPolicy) {
    payload.sharingPolicy.shareCustomers = false;
    payload.sharingPolicy.shareMembers = false;
  }

  if (payload.code) {
    const existingFranchise = await Franchise.findOne({ code: payload.code })
      .select("_id")
      .lean();
    if (
      existingFranchise &&
      String(existingFranchise._id) !== String(req.params.id)
    ) {
      return sendError(res, 409, getDuplicateFranchiseCodeMessage(payload.code));
    }
  }

  let franchise;
  try {
    franchise = await Franchise.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { returnDocument: "after", runValidators: true },
    )
      .populate("franchiseOwner", "fullName phoneNo emailId role")
      .lean();
  } catch (err) {
    if (isDuplicateFranchiseCodeError(err)) {
      return sendError(
        res,
        409,
        getDuplicateFranchiseCodeMessage(err?.keyValue?.code || payload.code),
      );
    }
    throw err;
  }
  if (!franchise) return sendError(res, 404, "Franchise not found.");

  const garageCount = await Garage.countDocuments({ franchiseId: franchise._id });

  return sendSuccess(res, 200, "Franchise updated successfully", {
    franchise: enrichFranchise(franchise, garageCount),
  });
});

const deleteFranchise = asyncHandler(async (req, res) => {
  const franchise = await Franchise.findById(req.params.id);
  if (!franchise) return sendError(res, 404, "Franchise not found.");
  await Garage.updateMany({ franchiseId: franchise._id }, { $set: { franchiseId: null } });
  await Franchise.findByIdAndDelete(franchise._id);
  return sendSuccess(res, 200, "Franchise deleted successfully");
});

const approveFranchise = asyncHandler(async (req, res) => {
  const franchise = await Franchise.findByIdAndUpdate(
    req.params.id,
    { approvalStatus: "approved" },
    { returnDocument: "after" },
  ).lean();
  if (!franchise) return sendError(res, 404, "Franchise not found.");
  return sendSuccess(res, 200, "Franchise approved", { franchise });
});

const rejectFranchise = asyncHandler(async (req, res) => {
  const franchise = await Franchise.findByIdAndUpdate(
    req.params.id,
    { approvalStatus: "rejected" },
    { returnDocument: "after" },
  ).lean();
  if (!franchise) return sendError(res, 404, "Franchise not found.");
  return sendSuccess(res, 200, "Franchise rejected", { franchise });
});

const linkGarageToFranchise = asyncHandler(async (req, res) => {
  const { garageId } = req.body;
  const franchise = await Franchise.findById(req.params.id);
  if (!franchise) return sendError(res, 404, "Franchise not found.");

  const currentGarage = await Garage.findById(garageId).select("franchiseId").lean();
  if (!currentGarage) return sendError(res, 404, "Garage not found.");
  if (String(currentGarage.franchiseId || "") === String(franchise._id)) {
    return sendSuccess(res, 200, "Garage already linked to this franchise.");
  }

  await ensureFranchiseCapacity(franchise._id, 1);

  const garage = await Garage.findByIdAndUpdate(
    garageId,
    { $set: { franchiseId: franchise._id } },
    { returnDocument: "after" },
  ).lean();

  return sendSuccess(res, 200, "Garage linked to franchise", { garage });
});

const unlinkGarageFromFranchise = asyncHandler(async (req, res) => {
  const garage = await Garage.findByIdAndUpdate(
    req.params.garageId,
    { $set: { franchiseId: null } },
    { returnDocument: "after" },
  ).lean();
  if (!garage) return sendError(res, 404, "Garage not found.");
  return sendSuccess(res, 200, "Garage unlinked from franchise", { garage });
});

const getFranchiseDetail = asyncHandler(async (req, res) => {
  const franchise = await Franchise.findById(req.params.id)
    .populate("franchiseOwner", "fullName phoneNo emailId role")
    .lean();
  if (!franchise) return sendError(res, 404, "Franchise not found.");

  const garages = await Garage.find({ franchiseId: franchise._id })
    .populate("owner", "fullName phoneNo emailId isVerified")
    .populate("manager", "fullName phoneNo emailId role")
    .sort({ isPrimaryBranch: -1, createdAt: -1 })
    .lean();

  const enrichedGarages = garages.map((g) => ({
    ...g,
    approvalStatus: g.approvalStatus || "pending",
  }));

  return sendSuccess(res, 200, "Franchise detail fetched", {
    franchise: enrichFranchise(franchise, garages.length),
    garages: enrichedGarages,
  });
});

module.exports = {
  listFranchises,
  getFranchiseStats,
  createFranchise,
  updateFranchise,
  deleteFranchise,
  approveFranchise,
  rejectFranchise,
  linkGarageToFranchise,
  unlinkGarageFromFranchise,
  getFranchiseDetail,
};
