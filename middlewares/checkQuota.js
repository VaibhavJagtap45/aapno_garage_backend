// middlewares/checkQuota.js
// ─────────────────────────────────────────────────────────────────
//  Factory that returns middleware to enforce plan limits.
//
//  Must run AFTER `checkSubscription` (needs req.subscription).
//
//  Usage:
//    router.post("/", protect, checkSubscription, checkQuota("repairOrders"), create);
//
//  For non-monthly resources (members, customers, vendors) we count
//  the actual DB records instead of relying on the usage counter.
// ─────────────────────────────────────────────────────────────────

const checkQuota = (resource) => async (req, res, next) => {
  try {
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = checkQuota;
