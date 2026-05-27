// middlewares/checkSubscription.js
// ─────────────────────────────────────────────────────────────────
//  PASS-THROUGH — subscription enforcement is currently disabled.
//
//  ⚠️  Security note
//  ─────────────────
//  This middleware is intentionally a no-op while the plan/billing
//  system is being rebuilt. Routes that mount it (checkSubscription
//  → checkQuota → checkFeature) are NOT actually gated — any
//  authenticated user can hit them regardless of their plan.
//
//  This is acceptable today because we have no paying-customer
//  segmentation in production, but BEFORE you ship plans:
//    1. Re-introduce a Subscription model lookup keyed on
//       req.user.garage / req.user.franchiseId.
//    2. Attach the resolved record to req.subscription.
//    3. Fail-closed: if no subscription is found for a route that
//       was mounted with this middleware, return 402/403 rather
//       than passing through.
//
//  Tag every callsite with grep "checkSubscription(" to find what
//  needs to be enforced once the subscription store exists.
//
//  Must run AFTER `protect` middleware (needs req.user).
// ─────────────────────────────────────────────────────────────────

let warnedOnce = false;

const checkSubscription = async (req, res, next) => {
  if (!warnedOnce && process.env.NODE_ENV !== "test") {
    // Print once per process so this stays visible in logs / Sentry
    // until plan enforcement is wired up. Intentionally not per-request
    // so we don't flood the log.
    console.warn(
      "[checkSubscription] Plan gates are disabled (pass-through). " +
        "See middlewares/checkSubscription.js — TODO before launching plans.",
    );
    warnedOnce = true;
  }
  req.subscription = null;
  next();
};

module.exports = checkSubscription;
