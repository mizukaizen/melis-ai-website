const Stripe = require('stripe');
const { createClient } = require('@vercel/kv');
const { Resend } = require('resend');
const crypto = require('crypto');

const PRODUCT_NAMES = {
  bundle: 'The Complete Arsenal',
  'prompt-kit': 'Prompt Engineering Kit',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // req.body must be the raw buffer — Vercel provides it if you configure rawBody
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const customerEmail = session.customer_details?.email;
  const productKey = session.metadata?.product;
  const sessionId = session.id;

  if (!customerEmail || !productKey) {
    console.error('Missing email or product key in session', sessionId);
    return res.status(200).json({ received: true });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  // Store token → download record (7-day expiry)
  await kv.set(
    `dl_token:${token}`,
    { product: productKey, email: customerEmail, createdAt: now, expiresAt: now + sevenDays },
    { ex: 604800 }
  );

  // Store session → token (reverse lookup)
  await kv.set(`dl_session:${sessionId}`, token, { ex: 604800 });

  // Send delivery email
  const productName = PRODUCT_NAMES[productKey] || productKey;
  const downloadUrl = `https://melis.ai/download?token=${token}`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: customerEmail,
    subject: `Your ${productName} download is ready — melis.ai`,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 0; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #ffffff; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 48px 24px; }
    .label { font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: #6ee7b7; font-weight: 600; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; line-height: 1.2; margin: 0 0 16px; color: #ffffff; }
    p { font-size: 16px; line-height: 1.6; color: #a1a1aa; margin: 0 0 32px; }
    .btn { display: inline-block; background: #6ee7b7; color: #0a0a0a; text-decoration: none; font-weight: 700; font-size: 16px; padding: 14px 32px; border-radius: 8px; letter-spacing: 0.01em; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #27272a; font-size: 13px; color: #52525b; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="label">melis.ai</div>
    <h1>You're in. Here's your download.</h1>
    <p>Thanks for grabbing <strong style="color: #ffffff;">${productName}</strong>. Your download link is below — it's valid for 7 days.</p>
    <a href="${downloadUrl}" class="btn">Download ${productName} →</a>
    <div class="footer">
      Questions? Reply to this email. — Sean, melis.ai<br>
      <small style="color: #3f3f46;">Link expires 7 days from purchase.</small>
    </div>
  </div>
</body>
</html>`,
  });

  return res.status(200).json({ received: true });
};
