const router = require("express").Router();
const pushController = require("../controllers/pushController");
const { authMiddleware } = require("../controllers/authController");
const { createRateLimiter } = require("../middleware/rateLimit");
const {
  validatePushRegister,
  validatePushTest,
  validatePushUnregister,
} = require("../middleware/validation");

const pushRateLimit = createRateLimiter({
  scope: "push",
  limit: 30,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "user",
  message: "push_rate_limited",
});

router.get("/tokens/me", authMiddleware, pushController.listMine);
router.post("/register", authMiddleware, pushRateLimit, validatePushRegister, pushController.register);
router.post("/unregister", authMiddleware, pushRateLimit, validatePushUnregister, pushController.unregister);
router.post("/test", authMiddleware, pushRateLimit, validatePushTest, pushController.sendTest);

module.exports = router;
