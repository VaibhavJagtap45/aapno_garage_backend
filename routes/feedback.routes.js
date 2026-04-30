const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const {
  listFeedbacks,
  getFeedbackStats,
  createFeedback,
  deleteFeedback,
} = require("../controllers/feedback.controller");

router.use(protect, checkSubscription);

// GET  /api/v1/feedbacks/stats
router.get("/stats", getFeedbackStats);

// GET  /api/v1/feedbacks
router.get("/", listFeedbacks);

// POST /api/v1/feedbacks
router.post("/", createFeedback);

// DELETE /api/v1/feedbacks/:id
router.delete("/:id", deleteFeedback);

module.exports = router;
