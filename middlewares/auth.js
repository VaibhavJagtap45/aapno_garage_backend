// middlewares/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

// ─────────────────────────────────────────────────────────────────
//  protect
//
//  Guards any route that requires an authenticated user.
//  Validates the Bearer access token, ensures the user still exists
//  and has a verified account, then attaches `req.user`.
//
//  Note: password has select:false in schema so it is never returned
//  here — no extra exclusion needed.
// ─────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2. Verify signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      const message =
        err.name === "TokenExpiredError"
          ? "Token expired. Please refresh your session."
          : "Invalid token.";
      return res.status(401).json({ success: false, message });
    }

    if (decoded.role === "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Admin token used on a non-admin API route.",
      });
    }

    // 3. Confirm the account still exists
    //    Exclude refreshToken — never needed downstream
    const user = await User.findById(decoded.sub).select("-refreshToken");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists.",
      });
    }

    // 4. Require a verified account
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Account is not verified.",
      });
    }

    // 5. Attach to request and continue
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = protect;
