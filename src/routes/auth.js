const router = require("express").Router();
const authController = require("../controllers/authController");
const {
  validateEmptyBody,
  validateCountryUpdate,
  validateLogin,
  validateLogout,
  validateProfileUpdate,
  validateRefresh,
  validateRegister,
} = require("../middleware/validation");
const { createRateLimiter } = require("../middleware/rateLimit");

const authRateLimit = createRateLimiter({
  scope: "auth:mutating",
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "ip",
  message: "auth_rate_limited",
});

router.post("/register", authRateLimit, validateRegister, authController.register);
router.post("/login", authRateLimit, validateLogin, authController.login);
router.post("/refresh", authRateLimit, validateRefresh, authController.refresh);
router.post("/logout", authRateLimit, validateLogout, authController.logout);

// Protected routes
router.get("/me", authController.authMiddleware, authController.me);
router.delete("/me", authController.authMiddleware, validateEmptyBody, authController.deleteMe);
router.put("/country", authController.authMiddleware, validateCountryUpdate, authController.updateCountry);
router.put("/profile", authController.authMiddleware, validateProfileUpdate, authController.updateProfile);
router.post("/logout-all", authController.authMiddleware, authController.logoutAll);

module.exports = router;
