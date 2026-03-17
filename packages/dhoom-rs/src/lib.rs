//! # DHOOM — Davis Human-readable Optimized Object Markup
//!
//! A compact, human-readable serialization format built on fiber bundle geometry.
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use dhoom::{encode, decode};
//! use serde_json::json;
//!
//! let data = json!({
//!     "reviews": [
//!         {"id": 101, "customer": "Alex Rivera", "rating": 5, "comment": "Excellent!", "verified": true},
//!         {"id": 102, "customer": "Brij Pandey", "rating": 5, "comment": "Game changer!", "verified": true},
//!         {"id": 103, "customer": "Casey Lee", "rating": 3, "comment": "Average", "verified": false}
//!     ]
//! });
//!
//! let dhoom_str = encode(&data).unwrap();
//! let roundtrip = decode(&dhoom_str).unwrap();
//! assert_eq!(data, roundtrip);
//! ```

use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use std::fmt::Write;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DhoomError {
    #[error("Parse error at line {line}: {message}")]
    Parse { line: usize, message: String },

    #[error("Encode error: {0}")]
    Encode(String),

    #[error("Invalid arithmetic pattern: {0}")]
    ArithmeticPattern(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, DhoomError>;

/// A field modifier in the fiber header.
#[derive(Debug, Clone, PartialEq)]
pub enum Modifier {
    /// Arithmetic base: `@start` or `@start+step`
    Arithmetic { start: Value, step: Option<i64> },
    /// Modal default: `|value`
    Default(Value),
    /// Nested sub-bundle: `>`
    Nested,
}

/// A single field declaration in the fiber.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldDecl {
    pub name: String,
    pub modifier: Option<Modifier>,
}

/// A parsed fiber (schema header).
#[derive(Debug, Clone, PartialEq)]
pub struct Fiber {
    pub name: Option<String>,
    pub fields: Vec<FieldDecl>,
}

impl Fiber {
    /// Returns the fields that appear in record bodies (non-arithmetic).
    pub fn record_fields(&self) -> Vec<&FieldDecl> {
        self.fields
            .iter()
            .filter(|f| !matches!(f.modifier, Some(Modifier::Arithmetic { .. })))
            .collect()
    }

    /// Returns the default value for a field, if declared.
    pub fn default_for(&self, name: &str) -> Option<&Value> {
        self.fields.iter().find_map(|f| {
            if f.name == name {
                match &f.modifier {
                    Some(Modifier::Default(v)) => Some(v),
                    _ => None,
                }
            } else {
                None
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/// Coerce a raw string token into a typed JSON Value per DHOOM spec §8.
fn coerce(s: &str) -> Value {
    match s {
        "T" => Value::Bool(true),
        "F" => Value::Bool(false),
        "null" => Value::Null,
        "" => Value::String(String::new()),
        _ => {
            if let Ok(i) = s.parse::<i64>() {
                Value::Number(Number::from(i))
            } else if let Ok(f) = s.parse::<f64>() {
                Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or_else(|| Value::String(s.to_string()))
            } else {
                Value::String(s.to_string())
            }
        }
    }
}

/// Format a JSON Value back to its DHOOM record representation.
fn value_to_dhoom(v: &Value) -> String {
    match v {
        Value::Bool(true) => "T".into(),
        Value::Bool(false) => "F".into(),
        Value::Null => "null".into(),
        Value::String(s) => {
            if s.contains(',') || s.contains(':') || s.contains('\n') || s.contains('"') {
                let escaped = s.replace('"', "\"\"");
                format!("\"{}\"", escaped)
            } else {
                s.clone()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::Array(_) | Value::Object(_) => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

/// Parse a string-pattern arithmetic start value.
/// Returns (prefix, numeric_suffix, padding_width) or None if purely numeric.
fn parse_string_pattern(s: &str) -> Option<(String, i64, usize)> {
    // Find the last non-digit character
    let last_nondigit = s.rfind(|c: char| !c.is_ascii_digit())?;
    let prefix = &s[..=last_nondigit];
    let suffix = &s[last_nondigit + 1..];
    if suffix.is_empty() {
        return None;
    }
    let width = suffix.len();
    let num: i64 = suffix.parse().ok()?;
    Some((prefix.to_string(), num, width))
}

/// Compute arithmetic value at ordinal index i.
fn arithmetic_value(start: &Value, step: i64, i: usize) -> Value {
    match start {
        Value::Number(n) => {
            if let Some(base) = n.as_i64() {
                Value::Number(Number::from(base + step * i as i64))
            } else if let Some(base) = n.as_f64() {
                let val = base + (step as f64) * (i as f64);
                Number::from_f64(val)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            }
        }
        Value::String(s) => {
            if let Some((prefix, base_num, width)) = parse_string_pattern(s) {
                let val = base_num + step * i as i64;
                Value::String(format!("{}{:0>width$}", prefix, val, width = width))
            } else {
                Value::String(s.clone())
            }
        }
        other => other.clone(),
    }
}

// ---------------------------------------------------------------------------
// Fiber parser
// ---------------------------------------------------------------------------

/// Parse a fiber header string into a `Fiber` struct.
///
/// Accepts the full header line, e.g.:
/// `reviews{id@101, customer, comment, rating|5, verified|T}`
/// or anonymous: `{status, data>}`
pub fn parse_fiber(input: &str) -> Result<Fiber> {
    let input = input.trim();
    let brace_start = input.find('{').ok_or_else(|| DhoomError::Parse {
        line: 0,
        message: "Missing '{' in fiber header".into(),
    })?;
    let brace_end = input.rfind('}').ok_or_else(|| DhoomError::Parse {
        line: 0,
        message: "Missing '}' in fiber header".into(),
    })?;

    let name = if brace_start > 0 {
        Some(input[..brace_start].trim().to_string())
    } else {
        None
    };

    let fields_str = &input[brace_start + 1..brace_end];
    let mut fields = Vec::new();

    for raw in fields_str.split(',') {
        let token = raw.trim();
        if token.is_empty() {
            continue;
        }
        fields.push(parse_field_decl(token)?);
    }

    Ok(Fiber { name, fields })
}

fn parse_field_decl(token: &str) -> Result<FieldDecl> {
    // Nested: field>
    if let Some(name) = token.strip_suffix('>') {
        return Ok(FieldDecl {
            name: name.to_string(),
            modifier: Some(Modifier::Nested),
        });
    }

    // Arithmetic: field@start or field@start+step
    if let Some(at_pos) = token.find('@') {
        let name = token[..at_pos].to_string();
        let rest = &token[at_pos + 1..];
        let (start_str, step) = if let Some(plus_pos) = rest.find('+') {
            let s: i64 = rest[plus_pos + 1..].parse().map_err(|_| {
                DhoomError::ArithmeticPattern(format!("Invalid step in '{}'", token))
            })?;
            (&rest[..plus_pos], Some(s))
        } else {
            (rest, None)
        };
        let start = coerce(start_str);
        return Ok(FieldDecl {
            name,
            modifier: Some(Modifier::Arithmetic { start, step }),
        });
    }

    // Default: field|value
    if let Some(pipe_pos) = token.find('|') {
        let name = token[..pipe_pos].to_string();
        let default_val = coerce(&token[pipe_pos + 1..]);
        return Ok(FieldDecl {
            name,
            modifier: Some(Modifier::Default(default_val)),
        });
    }

    // Plain variable field
    Ok(FieldDecl {
        name: token.to_string(),
        modifier: None,
    })
}

// ---------------------------------------------------------------------------
// Record parser — split a record line respecting quotes
// ---------------------------------------------------------------------------

fn split_record_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    // Escaped double quote
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                current.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            fields.push(current.trim().to_string());
            current = String::new();
        } else {
            current.push(c);
        }
    }
    fields.push(current.trim().to_string());
    fields
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

/// Decode a DHOOM string into a JSON value.
pub fn decode(input: &str) -> Result<Value> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(Value::Null);
    }
    let (bundle_name, value) = decode_bundle(input, 0)?;
    // Wrap in object with bundle name as key, or return directly if anonymous
    match bundle_name {
        Some(name) => {
            let mut map = Map::new();
            map.insert(name, value);
            Ok(Value::Object(map))
        }
        None => Ok(value),
    }
}

/// Decode a single bundle starting at the given line offset.
/// Returns (optional_name, decoded_value).
fn decode_bundle(input: &str, line_offset: usize) -> Result<(Option<String>, Value)> {
    // Find the header line (contains '{...}:')
    let colon_pos = find_header_end(input).ok_or_else(|| DhoomError::Parse {
        line: line_offset,
        message: "Missing '}:' header terminator".into(),
    })?;

    let header = input[..colon_pos - 1].trim(); // everything before ':'
    let body = &input[colon_pos..];             // everything after ':'
    let fiber = parse_fiber(header)?;

    let record_fields = fiber.record_fields();
    let has_nested = record_fields
        .iter()
        .any(|f| matches!(f.modifier, Some(Modifier::Nested)));

    let records = if has_nested {
        decode_nested_records(body, &fiber, line_offset + 1)?
    } else {
        decode_flat_records(body, &fiber, line_offset + 1)?
    };

    Ok((fiber.name.clone(), Value::Array(records)))
}

/// Find the position of ':' that ends the fiber header (the one after '}').
/// Returns the byte index immediately after the ':'.
fn find_header_end(input: &str) -> Option<usize> {
    let brace = input.find('}')?;
    let after = &input[brace + 1..];
    let colon_offset = after.find(':')?;
    Some(brace + 1 + colon_offset + 1) // index after ':'
}

fn decode_flat_records(body: &str, fiber: &Fiber, _line_offset: usize) -> Result<Vec<Value>> {
    let record_fields = fiber.record_fields();
    let mut records = Vec::new();
    let mut record_ordinal = 0;

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let raw_fields = split_record_fields(trimmed);
        let mut obj = Map::new();
        let mut field_idx = 0;

        // Fill arithmetic fields
        for fdecl in &fiber.fields {
            if let Some(Modifier::Arithmetic { ref start, ref step }) = fdecl.modifier {
                let s = step.unwrap_or(1);
                obj.insert(fdecl.name.clone(), arithmetic_value(start, s, record_ordinal));
            }
        }

        // Map positional record values
        for (j, rf) in record_fields.iter().enumerate() {
            if j < raw_fields.len() {
                let raw = &raw_fields[j];
                let val = if raw.is_empty() {
                    // Omitted → use default if available
                    if let Some(Modifier::Default(ref d)) = rf.modifier {
                        d.clone()
                    } else {
                        Value::String(String::new())
                    }
                } else if let Some(stripped) = raw.strip_prefix(':') {
                    // Deviation override
                    coerce(stripped)
                } else if let Some(Modifier::Default(_)) = rf.modifier {
                    // This shouldn't happen in well-formed DHOOM for default fields
                    // unless trailing elision left them out. Treat as value.
                    coerce(raw)
                } else {
                    coerce(raw)
                };
                obj.insert(rf.name.clone(), val);
            } else {
                // Trailing elision — fill with default
                if let Some(Modifier::Default(ref d)) = rf.modifier {
                    obj.insert(rf.name.clone(), d.clone());
                }
            }
            field_idx = j + 1;
        }

        // Fill any remaining default fields (trailing elision)
        for rf in record_fields.iter().skip(field_idx) {
            if let Some(Modifier::Default(ref d)) = rf.modifier {
                obj.insert(rf.name.clone(), d.clone());
            }
        }

        records.push(Value::Object(obj));
        record_ordinal += 1;
    }

    Ok(records)
}

fn decode_nested_records(
    body: &str,
    fiber: &Fiber,
    line_offset: usize,
) -> Result<Vec<Value>> {
    let record_fields = fiber.record_fields();
    let mut records = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut line_idx = 0;
    let mut record_ordinal = 0;

    while line_idx < lines.len() {
        let trimmed = lines[line_idx].trim();
        if trimmed.is_empty() {
            line_idx += 1;
            continue;
        }

        let mut obj = Map::new();

        // Fill arithmetic fields
        for fdecl in &fiber.fields {
            if let Some(Modifier::Arithmetic { ref start, ref step }) = fdecl.modifier {
                let s = step.unwrap_or(1);
                obj.insert(
                    fdecl.name.clone(),
                    arithmetic_value(start, s, record_ordinal),
                );
            }
        }

        // Parse the parent record line
        let raw_fields = split_record_fields(trimmed);
        let mut nested_fields: Vec<&FieldDecl> = Vec::new();
        let mut rf_idx = 0;

        for rf in &record_fields {
            if matches!(rf.modifier, Some(Modifier::Nested)) {
                nested_fields.push(rf);
            } else {
                if rf_idx < raw_fields.len() {
                    let raw = &raw_fields[rf_idx];
                    let val = if raw.is_empty() {
                        if let Some(Modifier::Default(ref d)) = rf.modifier {
                            d.clone()
                        } else {
                            Value::String(String::new())
                        }
                    } else if let Some(stripped) = raw.strip_prefix(':') {
                        coerce(stripped)
                    } else {
                        coerce(raw)
                    };
                    obj.insert(rf.name.clone(), val);
                } else if let Some(Modifier::Default(ref d)) = rf.modifier {
                    obj.insert(rf.name.clone(), d.clone());
                }
                rf_idx += 1;
            }
        }

        line_idx += 1;

        // Parse nested bundles
        for nf in &nested_fields {
            // Collect indented lines that form the nested bundle
            let mut nested_text = String::new();
            while line_idx < lines.len() {
                let l = lines[line_idx];
                // Nested content is indented; stop when we hit non-indented non-empty
                if !l.is_empty()
                    && !l.starts_with(' ')
                    && !l.starts_with('\t')
                    && !nested_text.is_empty()
                {
                    break;
                }
                if l.trim().is_empty() && nested_text.is_empty() {
                    line_idx += 1;
                    continue;
                }
                // Check if this starts a new nested bundle header
                if nested_text.contains("}:\n") && l.trim().starts_with('{') {
                    break;
                }
                nested_text.push_str(l.trim());
                nested_text.push('\n');
                line_idx += 1;
            }

            if !nested_text.trim().is_empty() {
                let (_, nested_val) =
                    decode_bundle(nested_text.trim(), line_offset + line_idx)?;
                obj.insert(nf.name.clone(), nested_val);
            }
        }

        records.push(Value::Object(obj));
        record_ordinal += 1;
    }

    Ok(records)
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/// Encode a JSON value into DHOOM format.
pub fn encode(value: &Value) -> Result<String> {
    let mut out = String::new();
    match value {
        Value::Object(map) => {
            if map.len() == 1 {
                let (key, val) = map.iter().next().unwrap();
                if let Value::Array(arr) = val {
                    encode_bundle(key, arr, &mut out, 0)?;
                } else {
                    return Err(DhoomError::Encode(
                        "Top-level object value must be an array".into(),
                    ));
                }
            } else {
                return Err(DhoomError::Encode(
                    "Top-level object must have exactly one key (the bundle name)".into(),
                ));
            }
        }
        Value::Array(arr) => {
            encode_bundle("data", arr, &mut out, 0)?;
        }
        _ => {
            return Err(DhoomError::Encode(
                "Top-level value must be an object or array".into(),
            ));
        }
    }
    Ok(out)
}

fn encode_bundle(name: &str, records: &[Value], out: &mut String, indent: usize) -> Result<()> {
    if records.is_empty() {
        let _ = write!(out, "{}{}{{}}:\n", " ".repeat(indent), name);
        return Ok(());
    }

    // Collect all keys from the first record (assume homogeneous)
    let first = records[0]
        .as_object()
        .ok_or_else(|| DhoomError::Encode("Array elements must be objects".into()))?;
    let keys: Vec<String> = first.keys().cloned().collect();

    // Analyze each field across all records
    let mut field_decls: Vec<FieldDecl> = Vec::new();
    let mut arithmetic_fields: Vec<String> = Vec::new();
    let mut default_fields: Vec<(String, Value)> = Vec::new();
    let mut variable_fields: Vec<String> = Vec::new();
    let mut nested_fields: Vec<String> = Vec::new();

    for key in &keys {
        let values: Vec<&Value> = records
            .iter()
            .filter_map(|r| r.as_object().and_then(|o| o.get(key)))
            .collect();

        // Check if nested (arrays of objects)
        if values.iter().all(|v| v.is_array()) {
            nested_fields.push(key.clone());
            continue;
        }

        // Check arithmetic sequence
        if let Some((start, step)) = detect_arithmetic(&values) {
            arithmetic_fields.push(key.clone());
            let step_val = if step == 1 { None } else { Some(step) };
            field_decls.push(FieldDecl {
                name: key.clone(),
                modifier: Some(Modifier::Arithmetic {
                    start: start.clone(),
                    step: step_val,
                }),
            });
            continue;
        }

        // Check modal default (most common value)
        if let Some((default_val, match_count)) = find_modal_default(&values) {
            if match_count > records.len() / 2 {
                default_fields.push((key.clone(), default_val));
                continue;
            }
        }

        variable_fields.push(key.clone());
    }

    // Build fiber: arithmetic first, then variable, then defaults (for trailing elision), then nested
    let mut ordered_fields: Vec<FieldDecl> = Vec::new();

    // Arithmetic fields (already in field_decls)
    for fd in &field_decls {
        if matches!(fd.modifier, Some(Modifier::Arithmetic { .. })) {
            ordered_fields.push(fd.clone());
        }
    }

    // Variable fields
    for key in &variable_fields {
        ordered_fields.push(FieldDecl {
            name: key.clone(),
            modifier: None,
        });
    }

    // Default fields (order by match frequency desc for maximum trailing elision)
    let mut default_with_freq: Vec<(String, Value, usize)> = default_fields
        .into_iter()
        .map(|(key, dval)| {
            let count = records
                .iter()
                .filter(|r| r.as_object().and_then(|o| o.get(&key)) == Some(&dval))
                .count();
            (key, dval, count)
        })
        .collect();
    default_with_freq.sort_by(|a, b| b.2.cmp(&a.2));

    for (key, dval, _) in &default_with_freq {
        ordered_fields.push(FieldDecl {
            name: key.clone(),
            modifier: Some(Modifier::Default(dval.clone())),
        });
    }

    // Nested fields
    for key in &nested_fields {
        ordered_fields.push(FieldDecl {
            name: key.clone(),
            modifier: Some(Modifier::Nested),
        });
    }

    // Emit header
    let prefix = " ".repeat(indent);
    let _ = write!(out, "{}{}", prefix, name);
    out.push('{');
    for (i, fd) in ordered_fields.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&fd.name);
        match &fd.modifier {
            Some(Modifier::Arithmetic { start, step }) => {
                out.push('@');
                out.push_str(&value_to_dhoom(start));
                if let Some(s) = step {
                    let _ = write!(out, "+{}", s);
                }
            }
            Some(Modifier::Default(v)) => {
                out.push('|');
                out.push_str(&value_to_dhoom(v));
            }
            Some(Modifier::Nested) => {
                out.push('>');
            }
            None => {}
        }
    }
    out.push_str("}:\n");

    // Emit records
    let rec_fields: Vec<&FieldDecl> = ordered_fields
        .iter()
        .filter(|f| !matches!(f.modifier, Some(Modifier::Arithmetic { .. })))
        .collect();

    for record in records {
        let obj = record
            .as_object()
            .ok_or_else(|| DhoomError::Encode("Record must be an object".into()))?;

        let mut values: Vec<String> = Vec::new();
        let mut nested_bundles: Vec<(&str, &Value)> = Vec::new();

        for rf in &rec_fields {
            if matches!(rf.modifier, Some(Modifier::Nested)) {
                if let Some(v) = obj.get(&rf.name) {
                    nested_bundles.push((&rf.name, v));
                }
                continue;
            }

            let val = obj.get(&rf.name);
            match (&rf.modifier, val) {
                (Some(Modifier::Default(d)), Some(v)) if v == d => {
                    values.push(String::new()); // matches default — elide
                }
                (Some(Modifier::Default(_)), Some(v)) => {
                    values.push(format!(":{}", value_to_dhoom(v))); // deviation
                }
                (_, Some(v)) => {
                    values.push(value_to_dhoom(v));
                }
                (_, None) => {
                    values.push(String::new());
                }
            }
        }

        // Trailing elision: remove trailing empty values
        while values.last().map_or(false, |v| v.is_empty()) {
            values.pop();
        }

        let _ = write!(out, "{}{}", prefix, values.join(", "));

        if !nested_bundles.is_empty() {
            out.push_str(",\n");
            for (_nname, nval) in &nested_bundles {
                if let Value::Array(arr) = nval {
                    encode_bundle("", arr, out, indent + 2)?;
                }
            }
        } else {
            out.push('\n');
        }
    }

    Ok(())
}

/// Detect if a sequence of values forms an arithmetic progression.
/// Returns (start_value, step) if so.
fn detect_arithmetic(values: &[&Value]) -> Option<(Value, i64)> {
    if values.len() < 2 {
        return None;
    }

    // Try numeric arithmetic
    let nums: Option<Vec<i64>> = values.iter().map(|v| v.as_i64()).collect();
    if let Some(nums) = nums {
        let step = nums[1] - nums[0];
        if nums.windows(2).all(|w| w[1] - w[0] == step) {
            return Some((values[0].clone(), step));
        }
    }

    // Try string-pattern arithmetic
    let strings: Option<Vec<&str>> = values.iter().map(|v| v.as_str()).collect();
    if let Some(strings) = strings {
        let patterns: Option<Vec<(String, i64, usize)>> =
            strings.iter().map(|s| parse_string_pattern(s)).collect();
        if let Some(patterns) = patterns {
            if patterns.iter().all(|(p, _, w)| p == &patterns[0].0 && *w == patterns[0].2) {
                let step = patterns[1].1 - patterns[0].1;
                if patterns.windows(2).all(|w| w[1].1 - w[0].1 == step) {
                    return Some((values[0].clone(), step));
                }
            }
        }
    }

    None
}

/// Find the most common (modal) value in a list.
fn find_modal_default(values: &[&Value]) -> Option<(Value, usize)> {
    if values.is_empty() {
        return None;
    }
    let mut counts: HashMap<String, (Value, usize)> = HashMap::new();
    for v in values {
        let key = format!("{}", v);
        counts
            .entry(key)
            .and_modify(|e| e.1 += 1)
            .or_insert_with(|| ((*v).clone(), 1));
    }
    counts.into_values().max_by_key(|&(_, c)| c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_fiber_parse_simple() {
        let fiber =
            parse_fiber("reviews{id@101, customer, comment, rating|5, verified|T}").unwrap();
        assert_eq!(fiber.name, Some("reviews".into()));
        assert_eq!(fiber.fields.len(), 5);
        assert_eq!(
            fiber.fields[0].modifier,
            Some(Modifier::Arithmetic {
                start: json!(101),
                step: None
            })
        );
        assert_eq!(fiber.fields[1].modifier, None); // customer
        assert_eq!(
            fiber.fields[3].modifier,
            Some(Modifier::Default(json!(5)))
        );
        assert_eq!(
            fiber.fields[4].modifier,
            Some(Modifier::Default(Value::Bool(true)))
        );
    }

    #[test]
    fn test_fiber_parse_anonymous() {
        let fiber = parse_fiber("{status, data>}").unwrap();
        assert_eq!(fiber.name, None);
        assert_eq!(fiber.fields.len(), 2);
        assert_eq!(fiber.fields[1].modifier, Some(Modifier::Nested));
    }

    #[test]
    fn test_arithmetic_numeric() {
        let v0 = arithmetic_value(&json!(101), 1, 0);
        let v1 = arithmetic_value(&json!(101), 1, 1);
        let v2 = arithmetic_value(&json!(101), 1, 2);
        assert_eq!(v0, json!(101));
        assert_eq!(v1, json!(102));
        assert_eq!(v2, json!(103));
    }

    #[test]
    fn test_arithmetic_numeric_step() {
        let v0 = arithmetic_value(&json!(1710000000), 60, 0);
        let v1 = arithmetic_value(&json!(1710000000), 60, 1);
        let v2 = arithmetic_value(&json!(1710000000), 60, 2);
        assert_eq!(v0, json!(1710000000));
        assert_eq!(v1, json!(1710000060));
        assert_eq!(v2, json!(1710000120));
    }

    #[test]
    fn test_arithmetic_string_pattern() {
        let start = Value::String("T-001".into());
        let v0 = arithmetic_value(&start, 1, 0);
        let v1 = arithmetic_value(&start, 1, 1);
        let v2 = arithmetic_value(&start, 1, 2);
        assert_eq!(v0, json!("T-001"));
        assert_eq!(v1, json!("T-002"));
        assert_eq!(v2, json!("T-003"));
    }

    #[test]
    fn test_trailing_elision() {
        let input = "items{name, active|T, role|user}:\nAlice\nBob\n";
        let result = decode(input).unwrap();
        let expected = json!({
            "items": [
                {"name": "Alice", "active": true, "role": "user"},
                {"name": "Bob", "active": true, "role": "user"}
            ]
        });
        assert_eq!(result, expected);
    }

    #[test]
    fn test_deviation_marking() {
        let input = "items{name, score|10}:\nAlice\nBob, :7\n";
        let result = decode(input).unwrap();
        let expected = json!({
            "items": [
                {"name": "Alice", "score": 10},
                {"name": "Bob", "score": 7}
            ]
        });
        assert_eq!(result, expected);
    }

    #[test]
    fn test_roundtrip_reviews() {
        let data = json!({
            "reviews": [
                {"id": 101, "customer": "Alex Rivera", "rating": 5, "comment": "Excellent!", "verified": true},
                {"id": 102, "customer": "Brij Pandey", "rating": 5, "comment": "Game changer!", "verified": true},
                {"id": 103, "customer": "Casey Lee", "rating": 3, "comment": "Average", "verified": false}
            ]
        });
        let dhoom = encode(&data).unwrap();
        let roundtrip = decode(&dhoom).unwrap();
        assert_eq!(data, roundtrip);
    }

    #[test]
    fn test_roundtrip_sensors() {
        let data = json!({
            "readings": [
                {"sensor_id": "T-001", "timestamp": 1710000000, "value": 22.4, "status": "normal", "unit": "celsius"},
                {"sensor_id": "T-002", "timestamp": 1710000060, "value": 23.1, "status": "normal", "unit": "celsius"},
                {"sensor_id": "T-003", "timestamp": 1710000120, "value": 45.8, "status": "alert", "unit": "celsius"}
            ]
        });
        let dhoom = encode(&data).unwrap();
        let roundtrip = decode(&dhoom).unwrap();
        assert_eq!(data, roundtrip);
    }

    #[test]
    fn test_decode_reviews_example() {
        let input = "\
reviews{id@101, customer, comment, rating|5, verified|T}:
Alex Rivera, Excellent!
Brij Pandey, Game changer!
Casey Lee, Average, :3, :F
";
        let result = decode(input).unwrap();
        let expected = json!({
            "reviews": [
                {"id": 101, "customer": "Alex Rivera", "comment": "Excellent!", "rating": 5, "verified": true},
                {"id": 102, "customer": "Brij Pandey", "comment": "Game changer!", "rating": 5, "verified": true},
                {"id": 103, "customer": "Casey Lee", "comment": "Average", "rating": 3, "verified": false}
            ]
        });
        assert_eq!(result, expected);
    }

    #[test]
    fn test_decode_sensors_example() {
        let input = "\
readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:
22.4
23.1
45.8, :alert
";
        let result = decode(input).unwrap();
        let expected = json!({
            "readings": [
                {"sensor_id": "T-001", "timestamp": 1710000000, "value": 22.4, "status": "normal", "unit": "celsius"},
                {"sensor_id": "T-002", "timestamp": 1710000060, "value": 23.1, "status": "normal", "unit": "celsius"},
                {"sensor_id": "T-003", "timestamp": 1710000120, "value": 45.8, "status": "alert", "unit": "celsius"}
            ]
        });
        assert_eq!(result, expected);
    }

    #[test]
    fn test_boolean_shorthand() {
        assert_eq!(coerce("T"), Value::Bool(true));
        assert_eq!(coerce("F"), Value::Bool(false));
    }

    #[test]
    fn test_empty_collection() {
        let input = "items{id, name}:\n";
        let result = decode(input).unwrap();
        assert_eq!(result, json!({"items": []}));
    }

    #[test]
    fn test_coerce_types() {
        assert_eq!(coerce("42"), json!(42));
        assert_eq!(coerce("3.14"), json!(3.14));
        assert_eq!(coerce("null"), Value::Null);
        assert_eq!(coerce("hello"), json!("hello"));
        assert_eq!(coerce(""), json!(""));
    }

    #[test]
    fn test_quoted_strings() {
        let fields = split_record_fields(r#"Alice, "value, with comma", Bob"#);
        assert_eq!(fields, vec!["Alice", "value, with comma", "Bob"]);
    }

    #[test]
    fn test_detect_arithmetic_sequence() {
        let vals = vec![json!(1), json!(2), json!(3)];
        let refs: Vec<&Value> = vals.iter().collect();
        let result = detect_arithmetic(&refs);
        assert_eq!(result, Some((json!(1), 1)));
    }

    #[test]
    fn test_detect_arithmetic_step() {
        let vals = vec![json!(10), json!(15), json!(20)];
        let refs: Vec<&Value> = vals.iter().collect();
        let result = detect_arithmetic(&refs);
        assert_eq!(result, Some((json!(10), 5)));
    }

    #[test]
    fn test_find_modal_default_majority() {
        let vals = vec![json!(5), json!(5), json!(3)];
        let refs: Vec<&Value> = vals.iter().collect();
        let (modal, count) = find_modal_default(&refs).unwrap();
        assert_eq!(modal, json!(5));
        assert_eq!(count, 2);
    }
}
