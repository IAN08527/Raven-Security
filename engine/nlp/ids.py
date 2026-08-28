"""Stable, deterministic id generation for extracted entities/relations.

Entity ids are derived from ``(type, normalized name)`` so the same person
mentioned across two documents collapses to one UUID (a cheap form of entity
resolution, §5.3 priority #4). Relation ids are derived from their endpoints +
type, so re-ingesting the same document is idempotent (ON CONFLICT upsert).
"""
import uuid

_NS = uuid.UUID("f0e1d2c3-4567-89ab-cdef-0123456789ab")


def entity_id(etype: str, name: str) -> str:
    key = f"E|{etype.strip().upper()}|{name.strip().lower()}"
    return str(uuid.uuid5(_NS, key))


def identifier_id(entity_uuid: str, itype: str, value: str) -> str:
    key = f"I|{entity_uuid}|{itype.strip().upper()}|{value.strip()}"
    return str(uuid.uuid5(_NS, key))


def relation_id(src: str, dst: str, rtype: str) -> str:
    key = f"R|{src}|{dst}|{rtype.strip().upper()}"
    return str(uuid.uuid5(_NS, key))
