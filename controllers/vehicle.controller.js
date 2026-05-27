// const VehicleMeta = require("../models/VehicleMeta.model");
// const User = require("../models/User.model");
// const asyncHandler = require("../utils/asyncHandler");
// const { sendSuccess, sendError } = require("../utils/response.utils");
// // ─────────────────────────────────────────────────────────────────
// //  Route : POST /api/v1/vehicle/brand
// const addBrand = asyncHandler(async (req, res) => {
//   if (req.user.role !== "owner") {
//     return sendError(res, 403, "Only owners can manage vehicle brands.");
//   }

//   const { brand, models = [] } = req.body;

//   if (!brand) {
//     return sendError(res, 400, "brand is required.");
//   }

//   // Upsert — if brand exists, merge new models in
//   const existing = await VehicleMeta.findOne({
//     brand: { $regex: new RegExp(`^${brand}$`, "i") },
//   });

//   if (existing) {
//     // Add only new models that don't already exist (case-insensitive)
//     const existingLower = existing.models.map((m) => m.toLowerCase());
//     const newModels = models.filter(
//       (m) => !existingLower.includes(m.toLowerCase()),
//     );

//     if (newModels.length === 0) {
//       return sendError(
//         res,
//         409,
//         "Brand already exists with all provided models.",
//       );
//     }

//     existing.models.push(...newModels);
//     await existing.save();

//     return sendSuccess(res, 200, "Models added to existing brand.", {
//       vehicleMeta: existing,
//     });
//   }

//   const vehicleMeta = await VehicleMeta.create({ brand, models });

//   return sendSuccess(res, 201, "Brand added successfully.", { vehicleMeta });
// });

// // ─────────────────────────────────────────────────────────────────
// //  ADD MODEL TO EXISTING BRAND ->   Route : POST /api/v1/vehicle/model
// const addModel = asyncHandler(async (req, res) => {
//   if (req.user.role !== "owner") {
//     return sendError(res, 403, "Only owners can manage vehicle models.");
//   }

//   const { brand, model } = req.body;

//   if (!brand || !model) {
//     return sendError(res, 400, "brand and model are required.");
//   }

//   const vehicleMeta = await VehicleMeta.findOne({
//     brand: { $regex: new RegExp(`^${brand}$`, "i") },
//   });

//   if (!vehicleMeta) {
//     return sendError(
//       res,
//       404,
//       `Brand "${brand}" not found. Add the brand first.`,
//     );
//   }

//   const alreadyExists = vehicleMeta.models.some(
//     (m) => m.toLowerCase() === model.toLowerCase(),
//   );

//   if (alreadyExists) {
//     return sendError(
//       res,
//       409,
//       `Model "${model}" already exists under "${brand}".`,
//     );
//   }

//   vehicleMeta.models.push(model);
//   await vehicleMeta.save();

//   return sendSuccess(res, 200, "Model added successfully.", { vehicleMeta });
// });

// // ─────────────────────────────────────────────────────────────────
// //  GET ALL BRANDS ->   Route : GET /api/v1/vehicle/brands
// const getMetaBrands = asyncHandler(async (req, res) => {
//   const brands = await VehicleMeta.find({}, "brand").sort({ brand: 1 }).lean();

//   return sendSuccess(res, 200, "Brands fetched successfully.", {
//     total: brands.length,
//     brands: brands.map((b) => b.brand),
//   });
// });

// // ─────────────────────────────────────────────────────────────────
// //  GET MODELS BY BRAND ->  Route : GET /api/v1/vehicle/models?brand=Honda
// const getMetaModelsByBrand = asyncHandler(async (req, res) => {
//   const { brand } = req.query;

//   if (!brand) {
//     return sendError(res, 400, "brand query param is required.");
//   }

//   const vehicleMeta = await VehicleMeta.findOne({
//     brand: { $regex: new RegExp(`^${brand}$`, "i") },
//   }).lean();

//   if (!vehicleMeta) {
//     return sendError(res, 404, `Brand "${brand}" not found.`);
//   }

//   return sendSuccess(res, 200, "Models fetched successfully.", {
//     brand: vehicleMeta.brand,
//     total: vehicleMeta.models.length,
//     models: vehicleMeta.models.sort(),
//   });
// });

// module.exports = {
//   getMetaModelsByBrand,
//   getMetaBrands,
//   addModel,
//   addBrand,
// };

const Vehicle = require("../models/Vehicle.model");
const User = require("../models/User.model");
const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess, sendError } = require("../utils/response.utils");

// ─────────────────────────────────────────────────────────────────
//  ADD VEHICLE TO EXISTING CUSTOMER
//  Route : POST /api/v1/vehicle/add
//  Access: Owner only
// ─────────────────────────────────────────────────────────────────
const addVehicle = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Only owners can add vehicles.");
  }

  const {
    customerId,
    vehicleBrand,
    vehicleModel,
    vehicleRegisterNo,
    vehiclePurchaseDate,
    vehicleKmDriven,
    vehicleEngineNo,
    vehicleVinNo,
    vehicleInsuranceProvider,
    vehiclePolicyNo,
    vehicleInsuranceExpire,
    vehicleRegCertificate,
    vehicleInsuranceDoc,
  } = req.body;

  if (!customerId) {
    return sendError(res, 400, "customerId is required.");
  }

  if (!vehicleBrand || !vehicleModel) {
    return sendError(res, 400, "vehicleBrand and vehicleModel are required.");
  }

  // Verify the target user exists and is a customer
  const customer = await User.findById(customerId).lean();
  if (!customer) {
    return sendError(res, 404, "Customer not found.");
  }
  if (customer.role !== "customer") {
    return sendError(res, 400, "Vehicles can only be linked to customers.");
  }

  // Duplicate registration number check
  if (vehicleRegisterNo) {
    const existing = await Vehicle.findOne({ vehicleRegisterNo }).lean();
    if (existing) {
      return sendError(
        res,
        409,
        "A vehicle with this registration number already exists.",
      );
    }
  }

  const vehicle = await Vehicle.create({
    user: customerId,
    vehicleBrand,
    vehicleModel,
    vehicleRegisterNo,
    vehiclePurchaseDate,
    vehicleKmDriven,
    vehicleEngineNo,
    vehicleVinNo,
    vehicleInsuranceProvider,
    vehiclePolicyNo,
    vehicleInsuranceExpire,
    vehicleRegCertificate,
    vehicleInsuranceDoc,
  });

  return sendSuccess(res, 201, "Vehicle added successfully.", { vehicle });
});

// ─────────────────────────────────────────────────────────────────
//  GET ALL VEHICLES FOR A CUSTOMER (with user info)
//  Route : GET /api/v1/vehicle/customer/:customerId
//  Access: Owner only
// ─────────────────────────────────────────────────────────────────
const getVehiclesByUser = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const { customerId } = req.params;

  const customer = await User.findById(customerId)
    .select("-otp -refreshToken -__v")
    .lean();

  if (!customer) {
    return sendError(res, 404, "Customer not found.");
  }
  if (customer.role !== "customer") {
    return sendError(res, 400, "User is not a customer.");
  }

  const vehicles = await Vehicle.find({ user: customerId })
    .sort({ createdAt: -1 })
    .lean();

  return sendSuccess(res, 200, "Vehicles fetched successfully.", {
    user: customer,
    vehicles,
    totalVehicles: vehicles.length,
  });
});

// ─────────────────────────────────────────────────────────────────
//  GET SINGLE VEHICLE BY ID (with customer info populated)
//  Route : GET /api/v1/vehicle/:vehicleId
//  Access: Owner only
// ─────────────────────────────────────────────────────────────────
const getVehicleById = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Access denied.");
  }

  const vehicle = await Vehicle.findById(req.params.vehicleId)
    .populate("user", "-otp -refreshToken -__v")
    .lean();

  if (!vehicle) {
    return sendError(res, 404, "Vehicle not found.");
  }

  return sendSuccess(res, 200, "Vehicle fetched successfully.", { vehicle });
});

const updateVehicle = asyncHandler(async (req, res) => {
  if (req.user.role !== "owner") {
    return sendError(res, 403, "Only owners can update vehicles.");
  }

  const { vehicleId } = req.params;

  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return sendError(res, 404, "Vehicle not found.");

  const {
    vehicleBrand,
    vehicleModel,
    vehicleRegisterNo,
    vehiclePurchaseDate,
    vehicleKmDriven,
    vehicleEngineNo,
    vehicleVinNo,
    vehicleInsuranceProvider,
    vehiclePolicyNo,
    vehicleInsuranceExpire,
    vehicleRegCertificate,
    vehicleInsuranceDoc,
  } = req.body;

  // If reg number changed, check for duplicates
  if (vehicleRegisterNo && vehicleRegisterNo !== vehicle.vehicleRegisterNo) {
    const duplicate = await Vehicle.findOne({
      vehicleRegisterNo,
      _id: { $ne: vehicleId },
    }).lean();
    if (duplicate)
      return sendError(
        res,
        409,
        "A vehicle with this registration number already exists.",
      );
  }

  // Apply only provided fields
  if (vehicleBrand !== undefined) vehicle.vehicleBrand = vehicleBrand;
  if (vehicleModel !== undefined) vehicle.vehicleModel = vehicleModel;
  if (vehicleRegisterNo !== undefined)
    vehicle.vehicleRegisterNo = vehicleRegisterNo;
  if (vehiclePurchaseDate !== undefined)
    vehicle.vehiclePurchaseDate = vehiclePurchaseDate;
  if (vehicleKmDriven !== undefined)
    vehicle.vehicleKmDriven = vehicleKmDriven;
  if (vehicleEngineNo !== undefined) vehicle.vehicleEngineNo = vehicleEngineNo;
  if (vehicleVinNo !== undefined) vehicle.vehicleVinNo = vehicleVinNo;
  if (vehicleInsuranceProvider !== undefined)
    vehicle.vehicleInsuranceProvider = vehicleInsuranceProvider;
  if (vehiclePolicyNo !== undefined) vehicle.vehiclePolicyNo = vehiclePolicyNo;
  if (vehicleInsuranceExpire !== undefined)
    vehicle.vehicleInsuranceExpire = vehicleInsuranceExpire;
  if (vehicleRegCertificate !== undefined)
    vehicle.vehicleRegCertificate = vehicleRegCertificate;
  if (vehicleInsuranceDoc !== undefined)
    vehicle.vehicleInsuranceDoc = vehicleInsuranceDoc;

  await vehicle.save();

  return sendSuccess(res, 200, "Vehicle updated successfully.", { vehicle });
});

module.exports = {
  addVehicle,
  getVehiclesByUser,
  getVehicleById,
  updateVehicle,
};

// module.exports = { addVehicle, getVehiclesByUser, getVehicleById };
