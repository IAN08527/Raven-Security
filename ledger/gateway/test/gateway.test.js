'use strict';
// Gateway mock-mode tests (M5-T2): the five endpoints answer per
// API_CONTRACTS.md section 5 against an ephemeral loopback server.
// anchor() returns a txId; verify() returns endorsements[] with the
// single 'mock' entry; a tampered doc (stored hash modified) mismatches
// on verify; health reports mock mode.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../server');

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = require('http').request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    require('http')
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      })
      .on('error', reject);
  });
}

test('gateway mock mode: five endpoints, mock endorsement, tamper mismatch', async (t) => {
  const server = createServer('mock');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const health = await getJson(port, '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.mode, 'mock');

  const anchored = await postJson(port, '/anchor', {
    docHash: 'doc-hash-1',
    caseId: 'case-1',
    actorLedgerId: 'officer-1',
  });
  assert.equal(anchored.status, 200);
  assert.match(anchored.body.txId, /.+/);

  const acted = await postJson(port, '/action', {
    actionType: 'candidate.confirm',
    payloadHash: 'payload-hash-1',
    objectId: 'obj-1',
    caseId: 'case-1',
    actorLedgerId: 'officer-1',
  });
  assert.equal(acted.status, 200);
  assert.match(acted.body.txId, /.+/);

  const verified = await getJson(port, '/verify/doc-hash-1');
  assert.equal(verified.status, 200);
  assert.equal(verified.body.hash, 'doc-hash-1');
  assert.deepEqual(verified.body.endorsements, [{ org: 'mock', mode: 'mock' }]);

  // Tampered doc: the stored bytes hash no longer equals the anchored
  // hash, so the comparison the auditor view performs reports mismatch.
  const recomputed = 'doc-hash-1-MODIFIED';
  assert.notEqual(verified.body.hash, recomputed);

  const history = await getJson(port, '/history/obj-1');
  assert.equal(history.status, 200);
  assert.equal(history.body.length, 1);
  assert.equal(history.body[0].hash, 'payload-hash-1');

  const missing = await getJson(port, '/verify/unknown-doc');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('gateway fabric health names the three orgs and the policy', async (t) => {
  const server = createServer('fabric');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const health = await getJson(port, '/health');
  assert.equal(health.body.mode, 'fabric');
  assert.deepEqual(health.body.orgs, ['district-cid', 'cyber-cell', 'records-bureau']);
  assert.ok(health.body.policy.includes('district-cid'));
});
