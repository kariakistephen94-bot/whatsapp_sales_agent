import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionManager, validSessionId } from '../src/sessions.js';

class FakeClient extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.state = 'starting'; this.started = 0; this.sock = { end() {} }; }
  async start() { this.started++; this.state = 'qr'; }
  status() { return { state: this.state, connected: this.state === 'open' }; }
  async logout() { this.state = 'logged_out'; }
  async relink() { this.state = 'qr'; }
}
const make = async (extra = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gw-'));
  const created = [];
  const m = new SessionManager({ authRoot: root, clientFactory: (o) => { const c = new FakeClient(o); created.push(c); return c; }, ...extra });
  return { m, root, created };
};

test('session ids: safe characters only', () => {
  assert.ok(validSessionId('c8a19649-ed1b-4502-af93-ab110f05aae5'));
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'a b', 'x'.repeat(65), null, undefined, 5]) assert.equal(validSessionId(bad), false, String(bad));
});

test('path traversal is rejected before touching the disk', async () => {
  const { m } = await make();
  assert.throws(() => m.authDir('../evil'), /Invalid session id/);
  await assert.rejects(async () => m.ensure('../evil'), /Invalid session id/);
  await assert.rejects(() => m.remove('../evil'), /Invalid session id/);
});

test('each session gets its own auth folder', async () => {
  const { m, root, created } = await make();
  await m.ensure('a'); await m.ensure('b');
  assert.equal(created.length, 2);
  assert.equal(created[0].opts.authDir, path.join(root, 'a'));
  assert.equal(created[1].opts.authDir, path.join(root, 'b'));
});

test('starting the same session twice (even at once) opens one socket', async () => {
  const { m, created } = await make();
  const [x, y] = await Promise.all([m.ensure('a'), m.ensure('a')]);
  const z = await m.ensure('a');
  assert.equal(created.length, 1);
  assert.ok(x === y && y === z);
  assert.equal(created[0].started, 1);
});

test('incoming messages are tagged with the session they came from', async () => {
  const got = [];
  const { m, created } = await make({ onMessage: (id, msg) => got.push([id, msg.text]) });
  await m.ensure('a'); await m.ensure('b');
  created[0].emit('message', { text: 'for a' });
  created[1].emit('message', { text: 'for b' });
  assert.deepEqual(got, [['a', 'for a'], ['b', 'for b']]);
});

test('remove() unlinks and deletes only that session', async () => {
  const { m, root } = await make();
  await mkdir(path.join(root, 'a')); await writeFile(path.join(root, 'a', 'creds.json'), '{}');
  await mkdir(path.join(root, 'b')); await writeFile(path.join(root, 'b', 'creds.json'), '{}');
  await m.ensure('a'); await m.ensure('b');
  await m.remove('a');
  assert.equal(m.get('a'), null);
  assert.ok(m.get('b'));
  await assert.rejects(() => access(path.join(root, 'a')));
  await access(path.join(root, 'b', 'creds.json'));
});

test('a session the phone logged out restarts fresh instead of staying dead', async () => {
  const { m, created } = await make();
  const first = await m.ensure('a');
  first.state = 'logged_out';
  const again = await m.ensure('a');
  assert.notEqual(again, first);
  assert.equal(created.length, 2);
  assert.equal(again.state, 'qr');
});

test('stop() keeps the saved login; restoreAll() brings paired sessions back', async () => {
  const { m, root, created } = await make();
  await mkdir(path.join(root, 'paired')); await writeFile(path.join(root, 'paired', 'creds.json'), '{}');
  await mkdir(path.join(root, 'unpaired'));            // never scanned: not restored
  await mkdir(path.join(root, '.hidden bad name'));
  assert.equal(await m.restoreAll(), 1);
  assert.ok(m.get('paired') && !m.get('unpaired'));
  await m.stop('paired');
  assert.equal(m.get('paired'), null);
  await access(path.join(root, 'paired', 'creds.json')); // login kept
  assert.equal((await readdir(root)).length, 3);
  assert.equal(created.length, 1);
});

test('list() reports every session', async () => {
  const { m } = await make();
  await m.ensure('a'); await m.ensure('b');
  assert.deepEqual(m.list().map((s) => s.id).sort(), ['a', 'b']);
});
