const crypto = require("crypto");

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

function hasStripeSecret() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getBaseAppUrl() {
  return (process.env.APP_PUBLIC_URL || "http://localhost:8081").replace(/\/$/, "");
}

async function stripeRequest(path, params) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });

  const payload = await response.json();
  if (!response.ok) {
    const error = payload?.error?.message || "Stripe request failed";
    throw new Error(error);
  }

  return payload;
}

async function ensureStripeCustomer(db, user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripeRequest("/customers", {
    email: user.email,
    name: user.username,
    "metadata[user_id]": String(user.id),
  });

  await db("users").where({ id: user.id }).update({ stripe_customer_id: customer.id });
  return customer.id;
}

async function createCheckoutSession(db, user, metadata = {}) {
  const customerId = await ensureStripeCustomer(db, user);
  const baseUrl = getBaseAppUrl();

  return stripeRequest("/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": process.env.STRIPE_PRICE_ID,
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl}/premium-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/premium-cancelled`,
    "metadata[user_id]": String(user.id),
    "metadata[source]": String(metadata.source || "app_paywall"),
    allow_promotion_codes: "true",
  });
}

async function createBillingPortalSession(db, user) {
  const customerId = await ensureStripeCustomer(db, user);
  return stripeRequest("/billing_portal/sessions", {
    customer: customerId,
    return_url: `${getBaseAppUrl()}/account`,
  });
}

function toStripeAmount(amount, currency = "USD") {
  const normalizedCurrency = String(currency || "USD").toUpperCase();
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("invalid_refund_amount");
  }

  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return Math.round(numericAmount);
  }

  return Math.round(numericAmount * 100);
}

async function createRefund({
  paymentIntentId = null,
  chargeId = null,
  amount = null,
  currency = "USD",
  metadata = {},
}) {
  if (!hasStripeSecret()) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }

  if (!paymentIntentId && !chargeId) {
    throw new Error("refund_payment_reference_required");
  }

  const params = {};
  if (paymentIntentId) params.payment_intent = paymentIntentId;
  if (chargeId) params.charge = chargeId;
  if (amount !== null && amount !== undefined) {
    params.amount = String(toStripeAmount(amount, currency));
  }

  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params[`metadata[${key}]`] = String(value);
  });

  return stripeRequest("/refunds", params);
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }

  if (!signatureHeader) {
    throw new Error("Missing Stripe-Signature header");
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((piece) => {
      const [key, value] = piece.split("=");
      return [key, value];
    })
  );

  const timestamp = parts.t;
  const expected = crypto
    .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  if (expected !== parts.v1) {
    throw new Error("Invalid Stripe signature");
  }

  return true;
}

module.exports = {
  createBillingPortalSession,
  createCheckoutSession,
  createRefund,
  ensureStripeCustomer,
  hasStripeConfig,
  hasStripeSecret,
  toStripeAmount,
  verifyStripeWebhook,
};
