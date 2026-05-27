const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const {
  adminLogin,
  getAllGarages,
  getGarageDetail,
  getGarageStats,
  getVehicleMeta,
  addVehicleBrand,
  addVehicleModel,
  createGarage,
  updateGarage,
  deleteGarage,
  approveGarage,
  rejectGarage,
} = require("../controllers/admin.controller");
const {
  getAnalytics,
  getAnalyticsMeta,
} = require("../controllers/analytics.controller");
const {
  tallyExportJSON,
  tallyExportCSV,
} = require("../controllers/tallyExport.controller");
const {
  listUsers,
  getUserStats,
} = require("../controllers/userAdmin.controller");

// Public
router.post("/login", adminLogin);

// Analytics
router.get("/analytics/meta", adminProtect, getAnalyticsMeta);
router.get("/analytics", adminProtect, getAnalytics);

// Tally Export
router.get("/tally-export", adminProtect, tallyExportJSON);
router.get("/tally-export/csv", adminProtect, tallyExportCSV);

// Users
router.get("/users/stats", adminProtect, getUserStats);
router.get("/users", adminProtect, listUsers);

// Garages
router.get("/garages/stats", adminProtect, getGarageStats);
router.get("/garages", adminProtect, getAllGarages);
router.get("/garages/:id", adminProtect, getGarageDetail);
router.post("/garages", adminProtect, createGarage);
router.put("/garages/:id", adminProtect, updateGarage);
router.delete("/garages/:id", adminProtect, deleteGarage);
router.patch("/garages/:id/approve", adminProtect, approveGarage);
router.patch("/garages/:id/reject", adminProtect, rejectGarage);

// Vehicle brand/model master data
router.get("/vehicle-meta", adminProtect, getVehicleMeta);
router.post("/vehicle-meta/brand", adminProtect, addVehicleBrand);
router.post("/vehicle-meta/model", adminProtect, addVehicleModel);

module.exports = router;
