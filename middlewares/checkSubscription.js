// middlewares/checkSubscription.js
// ─────────────────────────────────────────────────────────────────
//  Legacy compatibility middleware.
//  Subscription enforcement has been retired, so it now acts as a pass-through.
//
//  Must run AFTER `protect` middleware (needs req.user).
//  Attaches `req.subscription = null` for downstream middleware/controllers.
// ─────────────────────────────────────────────────────────────────

const checkSubscription = async (req, res, next) => {
  try {
    req.subscription = null;
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = checkSubscription;
