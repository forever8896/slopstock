# corpus

RAG corpus for `auditor.stratum.eth`. Encrypted before upload to 0G Storage.

## Sources

- ConsenSys SCSVS / SWC vulnerability descriptions
- Recent post-training EIPs (e.g. EIP-7702, ERC-7857 itself)
- Selected OpenZeppelin issue tracker excerpts

## Files (planned)

- `build.py` — pull from sources, dedupe, format
- `embed.py` — chunk + embed with `text-embedding-3-small` (or local equivalent)
- `encrypt.py` — AES-GCM with the agent's `k_content`
- `upload.py` — push to 0G Storage

Target size: ~5MB encrypted.
