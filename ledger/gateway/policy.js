'use strict';
// Endorsement-policy evaluation (M5-T2, D22).
//
// The network policy is AND('district-cid.member', 'cyber-cell.member'):
// two of the three orgs must sign, so altering a record requires
// collusion across agencies. This module answers "does this endorsement
// set satisfy the policy" over org-name lists; the gateway calls it on
// the fabric path after collecting endorsements, and the UI treats an
// unsatisfied set as unverified rather than verified.

const POLICY = "AND('district-cid.member', 'cyber-cell.member')";
const REQUIRED_ORGS = ['district-cid', 'cyber-cell'];

/**
 * True when every org the policy requires appears in `endorsingOrgs`
 * (each at least once). Mock entries ({mode: 'mock'}) never satisfy a
 * real policy: a mock endorsement counted as real would be exactly the
 * misrepresentation D22 exists to avoid.
 */
function policySatisfied(endorsements) {
  const orgs = new Set(
    (endorsements || [])
      .filter((e) => e && e.mode !== 'mock' && typeof e.org === 'string')
      .map((e) => e.org)
  );
  const missing = REQUIRED_ORGS.filter((org) => !orgs.has(org));
  return { satisfied: missing.length === 0, missing };
}

module.exports = { POLICY, REQUIRED_ORGS, policySatisfied };
