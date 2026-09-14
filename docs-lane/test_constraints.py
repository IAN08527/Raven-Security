"""M3-4. D18 constraint tests: validators accept/reject honestly, charset
violations are never stripped, unknown layouts pass through."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

import constraints  # noqa: E402

TEMPLATE_PATH = Path(__file__).resolve().parent / "templates" / "fir_form_a.json"


def _spec(field: str, charset: str, validator: str) -> constraints.FieldSpec:
    return constraints.FieldSpec(
        field=field, bbox=(0.0, 0.0, 1.0, 1.0), charset=charset, validator=validator, required=False
    )


def test_valid_date_accepted() -> None:
    result = constraints.apply_constraints(_spec("d", "date", "date"), "14/11/2024")
    assert result.accepted and result.constrained and result.reason is None


def test_impossible_date_rejected_with_reason() -> None:
    result = constraints.apply_constraints(_spec("d", "date", "date"), "45/13/2024")
    assert not result.accepted
    assert result.reason is not None


def test_out_of_charset_characters_rejected_never_stripped() -> None:
    result = constraints.apply_constraints(_spec("p", "digits", "phone"), "98AB123456")
    assert not result.accepted
    assert result.text == "98AB123456"
    assert result.reason is not None and "charset" in result.reason


def test_valid_phone_and_section_accepted() -> None:
    assert constraints.apply_constraints(_spec("p", "digits", "phone"), "9822012345").accepted
    assert constraints.apply_constraints(_spec("s", "section", "section_number"), "302").accepted


def test_short_phone_rejected() -> None:
    result = constraints.apply_constraints(_spec("p", "digits", "phone"), "12345")
    assert not result.accepted


def test_unknown_validator_raises() -> None:
    with pytest.raises(ValueError, match="unknown validator"):
        constraints.validate("horoscope", "text")


def test_unrecognised_layout_falls_back_to_unconstrained() -> None:
    template = constraints.load_template(TEMPLATE_PATH)
    result = constraints.constrain_or_passthrough(template, "some_new_field", "anything at all 123")
    assert result.accepted and not result.constrained


def test_no_template_means_passthrough() -> None:
    result = constraints.constrain_or_passthrough(None, None, "free narrative text")
    assert result.accepted and not result.constrained


def test_template_fields_match_baseline_shape() -> None:
    template = constraints.load_template(TEMPLATE_PATH)
    assert template.name == "fir_form_a"
    by_name = {spec.field: spec for spec in template.fields}
    assert by_name["complaint_date"].validator == "date"
    assert by_name["ipc_section"].validator == "section_number"
    assert by_name["complainant_phone"].validator == "phone"
    assert by_name["narrative"].charset == "unconstrained"
