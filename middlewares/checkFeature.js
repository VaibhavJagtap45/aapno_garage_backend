// middlewares/checkFeature.js
// ─────────────────────────────────────────────────────────────────
//  PASS-THROUGH — plan-feature gating is currently disabled.
//
//  ⚠️  Security note
//  ─────────────────
//  See checkSubscription.js for context. Every call to
//  `checkFeature("all_reports")`, `checkFeature("franchise")`, etc.
//  is currently a no-op — feature-flagged routes are reachable by
//  any authenticated user.
//
//  When you wire up plans:
//    1. Resolve req.subscription.features (Set / array of strings).
//    2. Return 403 if the named feature is not present.
//    3. Fail-closed when req.subscription is missing on a gated
//       route — do NOT pass through silently.
//
//  Usage:
//    router.get(
//      "/reports/gst",
//      protect, checkSubscription, checkFeature("all_reports"),
//      getGstReport,
//    );
// ─────────────────────────────────────────────────────────────────

let warnedOnce = false;

const checkFeature = (feature) => (req, _res, next) => {
  if (!warnedOnce && process.env.NODE_ENV !== "test") {
    console.warn(
      `[checkFeature] Feature gate for "${feature}" is disabled (pass-through). ` +
        "See middlewares/checkFeature.js — TODO before launching plans.",
    );
    warnedOnce = true;
  }
  next();
};

module.exports = checkFeature;
