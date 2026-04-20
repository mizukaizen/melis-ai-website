const { createClient } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token: rawToken, session_id: sessionId } = req.query;

  if (!rawToken && !sessionId) {
    return res.status(400).json({ error: 'Missing token or session_id' });
  }

  const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  let token = rawToken;

  // Resolve session_id → token if needed
  if (!token && sessionId) {
    token = await kv.get(`dl_session:${sessionId}`);
    if (!token) {
      return res.status(404).json({ error: 'Download link not found or expired' });
    }
  }

  const entry = await kv.get(`dl_token:${token}`);

  if (!entry) {
    return res.status(404).json({ error: 'Download link not found or expired' });
  }

  // Belt-and-suspenders expiry check (KV TTL should handle it, but be explicit)
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    return res.status(404).json({ error: 'Download link not found or expired' });
  }

  const envKey = `DOWNLOAD_${entry.product.toUpperCase().replace(/-/g, '_')}_BLOB_URL`;
  const downloadUrl = process.env[envKey];

  if (!downloadUrl) {
    console.error(`Missing env var: ${envKey}`);
    return res.status(500).json({ error: 'Download URL not configured' });
  }

  return res.status(200).json({
    product: entry.product,
    downloadUrl,
    email: entry.email,
  });
};
