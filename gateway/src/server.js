import express from 'express';
import { createInboundForwarder } from './inbound-webhook.js';
import crypto from 'node:crypto';
import fs, { existsSync } from 'node:fs';
import path, { join } from 'node:path';
import pino from 'pino';
import { SessionManager, validSessionId } from './sessions.js';
import { createStatusPipeline } from './status/index.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const API_KEY = process.env.API_KEY;
if (!API_KEY || API_KEY.length < 16) {
  console.error('Set API_KEY (min 16 chars) in the environment. See .env.example');
  process.exit(1);
}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
// A dropped network connection (ECONNRESET etc.) inside the WhatsApp library must not kill the gateway.
process.on('uncaughtException', (e) => { console.error('uncaught exception (continuing):', e?.cause?.code || e?.message || e); });
process.on('unhandledRejection', (e) => { console.error('unhandled rejection (continuing):', e?.cause?.code || e?.message || e); });

const forwardInbound = createInboundForwarder(process.env);

// Delivery/read status forwarding (STATUS_WEBHOOK_URL). Separate from the inbound WEBHOOK_URL path below.
let statusPipeline = null;
try {
  statusPipeline = createStatusPipeline({ env: process.env, logger });
} catch (e) {
  console.error(`Status forwarding misconfigured: ${e.message}`);
  process.exit(1);
}
if (statusPipeline) {
  statusPipeline.start();
} else {
  logger.info('STATUS_WEBHOOK_URL not set: delivery/read status forwarding is off');
}

// Keep the last 200 inbound messages in memory for GET /messages
const inbox = [];
// Replies must never be lost if the receiving app is down or restarting: failed deliveries are saved to disk
// (one JSON line each) and retried every 30 seconds until accepted.
const pendingFile = path.join(process.env.STATUS_DATA_DIR || './data', 'inbound-pending.jsonl');
function readPending() {
  try { return fs.readFileSync(pendingFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function writePending(list) {
  try {
    fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
    fs.writeFileSync(pendingFile, list.map((m) => JSON.stringify(m)).join('\n') + (list.length ? '\n' : ''));
  } catch (e) { logger.warn({ err: e.message }, 'could not save pending inbound messages'); }
}
let retrying = false;
async function retryPending() {
  if (!forwardInbound || retrying) return;
  retrying = true;
  try {
    const left = [];
    for (const m of readPending()) {
      try { await forwardInbound(m); } catch { left.push(m); }
    }
    writePending(left);
  } finally { retrying = false; }
}
if (forwardInbound) { setInterval(() => retryPending().catch(() => {}), 30_000).unref(); retryPending().catch(() => {}); }

async function handleInbound(sessionId, m) {
  const msg = { ...m, session: sessionId };
  inbox.push(msg);
  if (inbox.length > 200) inbox.shift();
  if (forwardInbound) {
    try {
      await forwardInbound(msg);
    } catch (e) {
      logger.warn({ err: e.message, session: sessionId }, 'inbound webhook delivery failed; will retry');
      writePending([...readPending(), msg]);
    }
  }
}

const sessions = new SessionManager({
  authRoot: process.env.AUTH_ROOT || process.env.AUTH_DIR || './auth_state',
  minSendIntervalMs: Number(process.env.MIN_SEND_INTERVAL_MS || 1500),
  statusPipeline,
  onMessage: (id, m) => { handleInbound(id, m).catch((e) => logger.error({ err: e.message }, 'inbound handling failed')); },
  logger,
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function auth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const key = bearer || req.headers['x-api-key'] || req.query.key || '';
  if (!key || !safeEqual(key, API_KEY)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(auth);

// ── Sessions: one per linked WhatsApp number ─────────────────────────────────────────────
function sessionId(req, _res, next) {
  if (!validSessionId(req.params.id)) return next(Object.assign(new Error('Invalid session id'), { status: 400 }));
  next();
}
function existing(req, res, next) {
  const wa = sessions.get(req.params.id);
  if (!wa) return res.status(404).json({ error: 'session not started', state: 'none' });
  req.wa = wa;
  next();
}

app.get('/sessions', (_req, res) => res.json({ sessions: sessions.list() }));

app.post('/sessions/:id/start', sessionId, async (req, res, next) => {
  try { res.json({ ok: true, ...(await sessions.ensure(req.params.id)).status() }); } catch (e) { next(e); }
});

app.post('/sessions/:id/stop', sessionId, async (req, res) => {
  res.json({ ok: true, stopped: await sessions.stop(req.params.id) });
});

app.get('/sessions/:id/status', sessionId, existing, (req, res) => res.json(req.wa.status()));

app.get('/sessions/:id/qr.json', sessionId, existing, (req, res) => res.json({ qr: req.wa.qr, dataUrl: req.wa.qrDataUrl }));

// Simple page that shows the pairing QR: /sessions/<id>/qr?key=YOUR_API_KEY
app.get('/sessions/:id/qr', sessionId, existing, (req, res) => {
  const wa = req.wa, s = wa.status();
  if (s.connected) return res.type('html').send('<h2>Already connected ✅</h2>');
  if (!wa.qrDataUrl) return res.type('html').send(`<meta http-equiv="refresh" content="2"><h3>Waiting for QR… (state: ${s.state})</h3>`);
  res.type('html').send(`<!doctype html><meta http-equiv="refresh" content="15">
    <body style="font-family:system-ui;text-align:center;padding:2rem">
    <h2>Scan with WhatsApp</h2>
    <p>Phone → Settings → Linked devices → Link a device</p>
    <img src="${wa.qrDataUrl}" alt="QR" /></body>`);
});

app.post('/sessions/:id/send', sessionId, existing, async (req, res, next) => {
  try {
    const { to, text, media } = req.body || {};
    if (!to) return res.status(400).json({ error: '"to" is required' });
    if (!text && !media) return res.status(400).json({ error: 'Provide "text" and/or "media"' });
    const result = media
      ? await req.wa.sendMedia(to, { ...media, caption: media.caption ?? text })
      : await req.wa.sendText(to, text);
    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

app.post('/sessions/:id/check', sessionId, existing, async (req, res, next) => {
  try {
    const { numbers } = req.body || {};
    if (!Array.isArray(numbers) || !numbers.length) return res.status(400).json({ error: '"numbers" array required' });
    res.json({ results: await req.wa.checkNumbers(numbers) });
  } catch (e) { next(e); }
});

app.post('/sessions/:id/relink', sessionId, async (req, res, next) => {
  try { res.json({ ok: true, ...(await sessions.relink(req.params.id)).status() }); } catch (e) { next(e); }
});

// Unlink from the phone and delete this session's saved login.
app.post('/sessions/:id/logout', sessionId, async (req, res) => {
  await sessions.remove(req.params.id);
  res.json({ ok: true });
});
app.delete('/sessions/:id', sessionId, async (req, res) => {
  await sessions.remove(req.params.id);
  res.json({ ok: true });
});

app.get('/messages', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ messages: inbox.slice(-limit) });
});

// Status-forwarding outbox: queue health, and re-queue of events that exhausted their retries.
app.get('/status-events', (_req, res) => {
  if (!statusPipeline) return res.json({ enabled: false });
  res.json({ enabled: true, ...statusPipeline.outbox.stats(), dead_events: statusPipeline.outbox.listDead() });
});

app.post('/status-events/retry-dead', (_req, res) => {
  if (!statusPipeline) return res.status(404).json({ error: 'status forwarding is not enabled' });
  res.json({ ok: true, requeued: statusPipeline.outbox.retryDead() });
});

app.use((err, _req, res, _next) => {
  const status = err.status || (/Invalid phone/.test(err.message) ? 400 : 500);
  if (status >= 500 && status !== 503) logger.error(err);
  res.status(status).json({ error: err.message });
});

const restored = await sessions.restoreAll();
logger.info({ restored }, 'WhatsApp sessions restored');
const server = app.listen(PORT, HOST, () => logger.info(`Gateway listening on http://${HOST}:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    setTimeout(() => process.exit(0), 8000).unref(); // hard stop if closing hangs
    server.close(() => sessions.stopAll().then(() => statusPipeline?.stop()).finally(() => process.exit(0)));
  });
}
