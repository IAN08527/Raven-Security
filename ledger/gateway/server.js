'use strict';
// Raven ledger gateway (M5-T2, D13/D22): the five REST endpoints of
// docs/API_CONTRACTS.md section 5.
//
//   POST /anchor          {docHash, caseId, actorLedgerId}     -> {txId, blockNo, ts}
//   POST /action          {actionType, payloadHash, objectId,
//                           caseId, actorLedgerId}              -> {txId, blockNo, ts}
//   GET  /verify/{docId}                                       -> {txId, hash, ts, endorsements[]}
//   GET  /history/{objectId}                                   -> ordered tx list
//   GET  /health                                               -> {mode: fabric|mock, orgs[], peers[]}
//
// LEDGER_MODE=mock (default): in-process log for development, identical
// interface, endorsements [{org:'mock', mode:'mock'}]. The UI must render
// these differently from real org signatures (D22); this mode is never
// the demonstrated configuration.
//
// LEDGER_MODE=fabric: submits/evaluates against the multi-org network in
// infra/fabric/ via the fabric-network SDK (lazy-required, so mock mode
// and tests never need it installed). Endorsements come from the
// chaincode-recorded creator orgs of the committed entry; the gateway
// additionally checks them against the AND policy and exposes the
// result. A missing SDK or unreachable peers fail LOUD
// (LEDGER_UNAVAILABLE) -- a fabric-mode gateway that quietly falls back
// to mock would forge the exact trust it exists to provide.

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const { policySatisfied, POLICY } = require('./policy');

const MODE = process.env.LEDGER_MODE === 'fabric' ? 'fabric' : 'mock';
const PORT = process.env.LEDGER_GATEWAY_PORT
  ? Number(process.env.LEDGER_GATEWAY_PORT)
  : 8801;
const CHANNEL = process.env.LEDGER_CHANNEL || 'ravenchannel';
const CHAINCODE = process.env.LEDGER_CHAINCODE || 'ravenledger';

// ---- mock store (dev only; ledger/mock/index.js is the standalone twin
// and stays unchanged) ----
const history = new Map();
let blockNo = 0;

function nowIso() {
  return new Date().toISOString();
}

function mockRecord(key, entry) {
  const list = history.get(key) || [];
  list.push(entry);
  history.set(key, list);
  return entry;
}

function mockAnchor({ docHash, caseId, actorLedgerId }) {
  blockNo += 1;
  return mockRecord(docHash, {
    txId: crypto.randomUUID(),
    blockNo,
    ts: nowIso(),
    hash: docHash,
    caseId,
    actorLedgerId,
    endorsements: [{ org: 'mock', mode: 'mock' }],
  });
}

function mockAction({ actionType, payloadHash, objectId, caseId, actorLedgerId }) {
  blockNo += 1;
  return mockRecord(objectId, {
    txId: crypto.randomUUID(),
    blockNo,
    ts: nowIso(),
    hash: payloadHash,
    actionType,
    caseId,
    actorLedgerId,
    endorsements: [{ org: 'mock', mode: 'mock' }],
  });
}

// ---- fabric backend (lazy SDK, fail loud without it) ----
let fabricGateway = null;

async function fabricContract() {
  let fabricNetwork;
  try {
    // Lazy: mock mode and unit tests must not require the SDK installed.
    // eslint-disable-next-line global-require
    fabricNetwork = require('fabric-network');
  } catch (err) {
    throw Object.assign(
      new Error(
        'LEDGER_UNAVAILABLE: LEDGER_MODE=fabric but the fabric-network SDK is not installed (run `npm install` in ledger/gateway)'
      ),
      { code: 'LEDGER_UNAVAILABLE' }
    );
  }
  if (!fabricGateway) {
    const ccpPath = process.env.FABRIC_CCP || './connection.json';
    const walletPath = process.env.FABRIC_WALLET || './wallet';
    const identity = process.env.LEDGER_IDENTITY || 'gateway-admin';
    const ccp = require(ccpPath);
    const wallet = await fabricNetwork.Wallets.newFileSystemWallet(walletPath);
    const gateway = new fabricNetwork.Gateway();
    await gateway.connect(ccp, {
      wallet,
      identity,
      discovery: { enabled: true, asLocalhost: process.env.FABRIC_AS_LOCALHOST !== '0' },
    });
    fabricGateway = gateway;
  }
  const network = await fabricGateway.getNetwork(CHANNEL);
  return network.getContract(CHAINCODE);
}

async function fabricAnchor(body) {
  const contract = await fabricContract();
  const raw = await contract.submitTransaction(
    'anchor',
    body.docHash,
    body.caseId,
    body.actorLedgerId
  );
  const receipt = JSON.parse(raw.toString());
  const entry = await fabricVerify(body.docHash);
  return { ...receipt, endorsements: entry.endorsements };
}

async function fabricAction(body) {
  const contract = await fabricContract();
  const raw = await contract.submitTransaction(
    'recordAction',
    body.actionType,
    body.payloadHash,
    body.objectId,
    body.caseId,
    body.actorLedgerId
  );
  const receipt = JSON.parse(raw.toString());
  const entry = await fabricVerify(body.objectId);
  return { ...receipt, endorsements: entry.endorsements };
}

async function fabricVerify(docId) {
  const contract = await fabricContract();
  const raw = await contract.evaluateTransaction('verifyEntry', docId);
  const entry = JSON.parse(raw.toString());
  const policy = policySatisfied(entry.endorsements);
  return { ...entry, policy: POLICY, policySatisfied: policy.satisfied };
}

async function fabricHistory(objectId) {
  const contract = await fabricContract();
  const raw = await contract.evaluateTransaction('historyOf', objectId);
  return JSON.parse(raw.toString());
}

// ---- HTTP plumbing (error envelope per API_CONTRACTS.md section 1.1) ----
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function errorEnvelope(code, message) {
  return {
    error: { code, message, detail: {}, retryable: false, trace_id: crypto.randomUUID() },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function missing(fields, body) {
  return fields.filter((field) => !body[field]);
}

function createServer(mode) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      if (mode === 'fabric') {
        sendJson(res, 200, {
          mode: 'fabric',
          orgs: ['district-cid', 'cyber-cell', 'records-bureau'],
          peers: [
            'peer0.district-cid.raven.local',
            'peer0.cyber-cell.raven.local',
            'peer0.records-bureau.raven.local',
          ],
          policy: POLICY,
        });
      } else {
        sendJson(res, 200, { mode: 'mock', orgs: ['mock'], peers: ['mock-peer'] });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/anchor') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 422, errorEnvelope('VALIDATION_FAILED', 'body is not valid JSON'));
        return;
      }
      const absent = missing(['docHash', 'caseId', 'actorLedgerId'], body);
      if (absent.length > 0) {
        sendJson(
          res,
          422,
          errorEnvelope('VALIDATION_FAILED', `missing fields: ${absent.join(', ')}`)
        );
        return;
      }
      try {
        const receipt =
          mode === 'fabric' ? await fabricAnchor(body) : mockAnchor(body);
        sendJson(res, 200, { txId: receipt.txId, blockNo: receipt.blockNo, ts: receipt.ts });
      } catch (err) {
        sendJson(
          res,
          502,
          errorEnvelope(err.code || 'LEDGER_UNAVAILABLE', err.message)
        );
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 422, errorEnvelope('VALIDATION_FAILED', 'body is not valid JSON'));
        return;
      }
      const absent = missing(
        ['actionType', 'payloadHash', 'objectId', 'caseId', 'actorLedgerId'],
        body
      );
      if (absent.length > 0) {
        sendJson(
          res,
          422,
          errorEnvelope('VALIDATION_FAILED', `missing fields: ${absent.join(', ')}`)
        );
        return;
      }
      try {
        const receipt =
          mode === 'fabric' ? await fabricAction(body) : mockAction(body);
        sendJson(res, 200, { txId: receipt.txId, blockNo: receipt.blockNo, ts: receipt.ts });
      } catch (err) {
        sendJson(
          res,
          502,
          errorEnvelope(err.code || 'LEDGER_UNAVAILABLE', err.message)
        );
      }
      return;
    }

    const verifyMatch = url.pathname.match(/^\/verify\/(.+)$/);
    if (req.method === 'GET' && verifyMatch) {
      const docId = decodeURIComponent(verifyMatch[1]);
      try {
        if (mode === 'fabric') {
          sendJson(res, 200, await fabricVerify(docId));
          return;
        }
        const entries = history.get(docId);
        if (!entries || entries.length === 0) {
          sendJson(res, 404, errorEnvelope('NOT_FOUND', `no ledger entry for ${docId}`));
          return;
        }
        const latest = entries[entries.length - 1];
        sendJson(res, 200, {
          txId: latest.txId,
          hash: latest.hash,
          ts: latest.ts,
          endorsements: latest.endorsements,
        });
      } catch (err) {
        sendJson(
          res,
          502,
          errorEnvelope(err.code || 'LEDGER_UNAVAILABLE', err.message)
        );
      }
      return;
    }

    const historyMatch = url.pathname.match(/^\/history\/(.+)$/);
    if (req.method === 'GET' && historyMatch) {
      const objectId = decodeURIComponent(historyMatch[1]);
      try {
        if (mode === 'fabric') {
          sendJson(res, 200, await fabricHistory(objectId));
          return;
        }
        const entries = history.get(objectId) || [];
        sendJson(
          res,
          200,
          entries.map((e) => ({ txId: e.txId, blockNo: e.blockNo, ts: e.ts, hash: e.hash }))
        );
      } catch (err) {
        sendJson(
          res,
          502,
          errorEnvelope(err.code || 'LEDGER_UNAVAILABLE', err.message)
        );
      }
      return;
    }

    sendJson(res, 404, errorEnvelope('NOT_FOUND', `no route for ${req.method} ${url.pathname}`));
  });
}

if (require.main === module) {
  createServer(MODE).listen(PORT, () => {
    console.log(`raven-ledger-gateway listening on :${PORT} (mode: ${MODE})`);
  });
}

module.exports = { createServer, POLICY };
