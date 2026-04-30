// utils/token.utils.js
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User.model");

// ─── Constants ────────────────────────────────────────────────────
const ACCESS_TOKEN_EXPIRY    = "4h";
const ACCESS_TOKEN_EXPIRY_MS = 4 * 60 * 60 * 1000;
const REFRESH_TOKEN_EXPIRY   = "7d";
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Sign Access Token ────────────────────────────────────────────
const signAccessToken = (user) =>
  jwt.sign(
    {
      sub:     user._id,
      role:    user.role,
      phoneNo: user.phoneNo,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );

// ─── Sign Refresh Token ───────────────────────────────────────────
const signRefreshToken = (user) =>
  jwt.sign({ sub: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

const getTokenExpiryDate = (token) => {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000) : null;
};

// ─── Verify Access Token ──────────────────────────────────────────
const verifyAccessToken = (token) => {
  try {
    return {
      valid:   true,
      expired: false,
      decoded: jwt.verify(token, process.env.JWT_ACCESS_SECRET),
    };
  } catch (err) {
    return {
      valid:   false,
      expired: err.name === "TokenExpiredError",
      decoded: null,
    };
  }
};

// ─── Verify Refresh Token ─────────────────────────────────────────
const verifyRefreshToken = (token) => {
  try {
    return {
      valid:   true,
      expired: false,
      decoded: jwt.verify(token, process.env.JWT_REFRESH_SECRET),
    };
  } catch (err) {
    return {
      valid:   false,
      expired: err.name === "TokenExpiredError",
      decoded: null,
    };
  }
};

// ─── Generate & Save Refresh Token ───────────────────────────────
//  The raw JWT is returned to the caller so it can be set as a cookie.
//  Only the SHA-256 hash is persisted — never the raw token.
const generateAndSaveRefreshToken = async (user) => {
  const refreshToken = signRefreshToken(user);

  const hashedToken = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  await User.findByIdAndUpdate(user._id, {
    refreshToken: {
      token:     hashedToken,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });

  return refreshToken;
};

// ─── Rotate Refresh Token ─────────────────────────────────────────
//  Invalidates the old token and issues a fresh pair.
//  Detects reuse (token theft): if the incoming token is valid JWT
//  but doesn't match the hash in DB, all sessions are revoked.
const rotateRefreshToken = async (incomingToken) => {
  const { valid, expired, decoded } = verifyRefreshToken(incomingToken);

  if (!valid) {
    return {
      success: false,
      message: expired
        ? "Refresh token expired. Please login again."
        : "Invalid refresh token.",
    };
  }

  const user = await User.findById(decoded.sub);
  if (!user || !user.refreshToken?.token) {
    return { success: false, message: "User not found or not logged in." };
  }

  const hashedIncoming = crypto
    .createHash("sha256")
    .update(incomingToken)
    .digest("hex");

  if (hashedIncoming !== user.refreshToken.token) {
    // Token reuse detected — revoke everything immediately
    await User.findByIdAndUpdate(decoded.sub, {
      $unset: { refreshToken: "" },
    });
    return {
      success: false,
      message: "Token reuse detected. Please login again.",
    };
  }

  // Check DB-level expiry as second defence layer
  if (new Date() > user.refreshToken.expiresAt) {
    return {
      success: false,
      message: "Refresh token expired. Please login again.",
    };
  }

  const newAccessToken  = signAccessToken(user);
  const newRefreshToken = await generateAndSaveRefreshToken(user);

  return {
    success:      true,
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  };
};

// ─── Revoke Refresh Token (logout) ────────────────────────────────
const revokeRefreshToken = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    $unset: { refreshToken: "" },
  });
};

module.exports = {
  ACCESS_TOKEN_EXPIRY,
  ACCESS_TOKEN_EXPIRY_MS,
  signAccessToken,
  signRefreshToken,
  getTokenExpiryDate,
  verifyAccessToken,
  verifyRefreshToken,
  generateAndSaveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
