# train-lora

LoRA fine-tune of `qwen2.5-coder-32b` on Code4rena audit reports.

Target: structured-JSON audit output schema as defined in [`../../docs/08-hero-agent.md`](../../docs/08-hero-agent.md) §4.2.

## Files (planned)

- `scrape.py` — scrape Code4rena public report repos, align contract source ↔ findings
- `format.py` — convert into `(prompt, completion)` JSONL pairs
- `train.py` — PEFT LoRA train loop (rank 16, ~2k samples, ~1h on 1×H100)
- `encrypt.py` — AES-GCM encrypt the safetensors + write the sealed-key request blob
- `upload.py` — push encrypted blob to 0G Storage

Config goes in `config.yaml` once we pick hyperparams.
