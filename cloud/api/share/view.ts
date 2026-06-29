import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handlePreflight } from '../../lib/http';
import { getSharedResource } from '../../lib/db';

// GET /api/share/view?token=  -> a human-readable HTML page for a shared
// transcript. The opaque token IS the capability (no auth). This is the link
// the desktop "Share transcript" button hands out; share/get stays the JSON
// API the account portal uses. Every interpolated value is HTML-escaped: the
// payload is user-authored transcript text and this page renders on our origin.
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ROLE_LABEL: Record<string, string> = {
  user: 'User', assistant: 'Assistant', thinking: 'Thinking',
  tool_call: 'Tool', tool_result: 'Result', system: 'System',
};

function page(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#1a1a1a;color:#e8e8e8;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}
  h1{font-size:1.5rem;margin:0 0 4px}
  .meta{color:#888;font-size:.85rem;margin-bottom:32px}
  .msg{margin:0 0 24px}
  .role{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#9a9a9a;margin-bottom:6px}
  .body{white-space:pre-wrap;word-wrap:break-word;background:#222;border:1px solid #2e2e2e;border-radius:10px;padding:12px 14px}
  .role.user .body{}
  footer{color:#666;font-size:.78rem;margin-top:48px;text-align:center}
  a{color:#7aa2f7}
</style></head><body><div class="wrap">${bodyHtml}
<footer>Shared from <a href="https://freeswarm.myndlabs.tech">FreeSwarm</a></footer>
</div></body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  const token = String(req.query.token ?? '').trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!token) {
    res.status(400).send(page('Bad request', '<h1>Missing share token</h1>'));
    return;
  }
  const row = await getSharedResource(token);
  if (!row) {
    res.status(404).send(page('Not found', '<h1>This link has expired or was revoked.</h1>'));
    return;
  }

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const title = String(row.title || payload.name || 'Shared transcript');
  const model = payload.model ? `<span>Model: ${esc(payload.model)}</span>` : '';
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  const body = messages
    .map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      const role = String(mm.role ?? '');
      const text = String(mm.text ?? '').trim();
      if (!text) return '';
      return `<div class="msg"><div class="role ${esc(role)}">${esc(ROLE_LABEL[role] || role)}</div>` +
        `<div class="body">${esc(text)}</div></div>`;
    })
    .join('');

  const header = `<h1>${esc(title)}</h1><div class="meta">${model}</div>`;
  res.status(200).send(page(title, header + (body || '<div class="meta">This transcript is empty.</div>')));
}
