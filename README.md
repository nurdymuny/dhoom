# DHOOM

**Davis Human-readable Optimized Object Markup**

[![SPEC v0.5](https://img.shields.io/badge/spec-v0.5-E8A830?labelColor=1b1b1f)](SPEC.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-E8A830?labelColor=1b1b1f)](LICENSE)

**DHOOM** is a compact, human-readable serialization format that applies fiber bundle geometry to structured data. It encodes the same data model as JSON — objects, arrays, strings, numbers, booleans, null — but eliminates structural redundancy by exploiting arithmetic indices, modal defaults, and positional encoding.

Think of it as what happens when a differential geometer looks at JSON and says: *"you're transmitting the fiber with every section."*

## Table of Contents

- [DHOOM](#dhoom)
  - [Table of Contents](#table-of-contents)
  - [Why DHOOM?](#why-dhoom)
  - [Quick Example](#quick-example)
  - [How It Works](#how-it-works)
  - [When to Use DHOOM](#when-to-use-dhoom)
  - [When Not to Use DHOOM](#when-not-to-use-dhoom)
  - [Benchmarks](#benchmarks)
    - [Character Count Comparison](#character-count-comparison)
    - [Token Count (GPT-4o tokenizer, o200k\_base)](#token-count-gpt-4o-tokenizer-o200k_base)
    - [LLM Retrieval Accuracy (209 questions, Claude Sonnet)](#llm-retrieval-accuracy-209-questions-claude-sonnet)
  - [Notation Reference](#notation-reference)
  - [v0.4 Features](#v04-features)
    - [Delta Fields (`^`) — Temporal Compression](#delta-fields---temporal-compression)
    - [Sparse Bundles (`~`) — Wide Table Compression](#sparse-bundles---wide-table-compression)
    - [Bundle Morphisms (`->`) — Cross-Bundle References](#bundle-morphisms----cross-bundle-references)
  - [v0.5 Features](#v05-features)
    - [String Interning (`&`) — Associated Bundles](#string-interning---associated-bundles)
    - [Computed Fields (`#`) — Sheaf Sections](#computed-fields---sheaf-sections)
    - [Inline Constraints (`!`) — Section Conditions](#inline-constraints---section-conditions)
  - [More Examples](#more-examples)
    - [Sensor Readings (80% reduction)](#sensor-readings-80-reduction)
    - [Nested Objects](#nested-objects)
    - [API Response](#api-response)
  - [Implementations](#implementations)
  - [Contributing](#contributing)
  - [The Geometry](#the-geometry)
  - [License](#license)

## Why DHOOM?

JSON repeats field names on every record. TOON factors them into a header. DHOOM goes further — it identifies and quotients out **all** structural redundancy:

| What's redundant | JSON | TOON | DHOOM |
|---|---|---|---|
| Field names | Repeated N times | Header once | Header once |
| Sequential IDs | Listed every record | Listed every record | `@start` — derived from position |
| Constant fields | Repeated N times | Repeated N times | `\|default` — declared once |
| Common values | Repeated M times | Repeated M times | `\|default` — silence means agreement |
| Trailing defaults | Always listed | Always listed | **Elided** — parser fills in |
| Nested names | Repeated in child | Repeated in child | `>` — inherited from parent |
| Large absolute values | Repeated verbatim | Repeated verbatim | `^` — delta-encoded differences |
| Sparse wide tables | All nulls listed | All nulls listed | `~` — named pairs, nulls omitted |
| Cross-bundle refs | No schema support | No schema support | `->` — declared morphisms |
| Repeated strings | Repeated M times | Repeated M times | `&` — string pool, integer indices |
| Derivable fields | Repeated N times | Repeated N times | `#` — computed from other fields |
| Type metadata | External schema | External schema | `!` — inline constraints |

**The principle:** don't transmit what the receiver can derive.

## Quick Example

**JSON** (412 chars minified):
```json
{"reviews":[{"id":101,"customer":"Alex Rivera","rating":5,"comment":"Excellent!","verified":true},{"id":102,"customer":"Brij Pandey","rating":5,"comment":"Game changer!","verified":true},{"id":103,"customer":"Casey Lee","rating":3,"comment":"Average","verified":false}]}
```

**TOON** (~210 chars):
```
reviews[3]{id, customer, rating, comment, verified}:
  101, Alex Rivera, 5, Excellent!, true
  102, Brij Pandey, 5, Game changer!, true
  103, Casey Lee, 3, Average, false
```

**DHOOM** (~137 chars):
```
reviews{id@101, customer, comment, rating|5, verified|T}:
Alex Rivera, Excellent!
Brij Pandey, Game changer!
Casey Lee, Average, :3, :F
```

Records 1 and 2 transmit **two fields each** out of five. The ID is derived from position. The rating and verified status match their defaults — silence. Record 3 deviates on both, marked with `:`.

## How It Works

DHOOM treats every data collection as a **fiber bundle**:

```
                    FIBER (schema)
                   ┌──────────────────────────┐
                   │ id@101                    │  ← arithmetic, derived
                   │ customer                  │  ← variable, always sent
                   │ comment                   │  ← variable, always sent
                   │ rating|5                  │  ← default, silence = 5
                   │ verified|T                │  ← default, silence = true
                   └──────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
     BASE POINT 0       BASE POINT 1       BASE POINT 2
      (id=101)           (id=102)           (id=103)
           │                  │                  │
           ▼                  ▼                  ▼
   ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐
   │ Alex Rivera,  │ │ Brij Pandey,  │ │ Casey Lee, Average,   │
   │ Excellent!    │ │ Game changer! │ │ :3, :F                │
   └───────────────┘ └───────────────┘ └───────────────────────┘
    SECTION (record)   SECTION (record)   SECTION (with deviations)
```

Seven compression principles:

| Symbol | Principle | What it does |
|---|---|---|
| `@` | **Base compression** | Sequential/arithmetic fields derived from position |
| `\|` | **Modal defaults** | Most common value declared once; records stay silent |
| `:` | **Deviation marking** | Colon prefixes values that override the default |
| *(trailing elision)* | **Silence = agreement** | Trailing default fields just stop. Parser fills in. |
| `^` | **Delta encoding** | Store differences, not absolutes. Parallel transport. |
| `~` | **Sparse bundles** | Named pairs for wide tables; nulls vanish. |
| `->` | **Bundle morphisms** | Declared foreign-key relationships between bundles. |
| `&` | **String interning** | Pool repeated strings; records use integer indices. |
| `#` | **Computed fields** | Derived from other fields; omitted from records. |
| `!` | **Inline constraints** | Type/validation annotations; metadata only. |

## When to Use DHOOM

- **LLM prompts**: Fewer tokens, same data. DHOOM's structural compression directly reduces token count.
- **IoT / sensor data**: Timestamps are arithmetic, units are constant, status is mostly "normal." DHOOM shines.
- **API responses**: Homogeneous arrays of records with shared schema.
- **Log shipping**: Structured logs with common fields and occasional deviations.
- **Config files**: Nested objects with shared defaults.

## When Not to Use DHOOM

- **Deeply nested, non-uniform data**: If every record has different fields, DHOOM degrades to ~CSV size. Use JSON.
- **Binary data**: DHOOM is text-only. Use Protobuf/MessagePack for binary.
- **Ecosystem lock-in**: If your tooling requires JSON, use JSON and convert at the boundary.

## Benchmarks

### Character Count Comparison

| Example | JSON | TOON | DHOOM | vs JSON | vs TOON |
|---|---|---|---|---|---|
| Customer Reviews (3 records, 5 fields) | 270 | 171 | 135 | **-50%** | **-21%** |
| Sensor Readings (3 records, 5 fields) | 292 | 183 | 110 | **-62%** | **-40%** |
| User Profiles (3 records, 5 fields) | 277 | 192 | 156 | **-44%** | **-19%** |
| Nested Order (1 order, 2 items, shipping) | 244 | 198 | 193 | **-21%** | **-3%** |
| API Response (3 posts, nested) | 259 | 168 | 140 | **-46%** | **-17%** |

DHOOM's advantage scales with **structural regularity**. The sensor example achieves 62% character reduction because 4 of 5 fields per record are derived or defaulted. Even the worst case (nested data with minimal regularity) still beats both JSON and TOON by exploiting recursive arithmetic compression.

### Token Count (GPT-4o tokenizer, o200k_base)

| Example | JSON tokens | TOON tokens | DHOOM tokens | vs JSON | vs TOON |
|---|---|---|---|---|---|
| Customer Reviews | 74 | 59 | 42 | **-43%** | **-29%** |
| Sensor Readings | 93 | 79 | 45 | **-52%** | **-43%** |
| User Profiles | 80 | 63 | 47 | **-41%** | **-25%** |
| Nested Order | 82 | 77 | 76 | **-7%** | **-1%** |
| API Response | 81 | 69 | 55 | **-32%** | **-20%** |

*Measured via tiktoken o200k_base. Minified JSON (`separators=(",",":")`).*

### LLM Retrieval Accuracy (209 questions, Claude Sonnet)

| Format | Accuracy | Correct / Total |
|---|---|---|
| JSON | **100.0%** | 209/209 |
| DHOOM | **100.0%** | 209/209 |
| TOON | 99.5% | 208/209 |

| Dataset | JSON | TOON | DHOOM |
|---|---|---|---|
| Customer Reviews | 42/42 | 42/42 | 42/42 |
| Sensor Readings | 42/42 | 42/42 | 42/42 |
| User Profiles | 42/42 | 42/42 | 42/42 |
| Nested Order | 42/42 | 42/42 | 42/42 |
| API Response | 41/41 | 40/41 | 41/41 |

*209 structured retrieval questions (Direct Lookup, Reverse Lookup, Cross-field, Count, List, Aggregate, Existence, Filter, Boolean, Nested) across 5 datasets. Model: Claude Sonnet (temperature=0). DHOOM prompts include a concise format guide describing fiber bundle decoding rules.*

**Key finding:** DHOOM achieves **100% LLM retrieval accuracy** — matching JSON exactly — while using **40-62% fewer tokens**. Same comprehension, far less data. DHOOM actually outperforms TOON (99.5%) because the fiber bundle structure makes the schema-to-data relationship explicit.

## Notation Reference

| Syntax | Meaning |
|---|---|
| `name{fields}:` | Collection/object with inline fiber (schema) |
| `field@start` | Sequential — value derived from position |
| `field@start+step` | Arithmetic — start, start+step, start+2·step, ... |
| `field\|default` | Modal default — omitted when record matches |
| `field>` | Nested sub-bundle (child inherits name) |
| `field^` | Delta-encoded — differences from previous record |
| `field->target` | Morphism — foreign key referencing another bundle |
| `field&` | Interned — string pool, integer indices in records |
| `field#expr` | Computed — derived from other fields, omitted from records |
| `field!constraint` | Constraint — type annotation (`!int`, `!str`, `!enum:a/b`) |
| `~name{fields}:` | Sparse bundle — records use `name:value` pairs |
| `:` (after header) | Schema → data separator |
| `:value` (in record) | Default override — this field deviates |
| newline | Record boundary |
| `,` | Field separator |
| `T` / `F` | Boolean shorthand |

## v0.4 Features

### Delta Fields (`^`) — Temporal Compression

When numeric values have large absolute magnitudes but small changes between records, delta encoding transmits only the differences:

```
events{name, ts^}:
Alice, 1000000
Bob, 50
Carol, 70
```

The first record is absolute (`ts=1000000`). Subsequent records store deltas: Bob's timestamp is `1000000 + 50 = 1000050`, Carol's is `1000050 + 70 = 1000120`.

Mathematically, this is **parallel transport along the base space** — each section value is defined relative to its predecessor via a discrete connection.

### Sparse Bundles (`~`) — Wide Table Compression

When a bundle has many fields but most values are null, sparse mode switches from positional to named encoding:

```
~config{id@1, host, port, timeout, retries, debug, verbose, log_level}:
host:server-a, port:8080
host:server-b, port:9090, debug:T
host:server-c, log_level:warn
```

Only non-null fields appear. Missing fields get `null` (or their declared default). This models **sub-bundle encoding** — projecting to the non-trivial fiber components.

### Bundle Morphisms (`->`) — Cross-Bundle References

```
users{id@1, name}:
Alice
Bob

posts{id@1, author->users, title, likes}:
2, First Post, 42
1, Hello World, 108
```

`author->users` declares that the `author` field references records in the `users` bundle — a foreign key. This is a **schema annotation only**; values are decoded normally. Morphisms model **bundle morphisms** *(f, g): (E₁, B₁) → (E₂, B₂)* — structure-preserving maps between fiber bundles.

## v0.5 Features

### String Interning (`&`) — Associated Bundles

When a string field has many repeated values, interning replaces the strings with integer indices into a pool:

```
orders{id@1, status&}:
&status[completed, pending, failed]
1, 0
2, 1
3, 2
```

The pool line `&status[completed, pending, failed]` declares the vocabulary. Records use `0`, `1`, `2` instead of the full strings. The decoder resolves indices back to strings.

Mathematically, this models an **associated bundle** — the pool defines a discrete fiber, and each record's index is a section of that fiber.

### Computed Fields (`#`) — Sheaf Sections

When a field's value can be derived from other fields, the `#` modifier declares the expression:

```
items{price, qty, total#price*qty}:
10, 3
20, 5
```

`total` is **omitted from records** — the decoder computes it: `10*3=30`, `20*5=100`. Supported operators: `+`, `-`, `*` between field names.

This models **sheaf sections** — the computed field is a global section determined by a transition rule over the other fibers.

### Inline Constraints (`!`) — Section Conditions

The `!` modifier attaches type or validation metadata to a field:

```
users{name!str, age!int, role!enum:admin/editor/viewer}:
Alice, 30, admin
Bob, 25, viewer
```

Constraints are **metadata only** — they don't change encoding or decoding. Available types: `!int`, `!num`, `!bool`, `!str`, `!enum:val1/val2/...` (uses `/` as separator).

This models **section conditions** — constraints on which sections are admissible over the fiber.

## More Examples

### Sensor Readings (80% reduction)

```
readings{sensor_id@T-001, timestamp@1710000000+60, value, status|normal, unit|celsius}:
22.4
23.1
45.8, :alert
```

Records 1-2: **one field each** out of five. Everything else is structure.

### Nested Objects

```
order{id, customer, total, items>, shipping>}:
ORD-7891, Diana Prince, 149.99,
  {sku@A100, name, qty, price}:
  Widget, 2, 49.99
  Gadget, 1, 50.01,
  {method, address}:
  express, 1234 Elm St
```

The nested `items` bundle applies arithmetic compression (`sku@A100`) recursively — the full grammar works at every depth.

### API Response

```
{status, data>}:
200,
  posts{id@1, author, title, likes, published|T}:
  jpark, Intro to DHOOM, 42
  beedavis, Fiber Bundles for Data, 108
  jpark, Draft: Part 3, :0, :F
```

## Implementations

| Language | Package | Status |
|---|---|---|
| TypeScript | `@dhoom-format/dhoom` | ✅ v0.5.0 — 83/83 tests |
| Rust | `dhoom` | ✅ v0.5.0 — 35/35 tests |
| Python | `dhoom` | ✅ v0.5.0 — 64/64 tests |
| Go | `dhoom-go` | ✅ v0.5.0 |
| .NET (C#) | `Dhoom` | ✅ v0.5.0 — 48/48 tests |
| Java | `dev.dhoom` | ✅ v0.4.0 |
| CLI | `@dhoom-format/cli` | ✅ v0.4.0 |

## Contributing

Contributions welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Priority areas:
- Multi-model LLM benchmarks (GPT-4o, Gemini)
- Additional edge case test suites
- Formal specification review

## The Geometry

For those who want the full story: DHOOM is derived from fiber bundle theory in differential geometry. Every homogeneous data collection admits a decomposition as a fiber bundle *(F, E, B, π)* — the schema is the fiber *F*, the index set is the base space *B*, the total space *E* is the set of all records, and each record is a section *σ: B → E*. The `|` default defines a **zero section** *σ₀*, and records encode only their **deviations** from *σ₀*. The `@` modifier compresses the base space when it has arithmetic structure. Trailing elision lets silence encode agreement.

These bundles are always **trivial** — every record shares the same fiber, so *E ≅ B × F* globally. The geometric insight is not in the topology (there are no non-trivial transition functions or characteristic classes) but in the **choice of coordinates on the trivial bundle**: ordering fields and choosing a zero section to minimize each section's expression. Placing defaults at trailing positions maximizes elision — a coordinate choice on the fiber that directly reduces serialized size without affecting logical content.

v0.5 extends the geometric framework with three additional operations: **associated bundles** (`&` interning — the string pool defines a discrete fiber, records are sections of the associated bundle), **sheaf sections** (`#` computed — fields determined by transition rules over other fibers), and **section conditions** (`!` constraints — admissibility restrictions on sections).

For the mathematical framework, see:
- Davis, B. R. (2024). *The Geometry of Sameness*. Amazon KDP.
- Davis, B. R. (2026). *The Double Cover Principle*. Zenodo.

## License

[MIT](LICENSE)

---

**DHOOM** · Davis Human-readable Optimized Object Markup · [Davis Geometric](https://davisgeometric.com) · 2026
