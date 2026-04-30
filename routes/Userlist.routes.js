// const router = require("express").Router();
// const protect = require("../middlewares/auth");
// const {
//   getUsersByRole,
//   getUserDetail,
// } = require("../controllers/Userlist.controller");

// router.use(protect);

// // ── Customers ─────────────────────────────────────────────────────
// router.get(
//   "/customers",
//   (req, res, next) => {
//     req.query.role = "customer"; // ✅ was "owner"
//     next();
//   },
//   getUsersByRole,
// );

// router.get(
//   "/customers/:id",
//   (req, res, next) => {
//     req.params.userId = req.params.id;
//     next();
//   },
//   getUserDetail,
// );

// // ── Members ───────────────────────────────────────────────────────
// router.get(
//   "/members",
//   (req, res, next) => {
//     req.query.role = "member"; // ✅ was "owner"
//     next();
//   },
//   getUsersByRole,
// );

// router.get(
//   "/members/:id",
//   (req, res, next) => {
//     req.params.userId = req.params.id;
//     next();
//   },
//   getUserDetail,
// );

// // ── Vendors ───────────────────────────────────────────────────────
// router.get(
//   "/vendors",
//   (req, res, next) => {
//     req.query.role = "vendor"; // ✅ was "owner"
//     next();
//   },
//   getUsersByRole,
// );

// router.get(
//   "/vendors/:id",
//   (req, res, next) => {
//     req.params.userId = req.params.id;
//     next();
//   },
//   getUserDetail,
// );

// module.exports = router;

const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const {
  getUsersByRole,
  getUserDetail,
  deleteUser,
} = require("../controllers/Userlist.controller");

router.use(protect, checkSubscription);

// ── Customers ─────────────────────────────────────────────────────
router.get(
  "/customers",
  (req, res, next) => {
    req.targetRole = "customer"; // ← was req.query.role
    next();
  },
  getUsersByRole,
);

router.get(
  "/members",
  (req, res, next) => {
    req.targetRole = "member"; // ← was req.query.role
    next();
  },
  getUsersByRole,
);

router.get(
  "/vendors",
  (req, res, next) => {
    req.targetRole = "vendor"; // ← was req.query.role
    next();
  },
  getUsersByRole,
);

router.get(
  "/customers/:id",
  (req, res, next) => { req.params.userId = req.params.id; next(); },
  getUserDetail,
);

router.delete(
  "/customers/:id",
  (req, res, next) => { req.params.userId = req.params.id; next(); },
  deleteUser,
);

router.get(
  "/members/:id",
  (req, res, next) => {
    req.params.userId = req.params.id;
    next();
  },
  getUserDetail,
);

router.get(
  "/vendors/:id",
  (req, res, next) => {
    req.params.userId = req.params.id;
    next();
  },
  getUserDetail,
);

module.exports = router;
