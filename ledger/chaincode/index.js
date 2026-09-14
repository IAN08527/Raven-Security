'use strict';
// Thin `fabric-contract-api` binding over ./contract.js (M5-T2, D22).
// Chaincode internals are not visible to the server: the gateway speaks
// the five REST endpoints only (D13).

const { Contract } = require('fabric-contract-api');
const logic = require('./contract');

class RavenLedgerContract extends Contract {
  async anchor(ctx, docHash, caseId, actorLedgerId) {
    return JSON.stringify(await logic.anchor(ctx.stub, docHash, caseId, actorLedgerId));
  }

  async recordAction(ctx, actionType, payloadHash, objectId, caseId, actorLedgerId) {
    return JSON.stringify(
      await logic.recordAction(ctx.stub, actionType, payloadHash, objectId, caseId, actorLedgerId)
    );
  }

  async verifyEntry(ctx, docId) {
    return JSON.stringify(await logic.verify(ctx.stub, docId));
  }

  async historyOf(ctx, objectId) {
    return JSON.stringify(await logic.history(ctx.stub, objectId));
  }
}

module.exports.RavenLedgerContract = RavenLedgerContract;
module.exports.contracts = [RavenLedgerContract];
