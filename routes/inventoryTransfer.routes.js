const router = require("express").Router();
const protect = require("../middlewares/auth");
const {
  listTransfers,
  createTransfer,
  approveTransfer,
  markInTransit,
  receiveTransfer,
  rejectTransfer,
} = require("../controllers/inventoryTransfer.controller");

router.use(protect);

router.get("/", listTransfers);
router.post("/", createTransfer);
router.patch("/:id/approve", approveTransfer);
router.patch("/:id/reject", rejectTransfer);
router.patch("/:id/in-transit", markInTransit);
router.patch("/:id/receive", receiveTransfer);

module.exports = router;
