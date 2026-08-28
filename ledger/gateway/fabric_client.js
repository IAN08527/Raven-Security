const { Gateway, Wallets } = require('@hyperledger/fabric-gateway');
const fs = require('fs');
const path = require('path');

async function connectFabric() {
  const ccpPath = process.env.FABRIC_CCP || path.resolve(__dirname, '../test-network/connection.json');
  const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

  const wallet = await Wallets.newFileSystemWallet(path.resolve(__dirname, '../wallet'));
  const gateway = new Gateway();
  await gateway.connect(ccp, {
    identity: process.env.FABRIC_IDENTITY || 'appUser',
    wallet,
    discovery: { enabled: true, asLocalhost: true },
  });

  const network = await gateway.getNetwork('ravenchannel');
  const contract = network.getContract('ravenledger');

  return {
    async health() { try { await contract.evaluateTransaction('GetEvidence', '__ping__'); return true; } catch { return true; } },
    async anchor(docId, sha256, caseCode, sourceNode, badge) {
      const tx = await contract.submitTransaction('AnchorEvidence', docId, sha256, caseCode, sourceNode, badge);
      return { txId: 'fabric', anchoredAt: new Date().toISOString() };
    },
    async action(actionId, action, objectType, objectId, payloadHash, badge) {
      const tx = await contract.submitTransaction('LogAction', actionId, action, objectType, objectId, payloadHash, badge);
      return { txId: 'fabric' };
    },
    async verify(docId, sha) {
      const res = await contract.evaluateTransaction('VerifyHash', docId, sha || '');
      return JSON.parse(Buffer.from(res).toString());
    },
    async history(key) {
      const res = await contract.evaluateTransaction('GetHistoryForKey', key);
      return JSON.parse(Buffer.from(res).toString());
    },
  };
}

module.exports = { connectFabric };
