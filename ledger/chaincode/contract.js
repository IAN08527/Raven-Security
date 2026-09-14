'use strict';
// Raven evidence-anchor contract logic (M5-T2, D22, FR-7.1/FR-7.2).
//
// Pure functions over a minimal stub interface ({getState, putState,
// getTxID, getTxTimestamp, getCreatorMspId}) so the logic is unit-tested
// without a Fabric peer (see test/contract.test.js). `index.js` binds
// this to `fabric-contract-api`; the gateway never sees chaincode
// internals (D13) -- it speaks the five REST endpoints only.
//
// Endorsement recording: every write appends the submitting client's
// MSP id (creator org) to the entry's endorsements. The gateway submits
// through an AND('district-cid.member','cyber-cell.member') policy, so a
// committed entry carries at least two orgs; `verify` returns them and
// the UI renders real org names (never the mock badge, D22).

function docKey(docId) {
  return `DOC~${docId}`;
}

function indexKey(objectId) {
  return `IDX~${objectId}`;
}

function txKey(objectId, txId) {
  return `TX~${objectId}~${txId}`;
}

function nowIso(stub) {
  try {
    const ts = stub.getTxTimestamp();
    if (ts && typeof ts.seconds !== 'undefined') {
      const seconds = Number(ts.seconds.low !== undefined ? ts.seconds.low : ts.seconds);
      return new Date(seconds * 1000).toISOString();
    }
  } catch (_) {
    // fall through to wall clock: ledger timestamps are infrastructure
    // ordering aids, never case data (rule 3 carves out infra logging).
  }
  return new Date().toISOString();
}

async function readJson(stub, key) {
  const raw = await stub.getState(key);
  if (!raw || raw.length === 0) {
    return null;
  }
  return JSON.parse(raw.toString());
}

async function writeJson(stub, key, value) {
  await stub.putState(key, Buffer.from(JSON.stringify(value)));
}

/** POST /anchor equivalent: anchor(docHash, caseId, actorLedgerId). */
async function anchor(stub, docHash, caseId, actorLedgerId) {
  if (!docHash || !caseId || !actorLedgerId) {
    throw new Error('VALIDATION_FAILED: docHash, caseId and actorLedgerId are required');
  }
  const txId = stub.getTxID();
  const org = stub.getCreatorMspId();
  const ts = nowIso(stub);
  const key = docKey(docHash);
  const existing = await readJson(stub, key);
  const endorsements = existing && Array.isArray(existing.endorsements)
    ? existing.endorsements.slice()
    : [];
  if (!endorsements.some((e) => e.org === org)) {
    endorsements.push({ org, txId });
  }
  const entry = { txId, hash: docHash, ts, caseId, actorLedgerId, endorsements };
  await writeJson(stub, key, entry);
  await writeJson(stub, txKey(docHash, txId), { txId, hash: docHash, ts });
  await appendIndex(stub, docHash, txId);
  return { txId, ts };
}

/** POST /action equivalent: action(actionType, payloadHash, objectId, caseId, actorLedgerId). */
async function recordAction(stub, actionType, payloadHash, objectId, caseId, actorLedgerId) {
  if (!actionType || !payloadHash || !objectId || !caseId || !actorLedgerId) {
    throw new Error(
      'VALIDATION_FAILED: actionType, payloadHash, objectId, caseId and actorLedgerId are required'
    );
  }
  const txId = stub.getTxID();
  const org = stub.getCreatorMspId();
  const ts = nowIso(stub);
  const key = docKey(objectId);
  const existing = await readJson(stub, key);
  const endorsements = existing && Array.isArray(existing.endorsements)
    ? existing.endorsements.slice()
    : [];
  if (!endorsements.some((e) => e.org === org)) {
    endorsements.push({ org, txId });
  }
  const entry = {
    txId,
    hash: payloadHash,
    ts,
    caseId,
    actorLedgerId,
    actionType,
    endorsements,
  };
  await writeJson(stub, key, entry);
  await writeJson(stub, txKey(objectId, txId), { txId, hash: payloadHash, ts });
  await appendIndex(stub, objectId, txId);
  return { txId, ts };
}

/** GET /verify equivalent: verify(docId) -> {txId, hash, ts, endorsements[]}. */
async function verify(stub, docId) {
  const entry = await readJson(stub, docKey(docId));
  if (!entry) {
    const err = new Error(`NOT_FOUND: no ledger entry for ${docId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return {
    txId: entry.txId,
    hash: entry.hash,
    ts: entry.ts,
    endorsements: entry.endorsements || [],
  };
}

/** GET /history equivalent: history(objectId) -> ordered tx list. */
async function history(stub, objectId) {
  const index = (await readJson(stub, indexKey(objectId))) || [];
  const out = [];
  for (const txId of index) {
    const entry = await readJson(stub, txKey(objectId, txId));
    if (entry) {
      out.push({ txId: entry.txId, hash: entry.hash, ts: entry.ts });
    }
  }
  return out;
}

async function appendIndex(stub, objectId, txId) {
  const key = indexKey(objectId);
  const index = (await readJson(stub, key)) || [];
  if (!index.includes(txId)) {
    index.push(txId);
  }
  await writeJson(stub, key, index);
}

module.exports = { anchor, recordAction, verify, history, docKey, indexKey, txKey };
