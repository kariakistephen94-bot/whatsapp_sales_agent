import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhatsAppClient } from '../src/whatsapp.js';

test('relink forgets the saved session and starts a fresh pairing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wa-'));
  await writeFile(join(dir, 'creds.json'), '{}');
  const client = new WhatsAppClient({ authDir: dir });
  let loggedOut = false, started = 0;
  client.sock = { logout: async () => { loggedOut = true; }, end: () => {} };
  client.state = 'open';
  client.me = { id: '2348000000000:1@s.whatsapp.net' };
  client.start = async () => { started++; };
  await client.relink();
  assert.equal(loggedOut, true);
  assert.equal(started, 1);
  assert.equal(client.state, 'starting');
  assert.equal(client.me, null);
  assert.equal(client._stopping, false);
  await assert.rejects(access(join(dir, 'creds.json')));
});

test('a link-only account can never send and never reads messages', async () => {
  const client = new WhatsAppClient({ authDir: '/tmp/unused-demo', linkOnly: true });
  let sent = 0;
  client.state = 'open';
  client.sock = { sendMessage: async () => { sent++; return { key: { id: 'x' } }; } };
  await assert.rejects(client.sendText('2348000000000', 'hi'), { status: 403 });
  await assert.rejects(client.sendMedia('2348000000000', { base64: 'AA==', mimetype: 'image/png' }), { status: 403 });
  assert.throws(() => client._enqueue(async () => {}), { status: 403 });
  assert.equal(sent, 0);
});

test('a never-paired account stops cycling QR codes after the retry limit', async () => {
  const client = new WhatsAppClient({ authDir: '/tmp/unused-demo', linkOnly: true, pairingRetryLimit: 2 });
  assert.equal(client.pairingRetryLimit, 2);
  assert.equal(client._paired, false);
});
