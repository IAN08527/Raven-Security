'use strict';
// Chaincode contract-logic tests (M5-T2): fake stub, no peer required.
// anchor() returns a txId; verify() returns endorsements[] from every
// org that wrote; history() replays writes in order.

const test = require('node:test');
const assert = require('node:assert/strict');

const logic = require('../contract');

function fakeStub({ txId, mspId, store }) {
  const backing = store || new Map();
  return {
    getTxID: () => txId,
    getCreatorMspId: () => mspId,
    getTxTimestamp: () => {
      throw new Error('no tx timestamp on fake stub');
    },
    getState: async (key) => backing.get(key) || Buffer.from(''),
    putState: async (key, value) => {
      backing.set(key, Buffer.from(value));
    },
  };
}

test('anchor returns a txId and verify returns the hash with one endorsement', async () => {
  const stub = fakeStub({ txId: 'tx-1', mspId: 'district-cid' });
  const receipt = await logic.anchor(stub, 'hash-abc', 'case-1', 'officer-1');
  assert.equal(receipt.txId, 'tx-1');

  const entry = await logic.verify(stub, 'hash-abc');
  assert.equal(entry.txId, 'tx-1');
  assert.equal(entry.hash, 'hash-abc');
  assert.deepEqual(entry.endorsements, [{ org: 'district-cid', txId: 'tx-1' }]);
});

test('a second org writing the same doc appends its endorsement', async () => {
  const shared = new Map();
  const first = fakeStub({ txId: 'tx-1', mspId: 'district-cid', store: shared });
  const second = fakeStub({ txId: 'tx-2', mspId: 'cyber-cell', store: shared });

  await logic.anchor(first, 'hash-abc', 'case-1', 'officer-1');
  await logic.anchor(second, 'hash-abc', 'case-1', 'officer-2');

  const entry = await logic.verify(second, 'hash-abc');
  const orgs = entry.endorsements.map((e) => e.org).sort();
  assert.deepEqual(orgs, ['cyber-cell', 'district-cid']);
});

test('verify of an unknown doc fails with NOT_FOUND, never an empty entry', async () => {
  const stub = fakeStub({ txId: 'tx-9', mspId: 'district-cid' });
  await assert.rejects(logic.verify(stub, 'nope'), /NOT_FOUND/);
});

test('action records and history replays writes in order', async () => {
  const stub = fakeStub({ txId: 'tx-1', mspId: 'district-cid' });
  let txCounter = 1;
  stub.getTxID = () => `tx-${txCounter}`;
  await logic.recordAction(stub, 'candidate.confirm', 'h1', 'obj-1', 'case-1', 'officer-1');
  txCounter += 1;
  await logic.recordAction(stub, 'review.accept', 'h2', 'obj-1', 'case-1', 'officer-1');

  const entries = await logic.history(stub, 'obj-1');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].hash, 'h1');
  assert.equal(entries[1].hash, 'h2');

  const latest = await logic.verify(stub, 'obj-1');
  assert.equal(latest.hash, 'h2');
});

test('missing fields fail validation loudly', async () => {
  const stub = fakeStub({ txId: 'tx-1', mspId: 'district-cid' });
  await assert.rejects(logic.anchor(stub, '', 'case-1', 'officer-1'), /VALIDATION_FAILED/);
  await assert.rejects(
    logic.recordAction(stub, '', 'h', 'o', 'c', 'a'),
    /VALIDATION_FAILED/
  );
});
