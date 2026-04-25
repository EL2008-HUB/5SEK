const express = require("express");
const { authMiddleware } = require("../controllers/authController");

const router = express.Router();

function normalizePagination(query) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(query.limit || 20)));
  return { page, limit };
}

router.use(authMiddleware);

router.get("/tickets/me", async (req, res) => {
  try {
    const { page, limit } = normalizePagination(req.query);
    const rows = await req.db("support_tickets")
      .where("user_id", req.userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset((page - 1) * limit);

    const total = await req.db("support_tickets")
      .where("user_id", req.userId)
      .count("id as count")
      .first();

    res.json({
      tickets: rows,
      pagination: {
        page,
        limit,
        total: Number(total?.count || 0),
      },
    });
  } catch (error) {
    console.error("Get my support tickets error:", error);
    res.status(500).json({ error: "failed_to_get_tickets" });
  }
});

router.post("/tickets", async (req, res) => {
  try {
    const { category, priority, subject, description, reportedContent } = req.body || {};
    const validCategories = [
      "report_content",
      "report_user",
      "account_issue",
      "billing",
      "bug",
      "feature_request",
      "other",
    ];
    const validPriorities = ["low", "medium", "high", "urgent"];

    if (!subject || !description || !validCategories.includes(String(category || ""))) {
      return res.status(400).json({ error: "invalid_ticket_payload" });
    }

    const [ticket] = await req.db("support_tickets")
      .insert({
        user_id: req.userId,
        category,
        priority: validPriorities.includes(String(priority || "")) ? priority : "medium",
        subject: String(subject).trim(),
        description: String(description).trim(),
        reported_content: reportedContent ? JSON.stringify(reportedContent) : null,
        status: "open",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    res.status(201).json(ticket);
  } catch (error) {
    console.error("Create support ticket error:", error);
    res.status(500).json({ error: "failed_to_create_ticket" });
  }
});

router.get("/refunds/me", async (req, res) => {
  try {
    const { page, limit } = normalizePagination(req.query);
    const requests = await req.db("refund_requests")
      .where("user_id", req.userId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset((page - 1) * limit);

    const total = await req.db("refund_requests")
      .where("user_id", req.userId)
      .count("id as count")
      .first();

    res.json({
      requests,
      pagination: {
        page,
        limit,
        total: Number(total?.count || 0),
      },
    });
  } catch (error) {
    console.error("Get my refund requests error:", error);
    res.status(500).json({ error: "failed_to_get_refunds" });
  }
});

router.post("/refunds", async (req, res) => {
  try {
    const { reason, details, amount, currency, stripePaymentIntentId } = req.body || {};
    const validReasons = [
      "accidental_purchase",
      "unsatisfied",
      "technical_issue",
      "not_as_described",
      "other",
    ];

    if (!validReasons.includes(String(reason || "")) || !Number.isFinite(Number(amount))) {
      return res.status(400).json({ error: "invalid_refund_payload" });
    }

    const [request] = await req.db("refund_requests")
      .insert({
        user_id: req.userId,
        stripe_payment_intent_id: stripePaymentIntentId || null,
        amount: Number(amount),
        currency: String(currency || "USD").toUpperCase(),
        reason,
        details: details ? String(details).trim() : null,
        status: "pending",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    res.status(201).json(request);
  } catch (error) {
    console.error("Create refund request error:", error);
    res.status(500).json({ error: "failed_to_create_refund" });
  }
});

module.exports = router;
