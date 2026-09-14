'use strict';
// Endorsement-policy tests (M5-T2, D22): AND('district-cid.member',
// 'cyber-cell.member') is satisfied by two real org signatures, by
// nothing less, and never by mock entries.

const test = require('node:test');
const assert = require('node:assert/strict');

const { POLICY, REQUIRED_ORGS, policySatisfied } = require('../policy');

test('policy names the two required orgs', () => {
  assert.equal(POLICY, "AND('district-cid.member', 'cyber-cell.member')");
  assert.deepEqual(REQUIRED_ORGS, ['district-cid', 'cyber-cell']);
});

test('two real org signatures satisfy the policy', () => {
  const result = policySatisfied([{ org: 'district-cid' }, { org: 'cyber-cell' }]);
  assert.equal(result.satisfied, true);
  assert.deepEqual(result.missing, []);
});

test('a single org does not satisfy the policy', () => {
  const result = policySatisfied([{ org: 'district-cid' }]);
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missing, ['cyber-cell']);
});

test('mock endorsements never count toward the real policy', () => {
  const result = policySatisfied([
    { org: 'mock', mode: 'mock' },
    { org: 'mock', mode: 'mock' },
  ]);
  assert.equal(result.satisfied, false);
  assert.deepEqual(result.missing, ['district-cid', 'cyber-cell']);
});

test('third org alone is insufficient without the required two', () => {
  const result = policySatisfied([{ org: 'records-bureau' }]);
  assert.equal(result.satisfied, false);
});
