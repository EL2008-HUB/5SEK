const router = require("express").Router();
const paymentsController = require("../controllers/paymentsController");
const { authMiddleware } = require("../controllers/authController");

router.get("/config", authMiddleware, paymentsController.getConfig);
router.post("/checkout", authMiddleware, paymentsController.createCheckout);
router.post("/portal", authMiddleware, paymentsController.createPortal);

module.exports = router;
