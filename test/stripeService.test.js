const test = require("node:test");
const assert = require("node:assert/strict");

const { createRefund, toStripeAmount } = require("../src/services/stripeService");

test("toStripeAmount converts decimal and zero-decimal currencies correctly", () => {
  assert.equal(toStripeAmount(4.99, "USD"), 499);
  assert.equal(toStripeAmount(500, "JPY"), 500);
});

test("createRefund sends Stripe refund request with payment intent metadata", async () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.STRIPE_SECRET_KEY;

  process.env.STRIPE_SECRET_KEY = "sk_test_unit";

  let request = null;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return { id: "re_test_123", status: "succeeded" };
      },
    };
  };

  try {
    const refund = await createRefund({
      paymentIntentId: "pi_123",
      amount: 4.99,
      currency: "USD",
      metadata: {
        refund_request_id: 12,
        user_id: 7,
      },
    });

    assert.equal(refund.id, "re_test_123");
    assert.equal(request.url, "https://api.stripe.com/v1/refunds");
    assert.equal(request.options.method, "POST");
    assert.match(String(request.options.body), /payment_intent=pi_123/);
    assert.match(String(request.options.body), /amount=499/);
    assert.match(String(request.options.body), /metadata%5Brefund_request_id%5D=12/);
    assert.match(String(request.options.body), /metadata%5Buser_id%5D=7/);
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecret;
    }
  }
});
