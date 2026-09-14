// Provenance badge colors (design §3.2 accents). Single convention for
// every screen: benchmark is reference data (blue/information),
// collected is field reality (green/confirmed), synthetic is scaffolding
// the harness refuses for metrics (orange/attention). Unknown values
// fall back to muted rather than inventing a meaning.

const PROVENANCE_COLOR: Record<string, string> = {
  benchmark: "#668DBA",
  collected: "#4FAE79",
  synthetic: "#D89A45",
};

export function provenanceColor(value: string): string {
  return PROVENANCE_COLOR[value] ?? "#706E68";
}
