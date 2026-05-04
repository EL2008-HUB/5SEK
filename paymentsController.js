const {
  createBillingPortalSession,
  createCheckoutSession,
  hasStripeConfig,
  verifyStripeWebhook,
} = require("../services/stripeService");

async function markPremiumFromStripeEvent(db, customerId, subscriptionStatus, rawEvent) {
  if (!customerId) return;

  const isActive = ["active", "trialing"].includes(String(subscriptionStatus || ""));
  await db("users")
    .where({ stripe_customer_id: customerId })
    .update({
      is_premium: isActive,
      subscription_status: subscriptionStatus || (isActive ? "active" : "free"),
      premium_source: "stripe",
      premium_started_at: isActive ? new Date().toISOString() : null,
      premium_expires_at: null,
    });

  if (rawEvent?.id) {
    await db("payment_events")
      .insert({
        provider: "stripe",
        provider_event_id: rawEvent.id,
        event_type: rawEvent.type,
        payload: JSON.stringify(rawEvent),
      })
      .onConflict("provider_event_id")
      .ignore();
  }
}

exports.getConfig = async (req, res) => {
  res.json({
    provider: "stripe",
    checkout_enabled: hasStripeConfig(),
  });
};

exports.createCheckout = async (req, res) => {
  try {
    if (!hasStripeConfig()) {
      return res.status(503).json({ error: "stripe_not_configured" });
    }

    const user = await req.db("users").where({ id: req.userId }).first();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const session = await createCheckoutSession(req.db, user, {
      source: req.body?.source || "paywall",
    });

    res.json({
      id: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("Create checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
};

exports.createPortal = async (req, res) => {
  try {
    if (!hasStripeConfig()) {
      return res.status(503).json({ error: "stripe_not_configured" });
    }

    const user = await req.db("users").where({ id: req.userId }).first();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const portal = await createBillingPortalSession(req.db, user);
    res.json({ url: portal.url });
  } catch (error) {
    console.error("Create billing portal error:", error);
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "");
    verifyStripeWebhook(rawBody, req.headers["stripe-signature"]);

    const event = JSON.parse(rawBody);
    const object = event?.data?.object || {};

    if (event.type === "checkout.session.completed") {
      await markPremiumFromStripeEvent(req.db, object.customer, "active", event);
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await markPremiumFromStripeEvent(req.db, object.customer, object.status || "canceled", event);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ error: "Webhook handling failed" });
  }
};
