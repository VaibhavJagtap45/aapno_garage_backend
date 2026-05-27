// middlewares/checkQuota.js
// ─────────────────────────────────────────────────────────────────
//  PASS-THROUGH — plan quota enforcement is currently disabled.
//
//  ⚠️  Security note
//  ─────────────────
//  See checkSubscription.js for context. While the plan store is
//  being rebuilt this middleware is a no-op: every protected route
//  (`checkQuota("repairOrders")`, `checkQuota("invoices")`, etc.)
//  accepts unlimited writes regardless of the caller's tier.
//
//  When you wire up plans:
//    1. Read req.subscription.limits[resource].
//    2. For monthly resources (repairOrders, invoices), check the
//       per-garage usage counter for the current period.
//    3. For headcount resources (members, customers, vendors),
//       compare against `Model.countDocuments({ garageId })`.
//    4. Fail-closed when req.subscription is missing on a gated
//       route — do NOT pass through silently.
//
//  Usage:
//    router.post("/", protect, checkSubscription, checkQuota("repairOrders"), create);
// ─────────────────────────────────────────────────────────────────

let warnedOnce = false;

const checkQuota = (resource) => async (req, _res, next) => {
  if (!warnedOnce && process.env.NODE_ENV !== "test") {
    console.warn(
      `[checkQuota] Quota gate for "${resource}" is disabled (pass-through). ` +
        "See middlewares/checkQuota.js — TODO before launching plans.",
    );
    warnedOnce = true;
  }
  next();
};

module.exports = checkQuota;
