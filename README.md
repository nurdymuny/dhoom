# DHOOM

**Davis Human-readable Optimized Object Markup**

[![SPEC v0.3](https://img.shields.io/badge/spec-v0.3-E8A830?labelColor=1b1b1f)](SPEC.md)
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

Four compression principles:

| Symbol | Principle | What it does |
|---|---|---|
| `@` | **Base compression** | Sequential/arithmetic fields derived from position |
| `\|` | **Modal defaults** | Most common value declared once; records stay silent |
| `:` | **Deviation marking** | Colon prefixes values that override the default |
| *(trailing elision)* | **Silence = agreement** | Trailing default fields just stop. Parser fills in. |

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
| `:` (after header) | Schema → data separator |
| `:value` (in record) | Default override — this field deviates |
| newline | Record boundary |
| `,` | Field separator |
| `T` / `F` | Boolean shorthand |

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
| TypeScript | `@dhoom-format/dhoom` | ✅ v0.3.0 |
| Rust | `dhoom` | ✅ v0.3.0 |
| Python | `dhoom` | ✅ v0.3.0 — 42/42 tests |
| Go | `dhoom-go` | ✅ v0.3.0 |
| .NET (C#) | `Dhoom` | ✅ v0.3.0 — 30/30 tests |
| Java | `dev.dhoom` | ✅ v0.3.0 — 31/31 tests |
| CLI | `@dhoom-format/cli` | ✅ v0.3.0 |

## Contributing

Contributions welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Priority areas:
- Multi-model LLM benchmarks (GPT-4o, Gemini)
- Additional edge case test suites
- Formal specification review

## The Geometry

For those who want the full story: DHOOM is derived from fiber bundle theory in differential geometry. Every homogeneous data collection admits a decomposition as a fiber bundle *(F, E, B, π)* — the schema is the fiber *F*, the index set is the base space *B*, the total space *E* is the set of all records, and each record is a section *σ: B → E*. The `|` default defines a **zero section** *σ₀*, and records encode only their **deviations** from *σ₀*. The `@` modifier compresses the base space when it has arithmetic structure. Trailing elision lets silence encode agreement.

These bundles are always **trivial** — every record shares the same fiber, so *E ≅ B × F* globally. The geometric insight is not in the topology (there are no non-trivial transition functions or characteristic classes) but in the **choice of coordinates on the trivial bundle**: ordering fields and choosing a zero section to minimize each section's expression. Placing defaults at trailing positions maximizes elision — a coordinate choice on the fiber that directly reduces serialized size without affecting logical content.

For the mathematical framework, see:
- Davis, B. R. (2024). *The Geometry of Sameness*. Amazon KDP.
- Davis, B. R. (2026). *The Double Cover Principle*. Zenodo.

## License

[MIT](LICENSE)

---

**DHOOM** · Davis Human-readable Optimized Object Markup · [Davis Geometric](https://davisgeometric.com) · 2026
