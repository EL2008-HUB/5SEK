const router = require("express").Router();
const paymentsController = require("../controllers/paymentsController");

router.post("/", paymentsController.handleWebhook);

module.exports = router;
