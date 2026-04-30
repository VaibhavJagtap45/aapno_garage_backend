// core/middleware/authorize.js
// RBAC for SaaS roles. Use AFTER `protect` (req.user must exist).
//
//   router.get("/admin/x", protect, authorize("superAdmin"), handler);
//   router.post("/garage/y", protect, authorize("owner", "manager"), handler);
//
// Roles recognised:
//   superAdmin     — platform staff, full access
//   franchiseAdmin — manages a single franchise + its garages
//   owner          — owns one or more garages
//   manager        — runs a specific garage
//   staff          — limited day-to-day access inside a garage
// Legacy roles (member, customer, vendor, franchiseOwner) are tolerated by
// auth.js but will only match if explicitly named here.

const { ForbiddenError, UnauthorizedError } = require("../errors");

function authorize(...roles) {
  const allowed = new Set(roles.flat());
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError("Not authenticated."));
    if (!allowed.has(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access denied. Required role: ${[...allowed].join(" or ")}.`,
        ),
      );
    }
    next();
  };
}

module.exports = authorize;
