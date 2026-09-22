import type { IncomingMessage, ServerResponse } from 'node:http';

/** A form post, not an upload: anything larger is refused unread. */
const MAX_BODY = 16 * 1024;
const MAX_FIELD = 4000;

interface EnquiryPayload {
  name?: string;
  phone?: string;
  email?: string;
  projectType?: string;
  message?: string;
  botField?: string;
}

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse,
) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  try {
    let body = req.body;
    if (!body || typeof body !== 'object') {
      const buffers: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
          res.statusCode = 413;
          res.end();
          return;
        }
        buffers.push(chunk);
      }
      const raw = Buffer.concat(buffers).toString('utf-8');
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        body = JSON.parse(raw || '{}');
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw);
        body = Object.fromEntries(params.entries());
      } else {
        body = {};
      }
    }

    const payload: EnquiryPayload = {
      name: body.name,
      phone: body.phone,
      email: body.email,
      projectType: body.projectType,
      message: body.message,
      botField: body['bot-field'],
    };

    const wantsJson = (req.headers.accept || '').includes('application/json');

    // Every field the form marks required, and nothing longer than a form can
    // sensibly hold. An invalid post is answered, not stored.
    const missing = (['name', 'phone', 'message'] as const).filter((k) => !payload[k]?.trim());
    const tooLong = Object.values(payload).some((v) => typeof v === 'string' && v.length > MAX_FIELD);
    if (missing.length || tooLong) {
      if (wantsJson) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: missing.length ? `Missing: ${missing.join(', ')}` : 'Field too long' }));
        return;
      }
      res.statusCode = 303;
      res.setHeader('Location', '/#contact');
      res.end();
      return;
    }

    // Bot honeypot check
    if (payload.botField) {
      console.warn('[Enquiry] Bot detected via honeypot field');
      res.statusCode = 303;
      res.setHeader('Location', '/thank-you');
      res.end();
      return;
    }

    // Log enquiry details to Vercel runtime logs
    console.log('[Enquiry Submitted]', {
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      projectType: payload.projectType,
      message: payload.message,
      receivedAt: new Date().toISOString(),
    });

    if (wantsJson) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Enquiry received successfully' }));
      return;
    }

    // Redirect to the thank-you page
    res.statusCode = 303;
    res.setHeader('Location', '/thank-you');
    res.end();
  } catch (err: any) {
    console.error('[Enquiry Error]', err);
    res.statusCode = 303;
    res.setHeader('Location', '/thank-you?status=received');
    res.end();
  }
}
