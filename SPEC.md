# DHOOM Specification v0.3

**Davis Human-readable Optimized Object Markup**

Status: Draft · March 2026 · Davis Geometric

---

## 1. Introduction

DHOOM is a compact, human-readable serialization format for structured data. It encodes the same data model as JSON (objects, arrays, strings, numbers, booleans, null) but exploits the mathematical structure of homogeneous collections — specifically their decomposition as **fiber bundles** — to eliminate redundancy.

DHOOM is intended as a drop-in, lossless replacement for JSON wherever data is transmitted, stored, or fed to language models. It is self-describing: a conforming parser can reconstruct the full data from a DHOOM document with no external schema, registry, or context.

### 1.1 Design Principles

| Principle | Rule |
|---|---|
| **Inline Fiber** | Schema lives in the header. No external lookups. |
| **Position is the key** | Field order in the header defines record layout. No keys repeated. |
| **Silence means agreement** | Trailing defaults are elided. Missing fields = default. |
| **Values are sacred** | Data values are never abbreviated, truncated, or context-dependent. |
| **Don't transmit what you can derive** | Sequential indices, constants, and defaults are declared, not listed. |

### 1.2 Geometric Interpretation

Every homogeneous data collection admits a decomposition as a fiber bundle *(F, E, B, π)*:

- **Base space** *B* — the index set (record IDs, timestamps, counters)
- **Fiber** *F* — the schema (field names, types, constraints)
- **Total space** *E* — the set of all concrete records
- **Projection** *π: E → B* — maps each record to its index
- **Section** *σ: B → E* — a specific record (a choice of values over the fiber)
- **Zero section** *σ₀* — the default record (declared via `|` modifiers)

These bundles are always **trivial**: every record shares the same fiber, so *E ≅ B × F* globally. There are no non-trivial transition functions or characteristic classes. The geometric insight is not topological but **coordinate-theoretic** — choosing a zero section and field ordering that minimize each section's expression.

DHOOM compresses by:

1. **Trivialization**: declaring *F* once (the header), so records transmit only section values.
2. **Base compression**: compressing *B* when it has arithmetic structure (`@`).
3. **Zero section**: defining *σ₀* via `|` defaults, so records encode only deviations *σ − σ₀*.
4. **Coordinate choice**: ordering the fiber so defaulted fields are trailing, maximizing elision.

## 2. File Format

### 2.1 Encoding

DHOOM documents are UTF-8 encoded. The file extension is `.dhoom`. The provisional media type is `text/dhoom`.

### 2.2 Document Structure

A DHOOM document consists of one or more **bundles**. A bundle is a named (or anonymous) collection with an inline schema and a body of records.

```
bundle = name? "{" fiber "}" ":" body
```

## 3. Fiber (Schema Header)

The fiber is an inline, comma-separated list of field declarations enclosed in curly braces.

```
name{field1, field2@start, field3|default, field4>}:
```

Each field declaration consists of an **identifier** and an optional **modifier**.

### 3.1 Identifiers

```
identifier = [A-Za-z_][A-Za-z0-9_-]*
```

Field names are case-sensitive. They must not contain commas, colons, pipes, braces, or whitespace.

### 3.2 Modifiers

A field may have exactly one modifier:

| Modifier | Syntax | Meaning |
|---|---|---|
| Arithmetic base | `field@start` or `field@start+step` | Value derived from position. Omitted from records. |
| Modal default | `field\|value` | Default value. Omitted when matched; `:override` when not. |
| Nested bundle | `field>` | Field contains a child bundle. |

If a field has no modifier, it is a **variable field** — its value must appear in every record.

## 4. Arithmetic Fields (`@`)

### 4.1 Numeric Arithmetic

```
id@101        →  101, 102, 103, ...
id@101+5      →  101, 106, 111, ...
timestamp@1710000000+60  →  1710000000, 1710000060, 1710000120, ...
```

The value for record at ordinal index *i* (zero-based) is: `start + (i × step)`. If `step` is omitted, it defaults to **1**.

**Step values** may be negative (e.g. `id@100+-2` → 100, 98, 96, …) or non-integer (e.g. `temp@20.0+0.5` → 20.0, 20.5, 21.0, …). The `+` before the step is a separator, not a sign — negative steps are written as `+-N`.

**Minimum sequence length:** A conforming encoder should only emit arithmetic compression when the collection contains at least **3** records. With fewer than 3 values, any pair of numbers trivially forms a constant-step sequence, leading to false positives and potential floating-point precision issues.

### 4.2 String-Pattern Arithmetic

For start values matching the pattern `PREFIX-NNN` (a fixed string prefix followed by a zero-padded numeric suffix):

1. The prefix (all characters up to and including the last non-digit character) is held **fixed**.
2. The numeric suffix is parsed as an integer and incremented by `step` (default 1).
3. The result is re-encoded with the **same zero-padding width** as the original.

```
sensor_id@T-001      →  T-001, T-002, T-003, ...
sensor_id@T-001+10   →  T-001, T-011, T-021, ...
bay@A-0001           →  A-0001, A-0002, A-0003, ...
```

### 4.3 Omission Rule

Arithmetic fields **never appear** in the record body. Their values are fully derived from ordinal position.

## 5. Default Fields (`|`)

### 5.1 Declaration

```
rating|5          →  default value is the integer 5
status|normal     →  default value is the string "normal"
active|T          →  default value is boolean true
```

The default value is specified by the **document author** as the most common or expected value for that field. It is a design decision, not a computed statistic.

### 5.2 Omission in Records

When a record's value for a defaulted field matches the declared default, the field **may be omitted** from the record. A conforming parser fills in the default.

### 5.3 Override Syntax

When a record's value deviates from the default, the value is prefixed with a **colon**:

```
:3        →  this field's value is 3, overriding the default
:F        →  this field's value is false, overriding the default
:alert    →  this field's value is "alert", overriding the default
```

### 5.4 Trailing Elision

If the last *n* fields in a record all match their defaults, they may be omitted entirely. The parser fills in all trailing defaults.

**Critical design rule:** To maximize trailing elision, defaulted fields should be placed at the **end** of the fiber. Field ordering is a compression decision that affects serialized size without affecting logical content.

## 6. Nested Bundles (`>`)

### 6.1 Declaration

```
order{id, customer, total, items>, shipping>}:
```

The `>` modifier declares that a field contains a child DHOOM bundle.

### 6.2 Implied Name

The child bundle **inherits its name** from the parent's field declaration. The child header begins directly with `{fields}:` — the name is not repeated.

```
order{id, customer, total, items>, shipping>}:
ORD-7891, Diana Prince, 149.99,
  {sku@A100, name, qty, price}:
  Widget, 2, 49.99
  Gadget, 1, 50.01,
  {method, address}:
  express, 1234 Elm St
```

Note how the nested `items` bundle exploits arithmetic compression on `sku@A100` — the full grammar applies recursively, including all modifiers.

### 6.3 Recursion

Nested bundles follow the full DHOOM grammar recursively. All modifiers (`@`, `|`, `>`) are available within nested bundles.

### 6.4 Anonymous Bundles

A bundle may omit its name. This is useful for top-level documents that wrap a single named child bundle:

```
{status, data>}:
200,
  posts{id@1, author, title, likes, published|T}:
  jpark, Intro to DHOOM, 42
  beedavis, Fiber Bundles for Data, 108
```

The parser treats an anonymous bundle identically to a named one — the name field is simply absent from the output.

## 7. Records (Body)

### 7.1 Delimiters

Records are delimited by **newlines**. No explicit record count is declared; the parser determines the count from the body.

### 7.2 Field Separation

Fields within a record are separated by **commas**. Leading and trailing whitespace around field values is trimmed.

### 7.3 Positional Mapping

The *n*-th value in a record maps to the *n*-th **non-arithmetic** field in the fiber, in declaration order. Arithmetic fields are skipped (they have no slot in the record).

### 7.4 Value Types

| Type | Representation | Examples |
|---|---|---|
| String | Unquoted literal | `Alex Rivera`, `hello world` |
| Number | Unquoted literal | `42`, `3.14`, `-7` |
| Boolean | `T` or `F` | `T`, `F` |
| Null | `null` | `null` |
| Empty string | (empty between commas) | `,,` |

Strings containing commas, colons, or newlines must be quoted with double quotes: `"value, with comma"`. To include a literal double quote inside a quoted string, double it: `"she said ""hello"""` → `she said "hello"`.

Since DHOOM is a line-oriented format, literal newlines inside values must be escaped as the two-character sequence `\n` inside quoted strings: `"line1\nline2"` → `line1` + newline + `line2`. A conforming decoder must unescape `\n` inside quoted strings.

Default values in the fiber header follow the same quoting rules. If a default value contains commas, colons, or quotes, it must be quoted: `status|"on:call"`, `note|"a, b"`.

### 7.5 Indentation

Indentation is not structurally significant for flat records. For nested bundles, indentation is conventional (2 spaces) for readability but is not required by the parser.

## 8. Type Coercion

A conforming parser should attempt to coerce values to the type implied by context:

- Values matching `T` or `F` (case-sensitive) are boolean.
- Values matching `-?[0-9]+(\.[0-9]+)?` are numeric.
- The literal `null` is null.
- All other values are strings.

When converting from JSON, the encoder should use `T`/`F` for booleans and unquoted literals for strings that do not contain reserved characters.

**Note:** The literal strings `"T"`, `"F"`, and `"null"` are indistinguishable from the boolean and null values they resemble. This is a deliberate design trade-off: DHOOM optimizes for the common case where these tokens represent their typed values. Applications that require string values `"T"`, `"F"`, or `"null"` should use a distinguishing wrapper (e.g. a different field name or an explicit type annotation at the application layer).

## 9. Formal Grammar (EBNF)

```ebnf
document     = bundle
bundle       = name? "{" fiber "}" ":" body
fiber        = field ( "," field )*
field        = identifier modifier?
modifier     = "@" start ( "+" step )?
             | "|" default_value
             | ">"
body         = ε | record ( NEWLINE record )*
record       = entry ( "," entry )*
entry        = value
             | ":" value          ; deviation override (only inside record lines)
             | bundle
value        = quoted_string | literal
quoted_string = '"' ([^"] | '""')* '"'
literal      = [^,:\n{}]+
boolean      = "T" | "F"
identifier   = [A-Za-z_][A-Za-z0-9_-]*
```

## 10. Conversion Rules

### 10.1 JSON → DHOOM (Encoding)

1. Identify homogeneous arrays (arrays where all elements are objects with identical keys).
2. For each homogeneous array, construct a fiber header from the keys.
3. Analyze field values across all records to identify arithmetic sequences and modal defaults.
4. Order the fiber: arithmetic fields first, then variable fields, then defaulted fields (sorted by default frequency descending), then nested fields.
5. **Guard:** If every non-nested field would be classified as arithmetic or default (leaving no variable fields), demote the first field back to variable. This ensures every record has at least one explicit value in the body — otherwise trailing elision would produce empty lines indistinguishable from blank separators.
6. For each record, emit only non-arithmetic, non-default values. Use `:` prefix for default overrides. Elide trailing defaults.

### 10.2 DHOOM → JSON (Decoding)

1. Parse the fiber header to extract field names, arithmetic generators, and defaults.
2. For each record, map positional values to non-arithmetic fields.
3. Compute arithmetic field values from record ordinal.
4. Fill trailing omitted fields with declared defaults.
5. Interpret `:` prefixed values as default overrides.
6. Assemble the complete JSON object.

### 10.3 Round-Trip Guarantee

DHOOM ↔ JSON conversion is **lossless**. `decode(encode(json))` produces a JSON value semantically identical to the input (modulo whitespace and key ordering in non-array objects).

## 11. Compression Model

For a collection of *N* records with *K* fields, of which *A* are arithmetic and *D* have defaults matching in *M* records:

**Fields omitted** ≥ (*A* × *N*) + (*D* × *M*)

**Optimal field ordering:** Place all *D* defaulted fields at trailing positions to maximize trailing elision.

The format degrades gracefully: for fully heterogeneous data with no arithmetic indices and no repeated values, DHOOM is approximately the size of CSV-with-header (field names declared once, values listed positionally).

## 12. Comparison to Prior Art

| Feature | JSON | CSV | YAML | TOON | **DHOOM** |
|---|---|---|---|---|---|
| Human-readable | ✓ | ✓ | ✓ | ✓ | **✓** |
| Self-describing | ✓ | Partial | ✓ | ✓ | **✓** |
| Nesting support | ✓ | ✗ | ✓ | ✓ | **✓** |
| Schema header | ✗ | ✓ | ✗ | ✓ | **✓** |
| Arithmetic index compression | ✗ | ✗ | ✗ | ✗ | **✓** |
| Default values | ✗ | ✗ | ✗ | ✗ | **✓** |
| Trailing elision | ✗ | ✗ | ✗ | ✗ | **✓** |
| Deviation marking | ✗ | ✗ | ✗ | ✗ | **✓** |
| Value integrity | ✓ | ✓ | ✓ | ✓ | **✓** |
| Lossless JSON round-trip | — | ✗ | ✓ | ✓ | **✓** |

## 13. References

- Steenrod, N. (1951). *The Topology of Fibre Bundles*. Princeton University Press.
- Crockford, D. (2006). RFC 4627: The application/json Media Type.
- Bray, T. (2017). RFC 8259: The JSON Data Interchange Format.
- Shafranovich, Y. (2005). RFC 4180: Common Format and MIME Type for CSV Files.
- Davis, B. R. (2024). *The Geometry of Sameness*. Amazon KDP.
- Davis, B. R. (2026). *The Double Cover Principle*. Zenodo.

---

**DHOOM** · Davis Human-readable Optimized Object Markup · Davis Geometric · 2026
