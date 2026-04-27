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

const authHealthPayload = {
  service: "auth",
  status: "ok",
  endpoints: [
    "POST /api/auth/register",
    "POST /api/auth/login",
    "GET /api/auth/me",
  ],
};

router.get("/", (req, res) => {
  res.json(authHealthPayload);
});

router.get("/health", (req, res) => {
  res.json({
    service: "auth",
    status: "ok",
  });
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
