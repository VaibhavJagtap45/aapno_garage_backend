const router = require("express").Router();
const protect = require("../middlewares/auth");
const Franchise = require("../models/Franchise.model");
const Garage = require("../models/Garage.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const resolveGarageContext = require("../utils/resolveGarageContext");

router.use(protect);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const context = await resolveGarageContext(req.user);
    if (!context?.franchiseId) return sendSuccess(res, 200, "No franchise linked", { franchise: null, branches: [] });

    const [franchise, branches] = await Promise.all([
      Franchise.findById(context.franchiseId).lean(),
      Garage.find({ franchiseId: context.franchiseId })
        .select("garageName garageOwnerName garageContactNumber state manager owner")
        .populate("manager", "fullName phoneNo")
        .populate("owner", "fullName phoneNo")
        .lean(),
    ]);
    if (!franchise) return sendError(res, 404, "Franchise not found.");
    return sendSuccess(res, 200, "Franchise fetched", { franchise, branches });
  }),
);

module.exports = router;
