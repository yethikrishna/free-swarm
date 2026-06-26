// Outbound event delivery (F9 webhooks + F13 notification channels). When an
// event happens (e.g. a run completes, a transcript is shared) the relevant
// endpoint calls dispatchEvent(); we fan it out to every webhook and channel
// the user has registered for that event.
//
// Webhooks get an HMAC-SHA256 signature over the exact JSON body so receivers
// can verify authenticity (header: X-FreeSwarm-Signature: sha256=<hex>). Slack
// channels get Slack's incoming-webhook {text} shape. Email channels post to an
// optional relay (NOTIFY_EMAIL_WEBHOOK) since serverless has no SMTP.
//
// Delivery is awaited (not fire-and-forget) because a Vercel function may freeze
// after the response is sent; each target has a short timeout so one slow
// receiver can't stall the API. All failures are isolated per target.
import { createHmac } from 'crypto';
import { webhooksForEvent, channelsForEvent } from './db';

const TIMEOUT_MS = 4000;

export function signBody(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Slack incoming-webhook payload from a structured event.
export function slackText(event: string, payload: Record<string, unknown>): string {
  const title = payload.title ? `*${String(payload.title)}*` : `*${event}*`;
  const detail = payload.summary ?? payload.target ?? '';
  return detail ? `${title}\n${String(detail)}` : title;
}

async function postJson(url: string, body: string, headers: Record<string, string>): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface DispatchResult {
  webhooks: number;
  channels: number;
  delivered: number;
}

// Fan an event out to a user's webhooks + channels. Never throws; returns a
// count so callers can log/observe delivery without it affecting their response.
export async function dispatchEvent(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  let webhooks: Awaited<ReturnType<typeof webhooksForEvent>> = [];
  let channels: Awaited<ReturnType<typeof channelsForEvent>> = [];
  try {
    [webhooks, channels] = await Promise.all([
      webhooksForEvent(userId, event),
      channelsForEvent(userId, event),
    ]);
  } catch {
    return { webhooks: 0, channels: 0, delivered: 0 };
  }

  const emailRelay = process.env.NOTIFY_EMAIL_WEBHOOK;
  const envelope = JSON.stringify({ event, payload, ts: Date.now() });

  const jobs: Promise<boolean>[] = [];

  for (const w of webhooks) {
    jobs.push(postJson(w.url, envelope, { 'X-FreeSwarm-Signature': signBody(w.secret, envelope) }));
  }
  for (const c of channels) {
    if (c.kind === 'slack') {
      jobs.push(postJson(c.target, JSON.stringify({ text: slackText(event, payload) }), {}));
    } else if (c.kind === 'email' && emailRelay) {
      // Relay knows how to send mail; we just hand it the address + event.
      jobs.push(postJson(emailRelay, JSON.stringify({ to: c.target, event, payload }), {}));
    }
  }

  const results = await Promise.allSettled(jobs);
  const delivered = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  return { webhooks: webhooks.length, channels: channels.length, delivered };
}
