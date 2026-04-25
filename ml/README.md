# Stratum ML

Hero agent training pipeline for `auditor.stratum.eth`.

Spec: [`../docs/08-hero-agent.md`](../docs/08-hero-agent.md).

## Subdirectories

| Path | Purpose |
|---|---|
| `train-lora/` | LoRA training over Code4rena reports → audit-LoRA-v1.safetensors |
| `corpus/` | RAG corpus build (vulnerability patterns, EIPs, OZ issues) — encrypted before upload |
| `eval/` | Holdout eval harness, false-positive checks |

## Pipeline

```
1. corpus/build.py      → corpus.tar
2. corpus/encrypt.py    → corpus.tar.enc + key blob
3. corpus/upload.py     → 0G Storage URI
4. train-lora/scrape.py → dataset.jsonl from Code4rena
5. train-lora/train.py  → audit-lora-v1.safetensors
6. eval/run.py          → metrics.json
7. train-lora/encrypt.py + upload.py → 0G Storage URI
```

## Status

Stubs only. The team has a fallback path (base model + system prompt + RAG, no LoRA) — see hero-agent doc §10.
