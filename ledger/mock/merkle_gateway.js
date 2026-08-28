const crypto = require('crypto');

class MerkleLedger {
  constructor() {
    this.entries = new Map();
    this.tree = new Map();
    this.roots = [];
  }

  _hash(obj) {
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  async health() {
    return true;
  }

  async anchor(docId, sha256, caseCode, sourceNode, badge) {
    if (this.entries.has('EVIDENCE_' + docId)) {
      throw new Error('evidence already anchored');
    }
    const txId = '0x' + crypto.randomBytes(16).toString('hex');
    const asset = { docType: 'evidence', docId, sha256, caseCode, sourceNode, officerBadge: badge, anchoredAt: new Date().toISOString() };
    this.entries.set('EVIDENCE_' + docId, asset);
    this.roots.push(this._hash(asset));
    return { txId, anchoredAt: asset.anchoredAt };
  }

  async action(actionId, action, objectType, objectId, payloadHash, badge) {
    const txId = '0x' + crypto.randomBytes(16).toString('hex');
    const asset = { docType: 'action', actionId, action, objectType, objectId, payloadHash, officerBadge: badge, at: new Date().toISOString() };
    this.entries.set('ACTION_' + actionId, asset);
    this.roots.push(this._hash(asset));
    return { txId };
  }

  async verify(docId, candidateSha) {
    const asset = this.entries.get('EVIDENCE_' + docId);
    if (!asset) return { match: false, onChain: false };
    return {
      match: asset.sha256.toLowerCase() === String(candidateSha).toLowerCase(),
      onChain: true,
      txId: '0x' + crypto.randomBytes(4).toString('hex'),
      anchoredAt: asset.anchoredAt,
    };
  }

  async history(key) {
    const asset = this.entries.get(key);
    return asset ? [asset] : [];
  }
}

module.exports = { MerkleLedger };
