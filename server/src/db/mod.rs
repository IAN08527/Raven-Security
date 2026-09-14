//! Postgres (source of truth) and Neo4j (derived projection) access.
//!
//! Only this server writes to Neo4j (D10); engine nodes hold read-only Bolt
//! credentials for topology queries only.
