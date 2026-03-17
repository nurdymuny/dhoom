# Contributing to DHOOM

Thank you for your interest in contributing to DHOOM.

## How to Contribute

### Specification

The DHOOM specification lives in [SPEC.md](SPEC.md). If you find ambiguities, edge cases, or errors, please open an issue with the `spec` label.

### Implementations

Reference implementations are in `packages/`. Each implementation must:

1. Pass the full test suite in `benchmarks/test-cases/`
2. Support lossless JSON ↔ DHOOM round-trips
3. Handle all modifiers (`@`, `|`, `>`, `^`, `~`, `->`, `&`, `#`, `!`)
4. Implement trailing elision correctly

### Benchmarks

Benchmark contributions should follow the methodology in `benchmarks/README.md`. We measure:

- Character count (raw string length)
- Token count (GPT-4o o200k_base tokenizer)
- LLM retrieval accuracy (structured questions against encoded data)

### Code Style

- Rust: `cargo fmt` + `cargo clippy`
- TypeScript: ESLint + Prettier
- Python: Black + Ruff

### Pull Requests

1. Fork the repo
2. Create a feature branch
3. Write tests
4. Open a PR against `main`

## Code of Conduct

Be kind. Be constructive. Respect the math.
