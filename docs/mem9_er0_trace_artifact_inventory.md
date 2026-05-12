# mem9 ER0 Trace Artifact Inventory

Date: 2026-05-12T00:10:32Z

Mode: diagnostic artifact inventory only. This is not a benchmark score comparison and does not claim a performance improvement.

## Clean Lineage

| Artifact | Path | Evidence |
| --- | --- | --- |
| diagnostic directory | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace | timestamped clean rebuild for accepted mem0-style settings |
| clean ingest cache | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/cache/clean-ingest-cache.json | created_at=2026-05-11T06:28:28.022Z; protocol=mem0-style; answer_prompt=mem0-speaker; speaker_top_k=10; combined_limit=20; ingest_mode=session; speaker_ingest_mode=batch2 |
| predict-only result | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/results/predict-only.json | rows=1986; llm_judge=off; generated from clean backend |
| predict-only unified result | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/results/predict-only.unified.json | normal unified conversion of predict-only output |
| server traces | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/server-traces | trace_files=3972; expected=3972 for mem0-style speaker A/B recall |
| stored memory export | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/stored_memories.json | stored_memories=7796 across 10 samples and 20 speaker scopes; source seq mapping is zero-based per ingest.ts; comma/semicolon evidence IDs are regex-extracted for attribution |
| source dialogue metadata | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/source_dialogue_metadata.json | dia_id/zero-based seq/speaker/date mapping from locomo10.json |
| trace manifest | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/trace_manifest.json | one compact row per trace file; full raw candidate files remain in server-traces/ |
| classification rows | /home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/er0_attribution_v2_rows.json | classified_rows=235 |

## Artifact Hashes

| Artifact | SHA256 |
| --- | --- |
| accepted_result | bed27caa5c9f6cb93b8681404dcb6897b23f5e2bd919141342265b3012812026 |
| predict_only_result | 896d24219df771a2c0b512d00382183bd8afe4b665d67d26a836ede2c5e3cf01 |
| predict_only_unified | 186bbbe51eda86fe82d18d8a8808f39417f0f93fa2e4a2297db8a5273776855f |
| cache_file | b41a1290de80563792b691e69540f5d0238e753ac8412546e8c43956e79bf929 |

## Trace Coverage

The clean capture produced 3972 trace files for 1986 predict-only rows. Under mem0-style retrieval the benchmark issues one server recall per speaker scope, so the expected count is 3972.


## Trust And Gaps
- Trusted: clean cache file under the diagnostic directory, predict-only result, per-request trace files, stored-memory export from the live diagnostic backend, and source dialogue metadata from `locomo10.json`.
- Not used as authority: the suspicious repo-local `last-ingest-cache.json` and the abandoned earlier diagnostic attempt with wrong lineage.
- Remaining gap: this is a clean rebuild, not the exact accepted baseline database snapshot. Rows where the clean rebuild final context contains an accepted ER0 gold dia_id are marked as non-reproduced risk.
