import type { IncomingMessage, ServerResponse } from 'node:http';

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
      for await (const chunk of req) {
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

    const acceptsJson = (req.headers.accept || '').includes('application/json');
    if (acceptsJson) {
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
