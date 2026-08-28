ENTITY_PROMPT = """You are an extraction engine for Indian police FIR documents.
Extract entities from the text and return strict JSON matching the schema:
{
  "entities": [{"type":"PERSON","name":"...","aliases":["..."],"role":"ACCUSED|VICTIM|WITNESS|COMPLAINANT","span":[start,end],"confidence":0.0}],
  "identifiers": [{"type":"PHONE|VEHICLE|ACCOUNT|IMEI","value":"...","belongs_to":"<entity name>","span":[start,end]}],
  "locations": [{"name":"...","span":[start,end]}],
  "incident": {"fir_number":"...","date":"YYYY-MM-DD","sections":["..."],"police_station":"..."}
}
Every span is a character offset into the text. Return only JSON."""

RELATION_PROMPT = """Given the entity list, extract relationships as strict JSON:
{"relations":[{"src":"...","dst":"...","type":"CO_ACCUSED|CALLED|TRANSFERRED_TO|RESIDES_WITH|SEEN_WITH","evidence_span":[start,end],"confidence":0.0}]}
Spans must reference offsets in the source text. Return only JSON."""
