const Stripe = require('stripe');

const PRICE_IDS = {
  bundle: process.env.STRIPE_BUNDLE_PRICE_ID,
  'prompt-kit': process.env.STRIPE_PROMPT_KIT_PRICE_ID,
};

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product } = req.body;

  if (!product || !PRICE_IDS[product]) {
    return res.status(400).json({ error: 'Invalid product key' });
  }

  const priceId = PRICE_IDS[product];
  if (!priceId) {
    return res.status(500).json({ error: 'Price ID not configured for this product' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://melis.ai/download?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://melis.ai',
      customer_email: undefined, // Stripe collects email at checkout
      billing_address_collection: 'auto',
      metadata: { product },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
