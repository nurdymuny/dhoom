# DHOOM Specification v0.5

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
| Delta | `field^` | Values are delta-encoded. First record is absolute; subsequent are deltas. |
| Morphism | `field->target` | Field values reference records in the named target bundle. |
| Interned | `field&` | String pool. Record values are integer indices into the pool. |
| Computed | `field#expr` | Derived from other fields. Omitted from records. |
| Constraint | `field!constraint` | Type/validation annotation. Metadata only. |

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
bundle       = "~"? name? "{" fiber "}" ":" pool* body
fiber        = field ( "," field )*
field        = identifier modifier?
modifier     = "@" start ( "+" step )?
             | "|" default_value
             | ">"
             | "^"
             | "->" identifier
             | "&"
             | "#" expression
             | "!" constraint
expression   = identifier ( "*" | "+" | "-" ) identifier
constraint   = "int" | "num" | "bool" | "str" | "enum:" enum_list
enum_list    = value ( "," value )*
pool         = "&" identifier "[" value ( "," value )* "]" NEWLINE
body         = ε | record ( NEWLINE record )*
record       = entry ( "," entry )*
entry        = value
             | ":" value          ; deviation override (only inside record lines)
             | identifier ":" value   ; sparse named field (only in ~ bundles)
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
3. Analyze field values across all records to identify arithmetic sequences, computed relationships, delta-compressible fields, internable strings, and modal defaults.
4. Order the fiber: arithmetic fields first, then computed fields, then delta and variable fields (including interned), then defaulted fields (sorted by default frequency descending), then nested fields.
5. **Guard:** If every non-nested field would be classified as arithmetic or default (leaving no variable or delta fields), demote the first field back to variable. This ensures every record has at least one explicit value in the body — otherwise trailing elision would produce empty lines indistinguishable from blank separators.
6. Emit pool declaration lines (`&field[...]`) for each interned field.
7. For each record, emit only non-arithmetic, non-computed, non-default values. Use `:` prefix for default overrides. Elide trailing defaults. For delta fields, emit the absolute value in the first record and the difference from the previous record's value in subsequent records. For interned fields, emit the integer pool index.
8. If the bundle is sparse (>75% of non-arithmetic field values are null/empty and there are ≥8 fields), emit with `~` prefix and use named `field:value` pairs in records.

### 10.2 DHOOM → JSON (Decoding)

1. Parse the fiber header to extract field names, arithmetic generators, defaults, delta markers, and morphism references.
2. Check for the `~` sparse bundle prefix.
3. Parse pool declaration lines (`&field[...]`) to build string pools for interned fields.
4. For each record, map positional values to non-arithmetic, non-computed fields (or parse named `field:value` pairs in sparse mode).
5. Compute arithmetic field values from record ordinal.
6. For interned fields, map the integer index to the corresponding pool value.
7. For computed fields, evaluate the expression using other field values from the same record.
8. For delta fields, accumulate: first record value is absolute; subsequent values are added to the previous record's accumulated value.
9. Fill trailing omitted fields with declared defaults. In sparse mode, fill unlisted fields with `null` (or their default if declared).
10. Interpret `:` prefixed values as default overrides.
11. Assemble the complete JSON object.

### 10.3 Round-Trip Guarantee

DHOOM ↔ JSON conversion is **lossless**. `decode(encode(json))` produces a JSON value semantically identical to the input (modulo whitespace and key ordering in non-array objects).

## 11. Compression Model

For a collection of *N* records with *K* fields, of which *A* are arithmetic and *D* have defaults matching in *M* records:

Let *C* be the number of computed fields.

**Fields omitted** ≥ (*A* × *N*) + (*C* × *N*) + (*D* × *M*)

**Characters saved by interning** ≈ Σ over interned fields: *N* × (avg_string_length − avg_index_digits)

**Optimal field ordering:** Place all *D* defaulted fields at trailing positions to maximize trailing elision.

The format degrades gracefully: for fully heterogeneous data with no arithmetic indices and no repeated values, DHOOM is approximately the size of CSV-with-header (field names declared once, values listed positionally).

## 12. Delta Fields (`^`)

### 12.1 Declaration

```
temp^         →  values are delta-encoded (differences from previous record)
```

The `^` modifier marks a field as **delta-encoded**. The first record contains the absolute (base) value. Each subsequent record contains the difference from the previous record's value.

### 12.2 Semantics

For a delta field at record ordinal *i*:
- *i* = 0: value is the **absolute** value.
- *i* > 0: decoded value = previous decoded value + current delta.

This models **parallel transport along the base space**: each section value is defined relative to its predecessor via a discrete connection.

### 12.3 Example

```
metrics{ts@1000+60, temp^, pressure^}:
22.4, 1013
1, -2
-3, 1
```

Decodes to:

| ts | temp | pressure |
|---|---|---|
| 1000 | 22.4 | 1013 |
| 1060 | 23.4 | 1011 |
| 1120 | 20.4 | 1012 |

### 12.4 Applicability

- A conforming encoder should only emit `^` when all values are numeric (integer or float) and the total character count of deltas is at least 30% shorter than absolute values.
- Delta fields appear in the record body (unlike arithmetic fields which are omitted).
- A field may have at most one modifier; `^` is mutually exclusive with `@`, `|`, `>`, `->`, `&`, `#`, and `!`.

## 13. Sparse Bundles (`~`)

### 13.1 Declaration

```
~name{field1, field2, field3}:
```

The `~` prefix before the bundle name declares **sparse mode**. In sparse mode, records use **named** `field:value` pairs instead of positional values. Only non-null fields need to appear in each record.

### 13.2 Record Format

Each record line contains comma-separated `fieldname:value` pairs:

```
~config{id@1, host, port, timeout, retries, debug, verbose, log_level}:
host:server-a, port:8080
host:server-b, port:9090, debug:T
host:server-c, log_level:warn
```

### 13.3 Missing Fields

Fields not listed in a sparse record receive:
- Their declared **default** value, if the field has a `|` modifier.
- **`null`** otherwise.

Arithmetic fields (`@`) still derive their values from ordinal position regardless of sparse mode.

### 13.4 Applicability

A conforming encoder should consider sparse mode when:
- The bundle has **≥ 8** non-arithmetic fields.
- More than **75%** of non-arithmetic field values across all records are `null` or empty string.

Sparse mode and nested bundles (`>`) may be combined, but nested bundles are emitted inline after the sparse record line, following the same indentation rules as §6.

## 14. Bundle Morphisms (`→`)

### 14.1 Declaration

```
author->users      →  "author" field references records in the "users" bundle
```

The `->` modifier (ASCII representation of →) declares that a field's values reference records in another named bundle. This is a **schema annotation** — it documents the relationship but does not change encoding or decoding behavior.

### 14.2 Example

```
users{id@1, name}:
Alice
Bob
Carol

posts{id@1, author->users, title, likes}:
2, First Post, 42
1, Hello World, 108
3, DHOOM Guide, 256
```

Here `author->users` declares that the `author` field's values (2, 1, 3) are foreign keys referencing records in the `users` bundle.

### 14.3 Semantics

- The `->target` modifier is purely declarative. A conforming decoder treats the field value the same as a plain variable field.
- Morphisms model **bundle morphisms** *(f, g): (E₁, B₁) → (E₂, B₂)* — structure-preserving maps between fiber bundles.
- A field may have at most one modifier; `->` is mutually exclusive with `@`, `|`, `>`, `^`, `&`, `#`, and `!`.

## 15. String Interning (`&`)

### 15.1 Declaration

```
level&        →  values are interned via a string pool
```

The `&` modifier marks a field as **interned**. An interned field uses a string pool: the encoder emits a pool declaration line after the header, and records use compact integer indices instead of full string values.

### 15.2 Pool Declaration

Immediately after the header line (before any record lines), interned fields declare their pool:

```
&fieldname[value0, value1, value2, ...]
```

The pool is an ordered list of distinct string values. Index 0 corresponds to the first value, index 1 to the second, and so on.

Multiple interned fields emit multiple pool lines, one per field.

### 15.3 Example

```
logs{ts@1000+60, level&, msg, source&}:
&level[INFO, WARN, ERROR]
&source[api, db, auth]
0, request completed, 0
2, disk full, 1
0, user connected, 2
1, slow query, 1
```

Decodes to:

| ts | level | msg | source |
|---|---|---|---|
| 1000 | INFO | request completed | api |
| 1060 | ERROR | disk full | db |
| 1120 | INFO | user connected | auth |
| 1180 | WARN | slow query | db |

### 15.4 Applicability

A conforming encoder should consider interning when:
- All values for the field are strings.
- The field has at least **2** distinct values.
- The collection has at least **3** records.
- The total character count using indices is at least **10%** shorter than using full strings.

### 15.5 Geometric Interpretation

Interning models an **associated bundle** construction. The symmetric group acts on the fiber by permuting repeated string values. The pool is the **orbit space** — each orbit (set of identical values) is represented once. The integer index is the canonical representative of the orbit, and the pool line defines the isomorphism between orbit labels and original values.

## 16. Computed Fields (`#`)

### 16.1 Declaration

```
total#price*qty   →  total = price × qty for each record
```

The `#` modifier marks a field as **computed**. The expression after `#` defines how the field's value is derived from other fields in the same record. Computed fields are **omitted** from the record body — like arithmetic fields, they never appear in records.

### 16.2 Supported Expressions

A computed expression is a binary operation between two field names:

```
field#fieldA*fieldB     →  multiplication
field#fieldA+fieldB     →  addition
field#fieldA-fieldB     →  subtraction
```

Operands must reference other fields declared in the same fiber. The operation is evaluated using the decoded numeric values of those fields for each record.

### 16.3 Example

```
orders{id@1, item, price, qty, total#price*qty}:
Widget, 49.99, 2
Gadget, 25.00, 4
Sprocket, 10.00, 10
```

Decodes to:

| id | item | price | qty | total |
|---|---|---|---|---|
| 1 | Widget | 49.99 | 2 | 99.98 |
| 2 | Gadget | 25.00 | 4 | 100.00 |
| 3 | Sprocket | 10.00 | 10 | 100.00 |

The `total` column vanishes entirely from the serialized records. The decoder reconstructs it by evaluating `price * qty` for each record.

### 16.4 Applicability

A conforming encoder should consider computed fields when:
- A field's values are all numeric.
- The field's values **exactly** equal the result of a binary operation on two other numeric fields in the same record, across **all** records.
- The collection has at least **3** records.

Only the operations `*`, `+`, and `-` are required by conforming implementations. Division is omitted to avoid floating-point precision issues.

### 16.5 Geometric Interpretation

Computed fields model **sheaf sections** — global assignments that are entirely determined by local data. The expression defines a section of the sheaf of functions over the base space. Since the section is fully determined by the restriction map (the formula), transmitting it would be redundant. The formula is the **descent datum**: it tells the decoder how to reconstruct the global section from the local sections already present.

## 17. Inline Constraints (`!`)

### 17.1 Declaration

```
age!int           →  age values must be integers
score!num         →  score values must be numeric
active!bool       →  active values must be boolean
role!enum:admin,editor,viewer  →  role must be one of the listed values
```

The `!` modifier declares a **type constraint** on a field. Constraints are **metadata only** — they do not change encoding or decoding behavior. The field's values still appear in records as normal variable fields.

### 17.2 Constraint Types

| Constraint | Meaning |
|---|---|
| `!int` | All values must be integers |
| `!num` | All values must be numeric (integer or float) |
| `!bool` | All values must be boolean (`T`/`F`) |
| `!str` | All values must be strings |
| `!enum:v1,v2,...` | Values must be one of the listed options |

### 17.3 Semantics

- The `!` modifier is purely declarative. A conforming decoder treats the field value the same as a plain variable field.
- Decoders **may** validate values against declared constraints and emit warnings, but **must not** reject valid DHOOM documents based solely on constraint violations.
- Constraints model **section conditions** — restrictions on the allowed sections of the fiber bundle, defining a sub-sheaf of the full sheaf of sections.
- A field may have at most one modifier; `!` is mutually exclusive with `@`, `|`, `>`, `^`, `->`, `&`, and `#`.

### 17.4 Example

```
users{id@1, name!str, age!int, active!bool, role!enum:admin,editor,viewer}:
Alice, 30, T, admin
Bob, 25, T, editor
Carol, 28, F, viewer
```

Decodes identically to the same document without constraints — the `!` annotations are informational.

## 18. Comparison to Prior Art

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
| String interning | ✗ | ✗ | ✗ | ✗ | **✓** |
| Computed fields | ✗ | ✗ | ✗ | ✗ | **✓** |
| Inline constraints | ✗ | ✗ | ✗ | ✗ | **✓** |
| Value integrity | ✓ | ✓ | ✓ | ✓ | **✓** |
| Lossless JSON round-trip | — | ✗ | ✓ | ✓ | **✓** |

## 19. References

- Steenrod, N. (1951). *The Topology of Fibre Bundles*. Princeton University Press.
- Crockford, D. (2006). RFC 4627: The application/json Media Type.
- Bray, T. (2017). RFC 8259: The JSON Data Interchange Format.
- Shafranovich, Y. (2005). RFC 4180: Common Format and MIME Type for CSV Files.
- Davis, B. R. (2024). *The Geometry of Sameness*. Amazon KDP.
- Davis, B. R. (2026). *The Double Cover Principle*. Zenodo.

---

**DHOOM** · Davis Human-readable Optimized Object Markup · Davis Geometric · 2026
