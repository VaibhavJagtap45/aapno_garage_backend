const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const checkQuota = require("../middlewares/checkQuota");
const validate = require("../middlewares/validate");
const { addUserSchema } = require("../validators/user.validator");
const { getProfile, addUser, savePushToken } = require("../controllers/user.controller");

// ─────────────────────────────────────────────────────────────────
//  GET  /api/user/profile
router.get("/get-profile", protect, getProfile);

// ─────────────────────────────────────────────────────────────────
//  POST /api/user/add-user  (quota-gated based on role being added)
//  Middleware resolves quota resource from req.body.role
router.post(
  "/add-user",
  protect,
  checkSubscription,
  (req, _res, next) => {
    // Map role being added → quota resource name
    const roleToResource = { member: "members", customer: "customers", vendor: "vendors" };
    req._quotaResource = roleToResource[req.body.role] || null;
    next();
  },
  (req, res, next) => {
    if (!req._quotaResource) return next();
    return checkQuota(req._quotaResource)(req, res, next);
  },
  validate(addUserSchema),
  addUser,
);

// ─────────────────────────────────────────────────────────────────
//  POST /api/v1/user/push-token
//  Save or update the authenticated user's Expo push token
router.post("/push-token", protect, savePushToken);

module.exports = router;
