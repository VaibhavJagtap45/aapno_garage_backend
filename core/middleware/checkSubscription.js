// core/middleware/checkSubscription.js
//
// Legacy compatibility middleware retained for older route wiring.
//
// Order: protect → attachTenantContext → checkSubscription
//
// Subscription enforcement has been removed, so this now behaves as a pass-through.

function buildCheckSubscription(opts = {}) {
  return async function checkSubscription(req, _res, next) {
    req.subscription = null;
    next();
  };
}

// Default export keeps the call-site form `checkSubscription` (no factory call).
const defaultMiddleware = buildCheckSubscription();
defaultMiddleware.with = buildCheckSubscription; // for opts-based usage
module.exports = defaultMiddleware;
