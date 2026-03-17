"""DHOOM encoder/decoder — faithful port of the TypeScript reference implementation."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

JsonValue = Any  # str | int | float | bool | None | list | dict


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class DhoomError(Exception):
    def __init__(self, message: str, line: int | None = None):
        self.line = line
        if line is not None:
            super().__init__(f"Line {line}: {message}")
        else:
            super().__init__(message)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class Modifier:
    type: str  # "arithmetic" | "default" | "nested"
    start: JsonValue = None
    step: int | None = None
    default_value: JsonValue = None


@dataclass
class FieldDecl:
    name: str
    modifier: Modifier | None = None


@dataclass
class Fiber:
    name: str | None = None
    fields: list[FieldDecl] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------

def coerce(s: str) -> JsonValue:
    if s == "T":
        return True
    if s == "F":
        return False
    if s == "null":
        return None
    if s == "":
        return ""
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def value_to_dhoom(v: JsonValue) -> str:
    if v is True:
        return "T"
    if v is False:
        return "F"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        if any(c in v for c in (",", ":", "\n", '"')):
            return '"' + v.replace('"', '""') + '"'
        return v
    return ""


# ---------------------------------------------------------------------------
# Arithmetic helpers
# ---------------------------------------------------------------------------

_STRING_PATTERN = re.compile(r"^(.*\D)(\d+)$")


def _parse_string_pattern(s: str) -> tuple[str, int, int] | None:
    m = _STRING_PATTERN.match(s)
    if not m:
        return None
    return m.group(1), int(m.group(2)), len(m.group(2))


def _arithmetic_value(start: JsonValue, step: int, i: int) -> JsonValue:
    if isinstance(start, (int, float)) and not isinstance(start, bool):
        return start + step * i
    if isinstance(start, str):
        pat = _parse_string_pattern(start)
        if pat:
            prefix, num, width = pat
            return prefix + str(num + step * i).zfill(width)
        return start
    return start


# ---------------------------------------------------------------------------
# Fiber parser
# ---------------------------------------------------------------------------

def _parse_field_decl(token: str) -> FieldDecl:
    # Nested: field>
    if token.endswith(">"):
        return FieldDecl(name=token[:-1], modifier=Modifier(type="nested"))

    # Arithmetic: field@start or field@start+step
    at_idx = token.find("@")
    if at_idx != -1:
        name = token[:at_idx]
        rest = token[at_idx + 1:]
        plus_idx = rest.find("+")
        if plus_idx != -1:
            start = coerce(rest[:plus_idx])
            step = int(rest[plus_idx + 1:])
            return FieldDecl(name=name, modifier=Modifier(type="arithmetic", start=start, step=step))
        return FieldDecl(name=name, modifier=Modifier(type="arithmetic", start=coerce(rest)))

    # Default: field|value
    pipe_idx = token.find("|")
    if pipe_idx != -1:
        name = token[:pipe_idx]
        default_value = coerce(token[pipe_idx + 1:])
        return FieldDecl(name=name, modifier=Modifier(type="default", default_value=default_value))

    return FieldDecl(name=token)


def parse_fiber(input_str: str) -> Fiber:
    s = input_str.strip()
    brace_start = s.find("{")
    brace_end = s.rfind("}")
    if brace_start == -1 or brace_end == -1:
        raise DhoomError("Missing braces in fiber header")

    name = s[:brace_start].strip() or None
    fields_str = s[brace_start + 1:brace_end]
    fields = [
        _parse_field_decl(t.strip())
        for t in fields_str.split(",")
        if t.strip()
    ]
    return Fiber(name=name, fields=fields)


# ---------------------------------------------------------------------------
# Record field splitter (respects quotes)
# ---------------------------------------------------------------------------

def _split_record_fields(line: str) -> list[str]:
    fields: list[str] = []
    current: list[str] = []
    in_quotes = False
    i = 0
    while i < len(line):
        c = line[i]
        if in_quotes:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    current.append('"')
                    i += 1
                else:
                    in_quotes = False
            else:
                current.append(c)
        elif c == '"':
            in_quotes = True
        elif c == ",":
            fields.append("".join(current).strip())
            current = []
        else:
            current.append(c)
        i += 1
    fields.append("".join(current).strip())
    return fields


# ---------------------------------------------------------------------------
# Decoder
# ---------------------------------------------------------------------------

def _find_header_end(input_str: str) -> int:
    brace = input_str.find("}")
    if brace == -1:
        return -1
    colon = input_str.find(":", brace + 1)
    if colon == -1:
        return -1
    return colon + 1


def _record_fields(fiber: Fiber) -> list[FieldDecl]:
    return [f for f in fiber.fields if not (f.modifier and f.modifier.type == "arithmetic")]


def _decode_flat_records(body: str, fiber: Fiber) -> list[JsonValue]:
    rec_fields = _record_fields(fiber)
    records: list[JsonValue] = []
    ordinal = 0

    for line in body.split("\n"):
        trimmed = line.strip()
        if not trimmed:
            continue

        raw = _split_record_fields(trimmed)
        obj: dict[str, JsonValue] = {}

        # Arithmetic fields
        for fd in fiber.fields:
            if fd.modifier and fd.modifier.type == "arithmetic":
                obj[fd.name] = _arithmetic_value(fd.modifier.start, fd.modifier.step or 1, ordinal)

        # Positional values
        for j, rf in enumerate(rec_fields):
            if j < len(raw):
                val = raw[j]
                if val == "":
                    obj[rf.name] = rf.modifier.default_value if rf.modifier and rf.modifier.type == "default" else ""
                elif val.startswith(":"):
                    obj[rf.name] = coerce(val[1:])
                else:
                    obj[rf.name] = coerce(val)
            else:
                # Trailing elision
                if rf.modifier and rf.modifier.type == "default":
                    obj[rf.name] = rf.modifier.default_value

        records.append(obj)
        ordinal += 1

    return records


def _decode_nested_records(body: str, fiber: Fiber) -> list[JsonValue]:
    rec_fields = _record_fields(fiber)
    records: list[JsonValue] = []
    lines = body.split("\n")
    line_idx = 0
    ordinal = 0

    while line_idx < len(lines):
        trimmed = lines[line_idx].strip()
        if not trimmed:
            line_idx += 1
            continue

        obj: dict[str, JsonValue] = {}

        # Arithmetic fields
        for fd in fiber.fields:
            if fd.modifier and fd.modifier.type == "arithmetic":
                obj[fd.name] = _arithmetic_value(fd.modifier.start, fd.modifier.step or 1, ordinal)

        raw = _split_record_fields(trimmed)
        nested_fields: list[FieldDecl] = []
        rf_idx = 0

        for rf in rec_fields:
            if rf.modifier and rf.modifier.type == "nested":
                nested_fields.append(rf)
            else:
                if rf_idx < len(raw):
                    val = raw[rf_idx]
                    if val == "":
                        obj[rf.name] = rf.modifier.default_value if rf.modifier and rf.modifier.type == "default" else ""
                    elif val.startswith(":"):
                        obj[rf.name] = coerce(val[1:])
                    else:
                        obj[rf.name] = coerce(val)
                elif rf.modifier and rf.modifier.type == "default":
                    obj[rf.name] = rf.modifier.default_value
                rf_idx += 1

        line_idx += 1

        # Parse nested bundles
        for _nf in nested_fields:
            nested_text = ""
            while line_idx < len(lines):
                line = lines[line_idx]
                if line != "" and not line.startswith(" ") and not line.startswith("\t") and nested_text != "":
                    break
                if line.strip() == "" and nested_text == "":
                    line_idx += 1
                    continue
                if "}:\n" in nested_text and line.strip().startswith("{"):
                    break
                nested_text += line.strip() + "\n"
                line_idx += 1

            if nested_text.strip():
                result = _decode_bundle(nested_text.strip())
                obj[_nf.name] = result["value"]

        records.append(obj)
        ordinal += 1

    return records


def _decode_bundle(input_str: str) -> dict:
    header_end = _find_header_end(input_str)
    if header_end == -1:
        raise DhoomError("Missing '}:' header terminator")

    header = input_str[:header_end - 1].strip()
    body = input_str[header_end:]
    fiber = parse_fiber(header)

    rec_fields = _record_fields(fiber)
    has_nested = any(f.modifier and f.modifier.type == "nested" for f in rec_fields)

    records = _decode_nested_records(body, fiber) if has_nested else _decode_flat_records(body, fiber)
    return {"name": fiber.name, "value": records}


def decode(input_str: str) -> JsonValue:
    """Decode a DHOOM string into a Python value."""
    s = input_str.strip()
    if not s:
        return None

    result = _decode_bundle(s)
    if result["name"]:
        return {result["name"]: result["value"]}
    return result["value"]


# ---------------------------------------------------------------------------
# Encoder
# ---------------------------------------------------------------------------

def _detect_arithmetic(values: list[JsonValue]) -> dict | None:
    if len(values) < 2:
        return None

    # Numeric (exclude booleans — in Python isinstance(True, int) is True)
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        step = values[1] - values[0]
        if all(values[i] - values[i - 1] == step for i in range(1, len(values))):
            return {"start": values[0], "step": step}

    # String pattern
    if all(isinstance(v, str) for v in values):
        patterns = [_parse_string_pattern(v) for v in values]
        if all(p is not None for p in patterns):
            if all(p[0] == patterns[0][0] and p[2] == patterns[0][2] for p in patterns):
                step = patterns[1][1] - patterns[0][1]
                if all(patterns[i][1] - patterns[i - 1][1] == step for i in range(1, len(patterns))):
                    return {"start": values[0], "step": step}

    return None


def _find_modal_default(values: list[JsonValue]) -> dict | None:
    if not values:
        return None
    counts: dict[str, dict] = {}
    for v in values:
        key = json.dumps(v)
        if key in counts:
            counts[key]["count"] += 1
        else:
            counts[key] = {"value": v, "count": 1}
    best = max(counts.values(), key=lambda x: x["count"])
    return best


def _json_equal(a: JsonValue, b: JsonValue) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _encode_bundle(name: str, records: list[dict], indent: int) -> str:
    prefix = " " * indent

    if not records:
        return f"{prefix}{name}{{}}:\n"

    keys = list(records[0].keys())
    ordered_fields: list[FieldDecl] = []
    arithmetic_keys: set[str] = set()
    default_keys: dict[str, JsonValue] = {}
    nested_keys: set[str] = set()
    variable_keys: list[str] = []

    for key in keys:
        values = [r[key] for r in records]

        # Check nested
        if all(isinstance(v, list) for v in values):
            nested_keys.add(key)
            continue

        # Check arithmetic
        arith = _detect_arithmetic(values)
        if arith:
            arithmetic_keys.add(key)
            step = arith["step"]
            ordered_fields.append(FieldDecl(
                name=key,
                modifier=Modifier(type="arithmetic", start=arith["start"], step=step if step != 1 else None)
            ))
            continue

        # Check modal default
        modal = _find_modal_default(values)
        if modal and modal["count"] > len(records) / 2:
            default_keys[key] = modal["value"]
            continue

        variable_keys.append(key)

    # Variable fields
    for key in variable_keys:
        ordered_fields.append(FieldDecl(name=key))

    # Default fields (sorted by frequency desc for trailing elision)
    default_entries = []
    for key, val in default_keys.items():
        count = sum(1 for r in records if _json_equal(r[key], val))
        default_entries.append((key, val, count))
    default_entries.sort(key=lambda x: -x[2])
    for key, val, _ in default_entries:
        ordered_fields.append(FieldDecl(name=key, modifier=Modifier(type="default", default_value=val)))

    # Nested fields
    for key in nested_keys:
        ordered_fields.append(FieldDecl(name=key, modifier=Modifier(type="nested")))

    # Emit header
    parts = []
    for fd in ordered_fields:
        s = fd.name
        if fd.modifier:
            if fd.modifier.type == "arithmetic":
                s += f"@{value_to_dhoom(fd.modifier.start)}"
                if fd.modifier.step is not None:
                    s += f"+{fd.modifier.step}"
            elif fd.modifier.type == "default":
                s += f"|{value_to_dhoom(fd.modifier.default_value)}"
            elif fd.modifier.type == "nested":
                s += ">"
        parts.append(s)

    out = f"{prefix}{name}{{{', '.join(parts)}}}:\n"

    # Emit records
    rec_fields = [f for f in ordered_fields if not (f.modifier and f.modifier.type == "arithmetic")]

    for record in records:
        values: list[str] = []
        nested_bundles: list[tuple[str, list[dict]]] = []

        for rf in rec_fields:
            if rf.modifier and rf.modifier.type == "nested":
                v = record[rf.name]
                if isinstance(v, list):
                    nested_bundles.append(("", v))
                continue

            val = record[rf.name]
            if rf.modifier and rf.modifier.type == "default":
                if _json_equal(val, rf.modifier.default_value):
                    values.append("")
                else:
                    values.append(f":{value_to_dhoom(val)}")
            else:
                values.append(value_to_dhoom(val))

        # Trailing elision
        while values and values[-1] == "":
            values.pop()

        out += f"{prefix}{', '.join(values)}"

        if nested_bundles:
            out += ",\n"
            for nb_name, nb_records in nested_bundles:
                out += _encode_bundle(nb_name, nb_records, indent + 2)
        else:
            out += "\n"

    return out


def encode(value: JsonValue) -> str:
    """Encode a Python value into DHOOM format."""
    if isinstance(value, dict):
        keys = list(value.keys())
        if len(keys) == 1:
            arr = value[keys[0]]
            if isinstance(arr, list):
                return _encode_bundle(keys[0], arr, 0)
        raise DhoomError("Top-level object must have exactly one key (the bundle name)")
    if isinstance(value, list):
        return _encode_bundle("data", value, 0)
    raise DhoomError("Top-level value must be an object or array")
