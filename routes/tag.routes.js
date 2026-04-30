const router = require("express").Router();
const protect = require("../middlewares/auth");
const checkSubscription = require("../middlewares/checkSubscription");
const { listTags, createTag, updateTag, deleteTag } = require("../controllers/tag.controller");

router.use(protect, checkSubscription);

router.get("/", listTags);
router.post("/", createTag);
router.put("/:id", updateTag);
router.delete("/:id", deleteTag);

module.exports = router;
