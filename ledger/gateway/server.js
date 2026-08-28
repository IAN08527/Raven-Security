const express = require('express');
const crypto = require('crypto');
const { connectFabric } = require('./fabric_client');
const { MerkleLedger } = require('../mock/merkle_gateway');

const app = express();
app.use(express.json());

const PORT = process.env.LEDGER_PORT || 8801;
const MODE = process.env.LEDGER_MODE || 'fabric'; // 'fabric' | 'mock'

let backend = null;

async function init() {
  if (MODE === 'mock') {
    backend = new MerkleLedger();
    console.log('[gateway] LEDGER_MODE=mock (in-process Merkle log)');
  } else {
    try {
      backend = await connectFabric();
      console.log('[gateway] connected to Fabric channel ravenchannel');
    } catch (err) {
      console.error('[gateway] Fabric unreachable, falling back to mock:', err.message);
      backend = new MerkleLedger();
    }
  }
}

app.get('/health', async (_req, res) => {
  const healthy = backend && (await backend.health());
  res.json({ peer: healthy ? 'up' : 'down', channel: 'ravenchannel', chaincode: 'ravenledger' });
});

app.post('/ledger/anchor', async (req, res) => {
  const { docId, sha256, caseCode, sourceNode, badge } = req.body;
  if (!docId || !sha256) return res.status(400).json({ ok: false, code: 'BAD_REQUEST' });
  try {
    const r = await backend.anchor(docId, sha256, caseCode, sourceNode, badge);
    res.json({ txId: r.txId, anchoredAt: r.anchoredAt });
  } catch (e) {
    res.status(500).json({ ok: false, code: 'LEDGER_UNREACHABLE', message: e.message });
  }
});

app.post('/ledger/action', async (req, res) => {
  const { actionId, action, objectType, objectId, payloadHash, badge } = req.body;
  try {
    const r = await backend.action(actionId, action, objectType, objectId, payloadHash, badge);
    res.json({ txId: r.txId });
  } catch (e) {
    res.status(500).json({ ok: false, code: 'LEDGER_UNREACHABLE', message: e.message });
  }
});

app.get('/ledger/verify/:docId', async (req, res) => {
  const sha = req.query.sha;
  try {
    const r = await backend.verify(req.params.docId, sha);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, code: 'LEDGER_UNREACHABLE', message: e.message });
  }
});

app.get('/ledger/history/:key', async (req, res) => {
  try {
    const entries = await backend.history(req.params.key);
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ ok: false, code: 'LEDGER_UNREACHABLE', message: e.message });
  }
});

init().then(() => {
  app.listen(PORT, () => console.log(`[gateway] listening on :${PORT}`));
});

module.exports = app;
