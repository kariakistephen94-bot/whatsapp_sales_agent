import { readdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { WhatsAppClient } from './whatsapp.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const validSessionId = (id) => typeof id === 'string' && ID_RE.test(id);

/**
 * Many independent WhatsApp sessions in one gateway process. A session is one linked number, identified by an id
 * chosen by the caller (the app uses its connection id). Each has its own auth folder under authRoot, so sessions
 * can never read or overwrite each other's keys.
 */
export class SessionManager {
  constructor({ authRoot, minSendIntervalMs = 1500, statusPipeline = null, onMessage, logger, clientFactory }) {
    this.authRoot = path.resolve(authRoot);
    this.minSendIntervalMs = minSendIntervalMs;
    this.statusPipeline = statusPipeline;
    this.onMessage = onMessage;
    this.log = logger;
    this.makeClient = clientFactory || ((opts) => new WhatsAppClient(opts));
    this.clients = new Map();   // id -> WhatsAppClient
    this.starting = new Map();  // id -> Promise<WhatsAppClient> (so two simultaneous "start" calls share one socket)
  }

  authDir(id) {
    if (!validSessionId(id)) throw Object.assign(new Error('Invalid session id'), { status: 400 });
    const dir = path.join(this.authRoot, id);
    if (path.dirname(dir) !== this.authRoot) throw Object.assign(new Error('Invalid session id'), { status: 400 });
    return dir;
  }

  get(id) { return this.clients.get(id) ?? null; }

  /** Start (or return) the session. Idempotent. */
  ensure(id) {
    const dir = this.authDir(id);
    const have = this.clients.get(id);
    // A session the phone unlinked (or one we closed) is dead: start over with a fresh QR instead of returning it.
    if (have && (have.state === 'logged_out' || have.state === 'closed')) {
      const p = this.remove(id).then(() => this.ensure(id));
      return p;
    }
    if (have) return Promise.resolve(have);
    const pending = this.starting.get(id);
    if (pending) return pending;
    const p = (async () => {
      const wa = this.makeClient({ authDir: dir, minSendIntervalMs: this.minSendIntervalMs });
      wa.sessionId = id;
      this.statusPipeline?.attach(wa);
      wa.on('message', (m) => this.onMessage?.(id, m));
      this.clients.set(id, wa);
      try { await wa.start(); } catch (e) { this.clients.delete(id); throw e; }
      return wa;
    })().finally(() => this.starting.delete(id));
    this.starting.set(id, p);
    return p;
  }

  /** Disconnect but keep the saved login, so ensure() reconnects without a new QR. */
  async stop(id) {
    const wa = this.clients.get(id);
    if (!wa) return false;
    wa._stopping = true;
    try { wa.sock?.end(undefined); } catch { /* already closed */ }
    wa.state = 'closed';
    this.clients.delete(id);
    return true;
  }

  /** Unlink from the phone and delete the saved login. */
  async remove(id) {
    const dir = this.authDir(id);
    const wa = this.clients.get(id);
    if (wa) {
      await wa.logout().catch(() => {});
      try { wa.sock?.end(undefined); } catch { /* already closed */ }
      this.clients.delete(id);
    }
    await rm(dir, { recursive: true, force: true });
    return true;
  }

  async relink(id) {
    const wa = await this.ensure(id);
    await wa.relink();
    return wa;
  }

  list() {
    return [...this.clients].map(([id, wa]) => ({ id, ...wa.status() }));
  }

  /** On boot: bring back every session that was already paired. */
  async restoreAll() {
    let names = [];
    try { names = await readdir(this.authRoot, { withFileTypes: true }); } catch { return 0; }
    let n = 0;
    for (const d of names) {
      if (!d.isDirectory() || !validSessionId(d.name)) continue;
      try { await access(path.join(this.authRoot, d.name, 'creds.json')); } catch { continue; }
      try { await this.ensure(d.name); n++; } catch (e) { this.log?.error({ err: e.message, session: d.name }, 'could not restore session'); }
    }
    return n;
  }

  /** Graceful stop of every socket (Baileys flushes its keys as it closes). */
  async stopAll() {
    await Promise.allSettled([...this.clients.keys()].map((id) => this.stop(id)));
  }
}
