const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigin(origin) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname === 'monofield.vercel.app') return origin;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });
}

export default {
  async fetch(request) {
    const requestOrigin = request.headers.get('origin');
    const origin = allowedOrigin(requestOrigin);
    if (requestOrigin && !origin) return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, null);
    if (request.method === 'OPTIONS') return json({ ok: true }, 204, origin);
    if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, origin);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, code: 'INVALID_JSON' }, 400, origin);
    }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return json({ ok: false, code: 'INVALID_EMAIL' }, 400, origin);
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return json({ ok: false, code: 'NEWSLETTER_NOT_CONFIGURED' }, 503, origin);
    }
    const segmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID?.trim();
    const upstream = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
      }),
    });
    if (!upstream.ok) {
      // Never echo provider details: they may contain account metadata and are
      // not useful to the Desktop client.
      return json({ ok: false, code: 'NEWSLETTER_PROVIDER_FAILED' }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  },
};
