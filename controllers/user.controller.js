// const User = require("../models/User.model");
// const Garage = require("../models/Garage.model");
// const asyncHandler = require("../utils/asyncHandler");
// const { sendSuccess, sendError } = require("../utils/response.utils");
// const Vehicle = require("../models/Vehicle.model");
// // ─────────────────────────────────────────────────────────────────
// //  GET PROFILE
// //  Route : GET /api/user/profile
// //  Access: Protected (Bearer token required)
// const getProfile = asyncHandler(async (req, res) => {
//   const user = req.user; // already attached & sanitised by `protect` middleware

//   // Owner — enrich response with garage details
//   if (user.role === "owner") {
//     const garage = await Garage.findOne({ owner: user._id }).lean();

//     return sendSuccess(res, 200, "Profile fetched successfully", {
//       user,
//       garage: garage ?? null, // null when owner hasn't completed garage setup yet
//     });
//   }

//   // Customer / Member / Vendor — user info only
//   return sendSuccess(res, 200, "Profile fetched successfully", { user });
// });

// // ─────────────────────────────────────────────────────────────────
// // ADD USER -> Only owner can add users  -> role: customer → vehicle details can be added at the same time
// //  Route : POST /api/v1/user/add-user
// const addUser = asyncHandler(async (req, res) => {
//   // ── 1. Gate: only owners may add users ─────────────────────────
//   if (req.user.role !== "owner") {
//     return sendError(res, 403, "Access denied. Only owners can add users.");
//   }

//   const {
//     // User fields
//     phoneNo,
//     emailId,
//     fullName,
//     role,
//     address,
//     // Vehicle fields (customer only)
//     vehicleBrand,
//     vehicleModel,
//     vehicleRegisterNo,
//     vehiclePurchaseDate,
//     vehicleEngineNo,
//     vehicleVinNo,
//     vehicleInsuranceProvider,
//     vehiclePolicyNo,
//     vehicleInsuranceExpire,
//     vehicleRegCertificate,
//     vehicleInsuranceDoc,
//   } = req.body;

//   // ── 2. Duplicate check ──────────────────────────────────────────
//   const orConditions = [];
//   if (phoneNo) orConditions.push({ phoneNo });
//   if (emailId) orConditions.push({ emailId: emailId.toLowerCase() });

//   if (orConditions.length > 0) {
//     const existing = await User.findOne({ $or: orConditions }).lean();
//     if (existing) {
//       const conflict =
//         existing.phoneNo === phoneNo ? "phone number" : "email address";
//       return sendError(
//         res,
//         409,
//         `A user with this ${conflict} already exists.`,
//       );
//     }
//   }

//   // ── 3. Create user ──────────────────────────────────────────────
//   const newUser = await User.create({
//     phoneNo: phoneNo ?? null,
//     emailId: emailId ? emailId.toLowerCase() : null,
//     fullName: fullName ?? null,
//     address: address ?? null,
//     role,
//     isVerified: true,
//   });

//   // ── 4. If customer — optionally create vehicle too ──────────────
//   let vehicle = null;

//   if (role === "customer" && vehicleBrand && vehicleModel) {
//     // Duplicate registration number check
//     if (vehicleRegisterNo) {
//       const existingVehicle = await Vehicle.findOne({
//         vehicleRegisterNo,
//       }).lean();
//       if (existingVehicle) {
//         // User is already created — rollback
//         await User.findByIdAndDelete(newUser._id);
//         return sendError(
//           res,
//           409,
//           "A vehicle with this registration number already exists. User was not saved.",
//         );
//       }
//     }

//     vehicle = await Vehicle.create({
//       user: newUser._id,
//       vehicleBrand,
//       vehicleModel,
//       vehicleRegisterNo,
//       vehiclePurchaseDate,
//       vehicleEngineNo,
//       vehicleVinNo,
//       vehicleInsuranceProvider,
//       vehiclePolicyNo,
//       vehicleInsuranceExpire,
//       vehicleRegCertificate,
//       vehicleInsuranceDoc,
//     });
//   }

//   return sendSuccess(res, 201, "User added successfully", {
//     user: newUser,
//     ...(vehicle && { vehicle }), // only included if vehicle was created
//   });
// });

// module.exports = { getProfile, addUser };

const bcrypt = require("bcryptjs");
const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");
const Vehicle = require("../models/Vehicle.model");

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "Aapnogarage123";

// ─────────────────────────────────────────────────────────────────
//  GET PROFILE
//  Route : GET /api/v1/user/get-profile
//  Access: Protected (Bearer token required)
const getProfile = asyncHandler(async (req, res) => {
  const user = req.user; // already attached & sanitised by `protect` middleware

  // Owner / Manager — enrich response with garage details
  if (user.role === "owner" || user.role === "manager") {
    const garage = await Garage.findOne({ owner: user._id }).lean();
    const resolvedGarage =
      garage || (user.garage ? await Garage.findById(user.garage).lean() : null);

    return sendSuccess(res, 200, "Profile fetched successfully", {
      user,
      garage: resolvedGarage ?? null,
    });
  }

  // Customer / Member / Vendor — user info only
  return sendSuccess(res, 200, "Profile fetched successfully", { user });
});

// ─────────────────────────────────────────────────────────────────
//  ADD USER  → Only owner can add users
//  Route : POST /api/v1/user/add-user
//  role: customer → vehicle details can be added at the same time
const addUser = asyncHandler(async (req, res) => {
  // ── 1. Gate: only owners may add users ─────────────────────────
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied. Only owners can add users.");
  }

  const {
    // User fields
    phoneNo,
    emailId,
    fullName,
    role,
    address,
    // Vehicle fields (customer only)
    vehicleBrand,
    vehicleModel,
    vehicleRegisterNo,
    vehiclePurchaseDate,
    vehicleEngineNo,
    vehicleVinNo,
    vehicleInsuranceProvider,
    vehiclePolicyNo,
    vehicleInsuranceExpire,
    vehicleRegCertificate,
    vehicleInsuranceDoc,
  } = req.body;

  // ── 2. Look up the owner's garage ──────────────────────────────
  const garage = await Garage.findOne({ owner: req.user._id }).lean();
  if (!garage) {
    return sendError(
      res,
      400,
      "Garage profile not found. Please complete your garage setup first.",
    );
  }

  // ── 3. Duplicate check ──────────────────────────────────────────
  const orConditions = [];
  if (phoneNo) orConditions.push({ phoneNo });
  if (emailId) orConditions.push({ emailId: emailId.toLowerCase() });

  if (orConditions.length > 0) {
    const existing = await User.findOne({ $or: orConditions }).lean();
    if (existing) {
      const conflict =
        existing.phoneNo === phoneNo ? "phone number" : "email address";
      return sendError(
        res,
        409,
        `A user with this ${conflict} already exists.`,
      );
    }
  }

  // ── 4. Create user — stamp with owner's garageId ───────────────
  // emailId must be OMITTED (not null) when absent so the sparse
  // unique index does not treat multiple null values as duplicates.
  // All new users get the hashed default password so they can log in
  // immediately from the mobile app using "Aapnogarage123".
  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  const newUser = await User.create({
    ...(phoneNo && { phoneNo }),
    ...(emailId && { emailId: emailId.toLowerCase() }),
    ...(fullName && { fullName }),
    ...(address && { address }),
    role,
    isVerified: true,
    garage: garage._id,
    password: hashedPassword,
  });

  // ── 5. If customer — optionally create vehicle too ──────────────
  let vehicle = null;

  if (role === "customer" && vehicleBrand && vehicleModel) {
    // Duplicate registration number check
    if (vehicleRegisterNo) {
      const existingVehicle = await Vehicle.findOne({
        vehicleRegisterNo,
      }).lean();
      if (existingVehicle) {
        // User is already created — rollback
        await User.findByIdAndDelete(newUser._id);
        return sendError(
          res,
          409,
          "A vehicle with this registration number already exists. User was not saved.",
        );
      }
    }

    vehicle = await Vehicle.create({
      user: newUser._id,
      vehicleBrand,
      vehicleModel,
      vehicleRegisterNo,
      vehiclePurchaseDate,
      vehicleEngineNo,
      vehicleVinNo,
      vehicleInsuranceProvider,
      vehiclePolicyNo,
      vehicleInsuranceExpire,
      vehicleRegCertificate,
      vehicleInsuranceDoc,
    });
  }

  return sendSuccess(res, 201, "User added successfully", {
    user: newUser,
    ...(vehicle && { vehicle }),
  });
});

// ─────────────────────────────────────────────────────────────────
//  SAVE PUSH TOKEN
//  Route : POST /api/v1/user/push-token
//  Body  : { token: "ExponentPushToken[...]" }
//  Access: Any authenticated user
// ─────────────────────────────────────────────────────────────────
const savePushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return sendError(res, 400, "token (string) is required.");
  }

  if (!token.startsWith("ExponentPushToken[")) {
    return sendError(res, 400, "Invalid Expo push token format.");
  }

  await User.findByIdAndUpdate(req.user._id, { pushToken: token });

  return sendSuccess(res, 200, "Push token saved.");
});

module.exports = { getProfile, addUser, savePushToken };
