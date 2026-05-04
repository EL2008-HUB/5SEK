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

// Login: 10 attempts per 15 min per IP — brute-force protection
const loginRateLimit = createRateLimiter({
  scope: "auth:login",
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keyStrategy: "ip",
  message: "auth_rate_limited",
});

// Register: 5 new accounts per hour per IP — account farming protection
const registerRateLimit = createRateLimiter({
  scope: "auth:register",
  limit: 5,
  windowMs: 60 * 60 * 1000,
  keyStrategy: "ip",
  message: "register_rate_limited",
});

// Refresh/logout: 30 per 15 min per IP — generous but bounded
const sessionRateLimit = createRateLimiter({
  scope: "auth:session",
  limit: 30,
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

router.post("/register", registerRateLimit, validateRegister, authController.register);
router.post("/login", loginRateLimit, validateLogin, authController.login);
router.post("/refresh", sessionRateLimit, validateRefresh, authController.refresh);
router.post("/logout", sessionRateLimit, validateLogout, authController.logout);

// Protected routes
router.get("/me", authController.authMiddleware, authController.me);
router.delete("/me", authController.authMiddleware, validateEmptyBody, authController.deleteMe);
router.put("/country", authController.authMiddleware, validateCountryUpdate, authController.updateCountry);
router.put("/profile", authController.authMiddleware, validateProfileUpdate, authController.updateProfile);
router.post("/logout-all", authController.authMiddleware, authController.logoutAll);

module.exports = router;
