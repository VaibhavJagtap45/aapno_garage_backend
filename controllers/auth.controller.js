const bcrypt = require("bcryptjs");
const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const asyncHandler = require("../utils/asyncHandler");
const {
  signAccessToken,
  getTokenExpiryDate,
  generateAndSaveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("../utils/token.utils");
const { sendSuccess, sendError } = require("../utils/response.utils");

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "Aapnogarage123";

// ── Cookie config — defined once, reused everywhere ───────────────
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────────
//  POST /auth/register
//
//  Three cases handled:
//  1. User exists + has a password  → 409 (already registered)
//  2. User exists + no password     → set default password (migration path
//                                     for accounts created before password auth)
//  3. New user                      → create with default password
// ─────────────────────────────────────────────────────────────────
const register = asyncHandler(async (req, res) => {
  const { phoneNo } = req.body;

  // select: false on password — must explicitly include it here
  const existingUser = await User.findOne({ phoneNo }).select("+password");

  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  if (existingUser) {
    if (existingUser.password) {
      // Already has a password — they should just login
      return sendError(
        res,
        409,
        "An account with this number already exists. Please login.",
      );
    }

    // Account exists (old OTP user) but has no password — set default password
    await User.findByIdAndUpdate(existingUser._id, {
      password: hashedPassword,
      isVerified: true, // ensure verified in case it wasn't
    });

    return sendSuccess(
      res,
      200,
      "Password set for your account. Login with the default password.",
    );
  }

  // Brand new user
  await User.create({
    phoneNo,
    isVerified: true,
    role: "owner",
    password: hashedPassword,
  });

  return sendSuccess(
    res,
    201,
    "Account created. Login with the default password.",
  );
});

// ─────────────────────────────────────────────────────────────────
//  POST /auth/login
//
//  Authenticates a user with phone + password.
//  Returns access token, user, and garage on success.
// ─────────────────────────────────────────────────────────────────
const login = asyncHandler(async (req, res) => {
  const { phoneNo, password } = req.body;

  // select: false on password — must explicitly include it here
  const user = await User.findOne({ phoneNo }).select("+password");

  if (!user) {
    return sendError(
      res,
      404,
      "No account found with this phone number.",
    );
  }

  if (!user.isVerified) {
    return sendError(
      res,
      403,
      "Account is not active. Please contact support.",
    );
  }

  if (!user.password) {
    return sendError(
      res,
      401,
      "Password not set. Please tap 'Create Account' to set up your default password.",
    );
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return sendError(res, 401, "Incorrect password.");
  }

  const accessToken = signAccessToken(user);
  const accessTokenExpiresAt = getTokenExpiryDate(accessToken)?.toISOString() ?? null;
  const refreshToken = await generateAndSaveRefreshToken(user);

  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  const garage = await Garage.findOne({ owner: user._id }).lean();

  return sendSuccess(res, 200, "Login successful", {
    accessToken,
    accessTokenExpiresAt,
    user: user.toJSON(), // password stripped by toJSON()
    garage: garage ?? null,
    isProfileComplete: garage?.isProfileComplete ?? false,
  });
});

// ─────────────────────────────────────────────────────────────────
//  PATCH /auth/change-password  (protected)
//
//  Changes the authenticated user's password.
//  Requires current password for verification (prevents CSRF misuse).
// ─────────────────────────────────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  if (!user) return sendError(res, 404, "User not found.");

  // If no password set (legacy / admin-created), skip current password check
  if (user.password) {
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return sendError(res, 401, "Current password is incorrect.");
    }
  }

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await User.findByIdAndUpdate(req.user._id, { password: hashedPassword });

  return sendSuccess(res, 200, "Password changed successfully.");
});

// ─────────────────────────────────────────────────────────────────
//  POST /auth/update-garage-profile  (protected, owner only)
//
//  Accepts multipart/form-data OR application/json.
// ─────────────────────────────────────────────────────────────────
const completeGarageProfile = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner")
    return sendError(res, 403, "Only owners can set garage details");

  const userId = req.user._id;

  const {
    fullName,
    emailId,
    state,
    garageName,
    garageOwnerName,
    garageAddress,
    garageContactNumber,
    garageType,
    garageLogo,
    isGstApplicable,
    gstNumber,
  } = req.body;

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    {
      ...(fullName !== undefined && { fullName }),
      ...(emailId !== undefined && { emailId }),
      ...(state !== undefined && { state }),
    },
    { returnDocument: "after", runValidators: true },
  );

  const garagePayload = {
    garageName,
    garageOwnerName,
    garageAddress,
    garageContactNumber,
    garageType,
    isGstApplicable: !!isGstApplicable,
    gstNumber: isGstApplicable ? (gstNumber ?? null) : null,
    isProfileComplete: true,
    ...(garageLogo !== undefined && { garageLogo }),
    ...(state !== undefined && { state }),
  };

  const garage = await Garage.findOneAndUpdate(
    { owner: userId },
    { $set: garagePayload },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  // Link garage to user if not already linked
  if (!req.user.garage || req.user.garage.toString() !== garage._id.toString()) {
    await User.findByIdAndUpdate(userId, { garage: garage._id });
  }

  return sendSuccess(res, 200, "Garage profile completed", {
    user: updatedUser,
    garage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET /auth/garage  — return current user's garage
// ─────────────────────────────────────────────────────────────────
const getMyGarage = asyncHandler(async (req, res) => {
  const garage = await Garage.findOne({ owner: req.user._id }).lean();
  if (!garage) return sendError(res, 404, "Garage not found.");

  return sendSuccess(res, 200, "Garage fetched.", {
    garage,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /auth/refresh  — rotate refresh token
// ─────────────────────────────────────────────────────────────────
const refresh = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken;

  if (!incomingToken) return sendError(res, 401, "No refresh token.");

  const result = await rotateRefreshToken(incomingToken);

  if (!result.success) return sendError(res, 401, result.message);

  res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);

  return sendSuccess(res, 200, "Token refreshed", {
    accessToken: result.accessToken,
    accessTokenExpiresAt:
      getTokenExpiryDate(result.accessToken)?.toISOString() ?? null,
  });
});

// ─────────────────────────────────────────────────────────────────
//  POST /auth/logout
// ─────────────────────────────────────────────────────────────────
const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(req.user._id);
  res.clearCookie("refreshToken");
  return sendSuccess(res, 200, "Logged out successfully");
});

// ─────────────────────────────────────────────────────────────────
//  POST /auth/upload-image
//  Accepts multipart/form-data with field "file" (image only, ≤5MB)
// ─────────────────────────────────────────────────────────────────
const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) return sendError(res, 400, "No file uploaded.");
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  return sendSuccess(res, 200, "Image uploaded successfully", { url });
});

// ─────────────────────────────────────────────────────────────────
//  PATCH /auth/preferences  — save garage app preferences
// ─────────────────────────────────────────────────────────────────
const updatePreferences = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner")
    return sendError(res, 403, "Only owners can update preferences.");

  const garage = await Garage.findOne({ owner: req.user._id });
  if (!garage) return sendError(res, 404, "Garage not found.");

  const allowed = ["notificationsEnabled", "autoUpdates", "autoWaNotification", "fontSize"];
  const validFontSizes = ["small", "medium", "large"];

  if (!garage.preferences) garage.preferences = {};

  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    if (key === "fontSize" && !validFontSizes.includes(req.body[key])) continue;
    garage.preferences[key] = req.body[key];
  }

  garage.markModified("preferences");
  await garage.save();

  return sendSuccess(res, 200, "Preferences saved.", {
    preferences: garage.preferences,
  });
});

module.exports = {
  register,
  login,
  changePassword,
  completeGarageProfile,
  getMyGarage,
  refresh,
  logout,
  uploadImage,
  updatePreferences,
};
