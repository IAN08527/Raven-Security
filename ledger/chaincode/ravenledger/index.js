const { Contract, Context } = require('fabric-contract-api');

class RavenContext extends Context {}

class RavenLedger extends Contract {
  constructor() {
    super('ravenledger');
  }

  createContext() {
    return new RavenContext();
  }

  async AnchorEvidence(ctx, docId, sha256, caseCode, sourceNode, badge) {
    const key = ctx.stub.createCompositeKey('EVIDENCE', [docId]);
    const existing = await ctx.stub.getState(key);
    if (existing && existing.length > 0) {
      throw new Error(`evidence ${docId} already anchored (immutable)`);
    }
    const asset = {
      docType: 'evidence',
      docId,
      sha256,
      caseCode,
      sourceNode,
      officerBadge: badge,
      anchoredAt: new Date().toISOString(),
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
    return JSON.stringify(asset);
  }

  async LogAction(ctx, actionId, action, objectType, objectId, payloadHash, badge) {
    const key = ctx.stub.createCompositeKey('ACTION', [actionId]);
    const asset = {
      docType: 'action',
      actionId,
      action,
      objectType,
      objectId,
      payloadHash,
      officerBadge: badge,
      at: new Date().toISOString(),
    };
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(asset)));
    return JSON.stringify(asset);
  }

  async VerifyHash(ctx, docId, candidateSha) {
    const key = ctx.stub.createCompositeKey('EVIDENCE', [docId]);
    const data = await ctx.stub.getState(key);
    if (!data || data.length === 0) {
      return JSON.stringify({ match: false, onChain: false });
    }
    const asset = JSON.parse(data.toString());
    return JSON.stringify({
      match: asset.sha256.toLowerCase() === candidateSha.toLowerCase(),
      onChain: true,
      txId: ctx.stub.getTxID(),
      anchoredAt: asset.anchoredAt,
    });
  }

  async GetEvidence(ctx, docId) {
    const key = ctx.stub.createCompositeKey('EVIDENCE', [docId]);
    const data = await ctx.stub.getState(key);
    if (!data || data.length === 0) return '';
    return data.toString();
  }

  async GetHistoryForKey(ctx, docId) {
    const key = ctx.stub.createCompositeKey('EVIDENCE', [docId]);
    const it = ctx.stub.getHistoryForKey(key);
    const entries = [];
    while (true) {
      const res = await it.next();
      if (res.value && res.value.value) {
        entries.push(JSON.parse(res.value.value.toString()));
      }
      if (res.done) break;
    }
    return JSON.stringify(entries);
  }
}

module.exports = { RavenLedger, RavenContext };
