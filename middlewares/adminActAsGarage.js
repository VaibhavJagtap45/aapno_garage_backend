const mongoose = require("mongoose");
const Garage = require("../models/Garage.model");

// Synthesizes `req.user` so existing garage-scoped controllers
// (which call resolveGarageId(req.user)) work when invoked by an admin
// acting on behalf of a specific garage. Must run after `adminProtect`.
//
// Reads garageId from query, body, then params. Required by default;
// pass `{ optional: true }` for routes where the garageId is not needed
// (e.g. global customer search).
function adminActAsGarage(options = {}) {
  const { optional = false } = options;

  return async (req, res, next) => {
    const raw =
      req.query?.garageId ||
      req.body?.garageId ||
      req.params?.garageId ||
      null;

    if (!raw) {
      if (optional) {
        req.user = { _id: undefined, role: "admin", activeGarageId: null };
        return next();
      }
      return res
        .status(400)
        .json({ success: false, message: "garageId is required." });
    }

    if (!mongoose.Types.ObjectId.isValid(raw)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid garageId." });
    }

    const garage = await Garage.findById(raw).select("_id").lean();
    if (!garage) {
      return res
        .status(404)
        .json({ success: false, message: "Garage not found." });
    }

    req.user = {
      _id: undefined,
      role: "admin",
      activeGarageId: garage._id,
    };

    next();
  };
}

module.exports = adminActAsGarage;
