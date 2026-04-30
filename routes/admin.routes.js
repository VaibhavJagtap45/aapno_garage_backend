const router = require("express").Router();
const adminProtect = require("../middlewares/adminAuth");
const {
  adminLogin,
  getAllGarages,
  getGarageStats,
  createGarage,
  updateGarage,
  deleteGarage,
  approveGarage,
  rejectGarage,
} = require("../controllers/admin.controller");
const {
  listFranchises,
  getFranchiseStats,
  createFranchise,
  updateFranchise,
  deleteFranchise,
  approveFranchise,
  rejectFranchise,
  linkGarageToFranchise,
  unlinkGarageFromFranchise,
  getFranchiseDetail,
} = require("../controllers/franchiseAdmin.controller");
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
router.post("/garages", adminProtect, createGarage);
router.put("/garages/:id", adminProtect, updateGarage);
router.delete("/garages/:id", adminProtect, deleteGarage);
router.patch("/garages/:id/approve", adminProtect, approveGarage);
router.patch("/garages/:id/reject", adminProtect, rejectGarage);

// Franchises
router.get("/franchises/stats", adminProtect, getFranchiseStats);
router.get("/franchises", adminProtect, listFranchises);
router.post("/franchises", adminProtect, createFranchise);
router.get("/franchises/:id", adminProtect, getFranchiseDetail);
router.put("/franchises/:id", adminProtect, updateFranchise);
router.delete("/franchises/:id", adminProtect, deleteFranchise);
router.patch("/franchises/:id/approve", adminProtect, approveFranchise);
router.patch("/franchises/:id/reject", adminProtect, rejectFranchise);
router.patch("/franchises/:id/link-garage", adminProtect, linkGarageToFranchise);
router.patch("/franchises/unlink-garage/:garageId", adminProtect, unlinkGarageFromFranchise);

module.exports = router;
