"""Form-template field constraints (pipeline step 5, D18, FR-2.5).

FIRs are forms, not free prose: each registered field applies a
restricted charset plus a format validator, exactly as D18 specifies --
a date field gets a date charset and a format validator, an IPC-section
field gets a section-number validator, a phone field gets digits.
Free-text narrative stays unconstrained, and unrecognised layouts fall
back to unconstrained recognition rather than failing.

Two deliberate non-silent choices (rules 8/9): out-of-charset
characters are never stripped (that would silently delete evidence),
and every rejection carries a stated reason that routes the field to
the review queue beside its source crop.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, Field

DATE_CHARSET = set("0123456789/-. ")
DIGIT_CHARSET = set("0123456789")
SECTION_CHARSET = set("0123456789")

_DATE_RE = re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$")
_SECTION_RE = re.compile(r"^\d{1,3}$")
_PHONE_RE = re.compile(r"^\d{10}$")


class FieldSpecModel(BaseModel):
    """Pydantic boundary mirroring the baseline `form_templates.field_map`
    shape: [{field, bbox, charset, validator, required}]. `bbox` is
    fractions of page width/height [x, y, w, h], so one template serves
    both 200 and 300 DPI scans."""

    field: str = Field(min_length=1)
    bbox: list[float] = Field(min_length=4, max_length=4)
    charset: str = Field(min_length=1)
    validator: str = Field(min_length=1)
    required: bool = False


@dataclass(frozen=True)
class FieldSpec:
    field: str
    bbox: tuple[float, float, float, float]
    charset: str
    validator: str
    required: bool


@dataclass(frozen=True)
class ConstrainedResult:
    accepted: bool
    text: str
    constrained: bool  # False when no template/field matched (passthrough)
    reason: str | None  # stated cause when rejected; None when accepted


@dataclass(frozen=True)
class FormTemplate:
    name: str
    fields: list[FieldSpec]


def charset_for(name: str) -> set[str] | None:
    """Named charset, or None for `unconstrained` (free-text narrative)."""
    return {"date": DATE_CHARSET, "digits": DIGIT_CHARSET, "section": SECTION_CHARSET}.get(name)


def validate(validator: str, text: str) -> str | None:
    """Run the named format validator. Returns None when the text passes,
    or the stated failure reason when it does not."""
    stripped = text.strip()
    if validator == "none":
        return None
    if validator == "date":
        match = _DATE_RE.match(stripped)
        if match is None:
            return f"{text!r} is not a DD/MM/YYYY (or DD-MM-YYYY) date"
        day, month, _year = (int(part) for part in match.groups())
        if not 1 <= day <= 31 or not 1 <= month <= 12:
            return f"{text!r} has an impossible day or month"
        return None
    if validator == "section_number":
        if _SECTION_RE.match(stripped) is None:
            return f"{text!r} is not an IPC section number (1-3 digits)"
        return None
    if validator == "phone":
        if _PHONE_RE.match(stripped) is None:
            return f"{text!r} is not a 10-digit phone number"
        return None
    raise ValueError(f"unknown validator {validator!r}")


def apply_constraints(spec: FieldSpec, text: str) -> ConstrainedResult:
    """Charset first, then the format validator. Any failure rejects the
    field with its reason (routes to review); nothing is ever stripped or
    repaired silently."""
    allowed = charset_for(spec.charset)
    if allowed is not None:
        offenders = sorted({char for char in text if char not in allowed})
        if offenders:
            return ConstrainedResult(
                accepted=False,
                text=text,
                constrained=True,
                reason=f"character(s) {''.join(offenders)!r} outside the {spec.charset} charset",
            )
    failure = validate(spec.validator, text)
    if failure is not None:
        return ConstrainedResult(accepted=False, text=text, constrained=True, reason=failure)
    return ConstrainedResult(accepted=True, text=text, constrained=True, reason=None)


def load_template(path: str | Path) -> FormTemplate:
    """Load one field map from JSON. The file's `fields` entries follow
    the baseline `field_map` shape."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    models = [FieldSpecModel(**item) for item in data["fields"]]
    fields = [
        FieldSpec(
            field=model.field,
            bbox=(model.bbox[0], model.bbox[1], model.bbox[2], model.bbox[3]),
            charset=model.charset,
            validator=model.validator,
            required=model.required,
        )
        for model in models
    ]
    return FormTemplate(name=str(data["name"]), fields=fields)


def constrain_or_passthrough(
    template: FormTemplate | None, field_name: str | None, text: str
) -> ConstrainedResult:
    """D18 fallback: no template, or no matching field (including
    free-text lines with `field_name=None`), means unconstrained
    recognition -- accepted as-is, marked `constrained=False` so the
    review UI can show the difference honestly."""
    if template is None or field_name is None:
        return ConstrainedResult(accepted=True, text=text, constrained=False, reason=None)
    for spec in template.fields:
        if spec.field == field_name:
            return apply_constraints(spec, text)
    return ConstrainedResult(accepted=True, text=text, constrained=False, reason=None)
