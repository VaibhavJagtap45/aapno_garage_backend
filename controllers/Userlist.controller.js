// const User = require("../models/User.model");
// const Vehicle = require("../models/Vehicle.model");
// const asyncHandler = require("../utils/asyncHandler");
// const { sendSuccess, sendError } = require("../utils/response.utils");

// // ─────────────────────────────────────────────────────────────────
// //  GET USERS BY ROLE  (list)
// //  GET /api/v1/customers     GET /api/v1/members       GET /api/v1/vendors
// //  Access: Owner only
// const getUsersByRole = asyncHandler(async (req, res) => {
//   if (req.user.role !== "owner") {
//     return sendError(
//       res,
//       403,
//       "Access denied. Only owners can view user lists.",
//     );
//   }

//   // const { role, search } = req.query;
//   // was: const { role, search } = req.query;
//   const role = req.targetRole;
//   const { search } = req.query;

//   const allowedRoles = ["customer", "member", "vendor"];
//   if (!role || !allowedRoles.includes(role)) {
//     return sendError(res, 400, "Invalid role.");
//   }

//   // ── AFTER (role always applied, search is additive) ──
//   const filter = { role };
//   if (search) {
//     filter.$and = [
//       { role },
//       {
//         $or: [
//           { fullName: { $regex: search, $options: "i" } },
//           { phoneNo: { $regex: search, $options: "i" } },
//           { emailId: { $regex: search, $options: "i" } },
//         ],
//       },
//     ];
//     delete filter.role; // avoid duplicate, $and already has it
//   }

//   const users = await User.find(filter)
//     .select("-otp -refreshToken -__v")
//     .sort({ createdAt: -1 })
//     .lean();

//   return sendSuccess(res, 200, `${role}s fetched successfully.`, {
//     total: users.length,
//     users,
//   });
// });

// // ─────────────────────────────────────────────────────────────────
// //  GET USER DETAIL BY ID
// //
// //  customer       → user info + all linked vehicles
// //  member/vendor  → user info only
// //
// //  GET /api/v1/customers/:id
// //  GET /api/v1/members/:id
// //  GET /api/v1/vendors/:id
// //  Access: Owner only
// // ─────────────────────────────────────────────────────────────────
// const getUserDetail = asyncHandler(async (req, res) => {
//   if (req.user.role !== "owner") {
//     return sendError(
//       res,
//       403,
//       "Access denied. Only owners can view user details.",
//     );
//   }

//   const { userId } = req.params;

//   const user = await User.findById(userId)
//     .select("-otp -refreshToken -__v")
//     .lean();

//   if (!user) {
//     return sendError(res, 404, "User not found.");
//   }

//   if (user.role === "customer") {
//     const vehicles = await Vehicle.find({ user: userId })
//       .sort({ createdAt: -1 })
//       .lean();

//     return sendSuccess(res, 200, "Customer details fetched successfully.", {
//       user,
//       vehicles,
//       totalVehicles: vehicles.length,
//     });
//   }

//   return sendSuccess(res, 200, `${user.role} details fetched successfully.`, {
//     user,
//   });
// });

// module.exports = { getUsersByRole, getUserDetail };

const User = require("../models/User.model");
const Garage = require("../models/Garage.model");
const Vehicle = require("../models/Vehicle.model");
const PurchaseOrder = require("../models/PurchaseOrder.model");
const StockIn = require("../models/StockIn.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");

// ─────────────────────────────────────────────────────────────────
//  GET USERS BY ROLE  (list)
//  GET /api/v1/customers     GET /api/v1/members     GET /api/v1/vendors
//  Access: Owner only — scoped to the owner's garage
// ─────────────────────────────────────────────────────────────────
const getUsersByRole = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(
      res,
      403,
      "Access denied. Only owners can view user lists.",
    );
  }

  const role = req.targetRole;
  const { search } = req.query;

  const allowedRoles = ["customer", "member", "vendor"];
  if (!role || !allowedRoles.includes(role)) {
    return sendError(res, 400, "Invalid role.");
  }

  // ── Find this owner's garage ────────────────────────────────────
  const garage = await Garage.findOne({ owner: req.user._id }).lean();
  if (!garage) {
    return sendSuccess(res, 200, `${role}s fetched successfully.`, {
      total: 0,
      users: [],
    });
  }

  // ── Build filter scoped to this garage ──────────────────────────
  const filter = { role, garage: garage._id };

  if (search) {
    filter.$and = [
      { role },
      { garage: garage._id },
      {
        $or: [
          { fullName: { $regex: search, $options: "i" } },
          { phoneNo: { $regex: search, $options: "i" } },
          { emailId: { $regex: search, $options: "i" } },
        ],
      },
    ];
    delete filter.role;
    delete filter.garage;
  }

  const users = await User.find(filter)
    .select("-otp -refreshToken -__v -password -pushToken")
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(res, 200, `${role}s fetched successfully.`, {
    total: users.length,
    users,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET USER DETAIL BY ID
//  GET /api/v1/customers/:id   GET /api/v1/members/:id   GET /api/v1/vendors/:id
//  Access: Owner only
// ─────────────────────────────────────────────────────────────────
const getUserDetail = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(
      res,
      403,
      "Access denied. Only owners can view user details.",
    );
  }

  const { userId } = req.params;

  const user = await User.findById(userId)
    .select("-otp -refreshToken -__v -password -pushToken")
    .lean();

  if (!user) {
    return sendError(res, 404, "User not found.");
  }

  if (user.role === "customer") {
    const vehicles = await Vehicle.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Customer details fetched successfully.", {
      user,
      vehicles,
      totalVehicles: vehicles.length,
    });
  }

  if (user.role === "vendor") {
    // Scope to the requesting owner's garage
    const garage = await Garage.findOne({ owner: req.user._id }).select("_id").lean();
    const garageId = garage?._id ?? null;

    const [purchaseOrders, stockIns, statsArr] = await Promise.all([
      garageId
        ? PurchaseOrder.find({ garageId, vendorId: userId, isDeleted: false })
            .sort({ createdAt: -1 })
            .lean()
        : [],
      garageId
        ? StockIn.find({ garageId, vendorId: userId, isDeleted: false })
            .sort({ date: -1 })
            .lean()
        : [],
      garageId
        ? PurchaseOrder.aggregate([
            { $match: { garageId, vendorId: user._id, isDeleted: false } },
            {
              $group: {
                _id:           null,
                totalOrders:   { $sum: 1 },
                totalValue:    { $sum: "$totalAmount" },
                pendingOrders: { $sum: { $cond: [{ $in: ["$status", ["draft", "sent"]] }, 1, 0] } },
                pendingValue:  { $sum: { $cond: [{ $in: ["$status", ["draft", "sent"]] }, "$totalAmount", 0] } },
                receivedOrders:{ $sum: { $cond: [{ $eq: ["$status", "received"] }, 1, 0] } },
              },
            },
          ])
        : [],
    ]);

    const stats = statsArr[0] ?? {
      totalOrders: 0, totalValue: 0,
      pendingOrders: 0, pendingValue: 0, receivedOrders: 0,
    };

    return sendSuccess(res, 200, "Vendor details fetched successfully.", {
      user,
      purchaseOrders,
      stockIns,
      stats,
    });
  }

  return sendSuccess(res, 200, `${user.role} details fetched successfully.`, {
    user,
  });
});

// ─────────────────────────────────────────────────────────────────
//  UPDATE USER BY ID
//  PUT /api/v1/members/:id   PUT /api/v1/vendors/:id   PUT /api/v1/customers/:id
//  Access: Owner only — must belong to their garage
// ─────────────────────────────────────────────────────────────────
const updateUser = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied. Only owners can update users.");
  }

  const { userId } = req.params;
  const user = await User.findById(userId);
  if (!user) return sendError(res, 404, "User not found.");

  // Scope check — can only update users that belong to this garage
  const garage = await Garage.findOne({ owner: req.user._id }).lean();
  if (!garage || String(user.garage) !== String(garage._id)) {
    return sendError(res, 403, "You can only update users from your own garage.");
  }

  const { fullName, phoneNo, emailId, address, baseSalary } = req.body;

  // Duplicate guard for phone / email — must not collide with another user.
  const orConditions = [];
  if (phoneNo && phoneNo !== user.phoneNo) orConditions.push({ phoneNo });
  if (emailId && emailId.toLowerCase() !== user.emailId) {
    orConditions.push({ emailId: emailId.toLowerCase() });
  }
  if (orConditions.length > 0) {
    const existing = await User.findOne({
      _id: { $ne: userId },
      $or: orConditions,
    }).lean();
    if (existing) {
      const conflict =
        existing.phoneNo === phoneNo ? "phone number" : "email address";
      return sendError(
        res,
        409,
        `Another user with this ${conflict} already exists.`,
      );
    }
  }

  if (fullName !== undefined && fullName.trim()) user.fullName = fullName.trim();
  if (phoneNo !== undefined && phoneNo) user.phoneNo = phoneNo;
  if (emailId !== undefined) {
    user.emailId = emailId ? emailId.toLowerCase() : user.emailId;
  }
  if (address !== undefined) user.address = address;
  // Base salary only applies to members (mechanics).
  if (
    user.role === "member" &&
    baseSalary !== undefined &&
    baseSalary !== null &&
    baseSalary !== ""
  ) {
    user.baseSalary = Number(baseSalary);
  }

  await user.save();

  const safe = await User.findById(userId)
    .select("-otp -refreshToken -__v -password -pushToken")
    .lean();
  return sendSuccess(res, 200, "User updated successfully.", { user: safe });
});

// ─────────────────────────────────────────────────────────────────
//  DELETE USER BY ID
//  DELETE /api/v1/customers/:id
//  Access: Owner only — must belong to their garage
// ─────────────────────────────────────────────────────────────────
const deleteUser = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied. Only owners can delete users.");
  }

  const { userId } = req.params;

  const user = await User.findById(userId).lean();
  if (!user) return sendError(res, 404, "User not found.");

  // Scope check — can only delete users that belong to this garage
  const garage = await Garage.findOne({ owner: req.user._id }).lean();
  if (!garage || String(user.garage) !== String(garage._id)) {
    return sendError(res, 403, "You can only delete customers from your own garage.");
  }

  await User.findByIdAndDelete(userId);
  await Vehicle.deleteMany({ user: userId }); // cascade-delete linked vehicles

  const noun =
    user.role === "member"
      ? "Member"
      : user.role === "vendor"
        ? "Vendor"
        : "Customer";
  return sendSuccess(res, 200, `${noun} deleted successfully.`);
});

module.exports = { getUsersByRole, getUserDetail, updateUser, deleteUser };
