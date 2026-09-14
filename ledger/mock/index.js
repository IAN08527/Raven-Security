'use strict';
// Mock ledger gateway (D13). Implements the same five endpoints as the real
// Fabric gateway (docs/API_CONTRACTS.md §5) as an in-process log, so the UI
// and server run without Docker/Fabric. `LEDGER_MODE=mock` is a one-flag
// swap; this is never the demonstrated configuration (D22).

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.LEDGER_MOCK_PORT ? Number(process.env.LEDGER_MOCK_PORT) : 8801;

// objectId/docHash -> ordered list of ledger entries.
const history = new Map();
let blockNo = 0;

function nowIso() {
  return new Date().toISOString();
}

function record(key, entry) {
  const list = history.get(key) || [];
  list.push(entry);
  history.set(key, list);
  return entry;
}

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
    error: {
      code,
      message,
      detail: {},
      retryable: false,
      trace_id: crypto.randomUUID(),
    },
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // GET /health -> {mode: fabric|mock, orgs[], peers[]}
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { mode: 'mock', orgs: ['mock-org'], peers: ['mock-peer'] });
    return;
  }

  // POST /anchor {docHash, caseId, actorLedgerId} -> {txId, blockNo, ts}
  if (req.method === 'POST' && url.pathname === '/anchor') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 422, errorEnvelope('VALIDATION_FAILED', 'body is not valid JSON'));
      return;
    }
    const { docHash, caseId, actorLedgerId } = body;
    if (!docHash || !caseId || !actorLedgerId) {
      sendJson(
        res,
        422,
        errorEnvelope('VALIDATION_FAILED', 'docHash, caseId and actorLedgerId are required')
      );
      return;
    }
    blockNo += 1;
    const entry = {
      txId: crypto.randomUUID(),
      blockNo,
      ts: nowIso(),
      hash: docHash,
      endorsements: [{ org: 'mock-org', mode: 'mock' }],
    };
    record(docHash, entry);
    sendJson(res, 200, { txId: entry.txId, blockNo: entry.blockNo, ts: entry.ts });
    return;
  }

  // POST /action {actionType, payloadHash, objectId, caseId, actorLedgerId} -> {txId, blockNo, ts}
  if (req.method === 'POST' && url.pathname === '/action') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 422, errorEnvelope('VALIDATION_FAILED', 'body is not valid JSON'));
      return;
    }
    const { actionType, payloadHash, objectId, caseId, actorLedgerId } = body;
    if (!actionType || !payloadHash || !objectId || !caseId || !actorLedgerId) {
      sendJson(
        res,
        422,
        errorEnvelope(
          'VALIDATION_FAILED',
          'actionType, payloadHash, objectId, caseId and actorLedgerId are required'
        )
      );
      return;
    }
    blockNo += 1;
    const entry = {
      txId: crypto.randomUUID(),
      blockNo,
      ts: nowIso(),
      hash: payloadHash,
      actionType,
      endorsements: [{ org: 'mock-org', mode: 'mock' }],
    };
    record(objectId, entry);
    sendJson(res, 200, { txId: entry.txId, blockNo: entry.blockNo, ts: entry.ts });
    return;
  }

  // GET /verify/{docId} -> {txId, hash, ts, endorsements[]}
  const verifyMatch = url.pathname.match(/^\/verify\/(.+)$/);
  if (req.method === 'GET' && verifyMatch) {
    const docId = decodeURIComponent(verifyMatch[1]);
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
    return;
  }

  // GET /history/{objectId} -> ordered tx list
  const historyMatch = url.pathname.match(/^\/history\/(.+)$/);
  if (req.method === 'GET' && historyMatch) {
    const objectId = decodeURIComponent(historyMatch[1]);
    const entries = history.get(objectId) || [];
    sendJson(
      res,
      200,
      entries.map((e) => ({ txId: e.txId, blockNo: e.blockNo, ts: e.ts, hash: e.hash }))
    );
    return;
  }

  sendJson(res, 404, errorEnvelope('NOT_FOUND', `no route for ${req.method} ${url.pathname}`));
});

server.listen(PORT, () => {
  console.log(`raven-ledger-mock listening on :${PORT} (mode: mock)`);
});
