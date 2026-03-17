# DHOOM Benchmarks

## Methodology

Following [TOON's benchmark methodology](https://github.com/toon-format/toon), we measure:

1. **Character count** — raw string length of encoded data
2. **Token count** — using GPT-4o's `o200k_base` tokenizer via `tiktoken`
3. **LLM retrieval accuracy** — structured questions against encoded data across multiple models

### Datasets

| Dataset | Records | Fields | Arithmetic | Defaults | Expected DHOOM Advantage |
|---|---|---|---|---|---|
| Customer reviews | 3 | 5 | 1 (id) | 2 (rating, verified) | ~67% vs JSON |
| Sensor readings | 3 | 5 | 2 (id, timestamp) | 2 (unit, status) | ~75% vs JSON |
| User profiles | 3 | 5 | 1 (id) | 1 (active) | ~58% vs JSON |
| Nested order | 1 | 5+4+2 | 0 | 0 | ~34% vs JSON |
| API response | 3 | 5 | 1 (id) | 1 (published) | ~54% vs JSON |

### Running Benchmarks

```bash
# Character count comparison
node benchmarks/char-count.js

# Token count comparison (requires tiktoken)
python benchmarks/token-count.py

# LLM accuracy (requires API keys)
python benchmarks/llm-accuracy.py
```

## Results

See [README.md](../README.md#benchmarks) for current results.
