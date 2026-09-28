# Source context refinements

Smart extraction now sends existing structured message sequence numbers to the model and accepts bounded `source_seqs` references in the same extraction call. The server validates references against the current batch, permitted source roles, uniqueness, visible prompt content, and a six-reference limit. Source text is rebuilt from the input messages; model-supplied `source_turns` are never trusted. Unnumbered legacy input keeps its original prompt format and lexical fallback.

Source tokenization keeps accented Latin words intact. Historical `[session_timestamp:...]`, `[timestamp:...]`, and ISO `[date:...]` headers can anchor relative dates. References select the relevant source timestamps even when fact text was translated. Reconciliation retains an unchanged fact's temporal metadata or derives it from matched source turns. Conflicting historical dates do not silently fall back to the current date. Unanchored real-time facts retain the existing current-date behavior. Spanish day and past/next weekday expressions are supported conservatively; ambiguous expressions retain their wording.

Second-hop results use memory ID as a deterministic tie-break when similarity scores are equal. Query similarity and second-hop seed similarity otherwise keep their existing scoring behavior.

## Bounded Spanish recall context

For Spanish questions, selected session records may include already-fetched, immediately adjacent turns of the opposite role. Application, agent, session, and sequence must match. The selected record must overlap a substantive question token; bare acknowledgments and already-selected neighbors are skipped. This adds no database or model calls and preserves selected IDs, scores, ordering, and count. Assistant evidence retains its role label.

Session and insight snippets share the existing limits: at most 800 runes per fragment and 2400 additional runes per response, including role labels and delimiters. The source metadata and database records are not mutated by response assembly. `MEM9_SOURCE_TURN_MIN_SCORE`, `MEM9_SOURCE_TURN_PER_MEMORY_LIMIT`, and `MEM9_SOURCE_TURN_TOTAL_LIMIT` continue to apply.

Explicit Spanish overview questions use session diversity only among already-eligible candidates within six confidence points of the next best candidate. They keep the general-query confidence threshold and candidate/response budgets. They do not enable the larger enumeration fetch policy. Other Spanish fact questions, English questions, and Chinese questions retain their previous selection policy.

## Validation and experiment boundaries

- Synthetic tests exercise translated source references, invalid/duplicate/out-of-scope IDs, excluded roles, prompt truncation, historical versus real-time dates, same-day and conflicting anchors, application/agent isolation, shared snippet budgets, deterministic second-hop ordering, and unchanged English/Chinese recall paths.
- Run `make vet` and `make test` at the repository root; use `make build` for the server binary.
- Retrieval replay can assess ordering and response assembly on an existing corpus. It cannot validate newly extracted provenance or temporal facts: those changes require fresh ingestion in isolated spaces.
- Freeze the answer/judge models, extraction model, embedding model, prompts, query set, `top_k`, and service build while comparing results. Record gains and regressions as well as overall accuracy and retrieval latency.
- No benchmark accuracy improvement is implied by unit tests. End-to-end score and performance acceptance require a separate measured run.
