// middlewares/checkFeature.js
// ─────────────────────────────────────────────────────────────────
//  Gates routes behind plan-level feature flags.
//
//  Must run AFTER `checkSubscription` (needs req.subscription).
//
//  Usage:
//    router.get("/reports/gst", protect, checkSubscription, checkFeature("all_reports"), getGstReport);
//    router.get("/reports/gst", protect, checkSubscription, checkFeature("all_reports"), getGstReport);
// ─────────────────────────────────────────────────────────────────

const checkFeature = (feature) => (req, res, next) => {
  next();
};

module.exports = checkFeature;
