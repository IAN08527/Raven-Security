// ---------- constraints and indexes (run once at bootstrap) ----------
CREATE CONSTRAINT person_id IF NOT EXISTS
  FOR (p:Person) REQUIRE p.entity_id IS UNIQUE;
CREATE CONSTRAINT camera_code IF NOT EXISTS
  FOR (c:Camera) REQUIRE c.code IS UNIQUE;
CREATE INDEX person_case IF NOT EXISTS FOR (p:Person) ON (p.case_id);
CREATE INDEX link_weight IF NOT EXISTS
  FOR ()-[r:LINKED_TO]-() ON (r.weight);

// Ego graph, 2 hop, weight-floored (FR-3.1)
// MATCH path = (p:Person {entity_id: $id})-[r:LINKED_TO*1..2]-(n:Person)
// WHERE ALL(rel IN relationships(path) WHERE rel.weight >= $minWeight)
// RETURN path LIMIT 300;

// Macro view, top-N by weight (FR-3.2)
// MATCH (a:Person)-[r:LINKED_TO]->(b:Person)
// WHERE a.case_id = $caseId AND r.weight >= $minWeight
// RETURN a, r, b ORDER BY r.weight DESC LIMIT 1000;

// Key influencers via GDS (FR-4.1)
// CALL gds.graph.project('raven', 'Person',
//   {LINKED_TO: {orientation: 'UNDIRECTED', properties: 'weight'}});
// CALL gds.betweenness.stream('raven')
// YIELD nodeId, score
// RETURN gds.util.asNode(nodeId).entity_id AS entity_id, score
// ORDER BY score DESC LIMIT 10;

// Camera handoff prediction (D8)
// MATCH (:Camera {code: $from})-[r:LEADS_TO]->(next:Camera)
// RETURN next.code, r.mean_travel_s, r.stddev_s;

// Idempotent upsert used by the saga (D4)
// MERGE (a:Person {entity_id: $src})
//   ON CREATE SET a.name = $srcName, a.case_id = $caseId
// MERGE (b:Person {entity_id: $dst})
//   ON CREATE SET b.name = $dstName, b.case_id = $caseId
// MERGE (a)-[r:LINKED_TO {rel_id: $relId}]->(b)
//   SET r.weight = $weight, r.evidence_count = $ec, r.last_seen = $lastSeen;
