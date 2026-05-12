# mem9 Final-Selection Provenance Rescue Replay

Date: 2026-05-12T01:05:49Z

Mode: offline replay only. No production code, benchmark scoring, answer prompt, harness rule, ingest, storage, reconciliation, candidate admission, or context-size change is made by this artifact.

## Executive Summary

The approved final-selection provenance rescue was replayed over the clean trace directory `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace`. The replay uses only archived server `ranked_candidates` and `selected_candidates`; question id, category, gold labels, and LoCoMo-specific metadata are used only after replay to score movement.

Result: **42 safe rows improved**, **4 risk rows were affected by a replacement**, **0 risk rows gained target-gold evidence**, **119 rows stayed target-neutral**, and **0 rows regressed target-gold coverage** across the 161 retrieved-but-not-selected target rows. This clears the implementation gate of `>=8` safe rows with `<=4` affected risk rows.

GO / NO-GO for implementation: **GO**, limited to the same final-selection rule and the guardrails below.

## Exact Replay Rule

For each individual speaker recall trace, the replay performs at most one replacement after the archived server ranking and current final selection:

1. Start from archived `ranked_candidates` and archived `selected_candidates`. No raw, lexical, BM25, entity, date, source-tail, or external candidate is admitted.

2. Candidate eligibility: candidate is already in `ranked_candidates`; candidate is not already selected; ranked position is `<=100`; `confidence >= 65`; candidate has explicit source provenance through `evidence_keys`, `metadata.seq`, `metadata.source_seqs`, `metadata.source_turns`, or equivalent source dialogue id metadata; candidate adds at least one provenance key not already represented by selected memories.

3. Candidate query alignment: candidate must have at least one normalized query token in its content or source-turn text, or must have `confidence >= 95` with both existing `in_vector` and `in_keyword` trace flags. This is not candidate admission; it is only a tie-break among already ranked candidates.

4. Candidate ordering: choose the highest replay score among eligible candidates: `normalized_query_coverage * 1000 + confidence * 5 + 50 if both existing vector and keyword hit - ranked_position`.

5. Replacement eligibility: replace at most one selected memory. A selected memory is protected if it contributes at least two unique normalized query tokens, or if it has at least as much query coverage as the candidate, has unique query coverage, and is not materially weaker in confidence.

6. Victim choice: from unprotected selected memories, remove the weakest item by `(unique_query_coverage * 1000 + query_coverage * 100 + confidence)`. Returned count remains fixed.

7. Evaluation only: after the replacement is simulated, gold/stored memory ids from the attribution artifact are used only to classify improved, neutral, risk, or regressed rows. They are never used by the replay rule.

## Dirty State Classification Before Replay

| File | Classification | Score-affecting by default? | Action |
| --- | --- | --- | --- |

| `server/internal/handler/recall.go` | trace-only diagnostic hooks from prior prompt | No when `MNEMO_RECALL_TRACE_DIR` is unset | Keep isolated; candidate implementation diff must be separate. |

| `server/internal/handler/recall_trace.go` | trace-only diagnostic helper | No when `MNEMO_RECALL_TRACE_DIR` is unset | Keep for predict-only validation only. |

| `docs/*` | documentation | No | Keep as evidence trail. |


Trace mode is default-off because trace output is gated by `MNEMO_RECALL_TRACE_DIR`; the replay reads archived JSON and does not enable server tracing.

## Replay Counts

| Metric | Rows |
| --- | ---: |
| Target rows replayed | 161 |
| Improved rows | 42 |
| Risk rows affected by any replacement | 4 |
| Risk rows gaining target-gold evidence | 0 |
| Risk rows total | 4 |
| Neutral rows | 119 |
| Regressed rows | 0 |

## Count By Category For Improved Rows

| Value | Rows |
| --- | ---: |
| 4 | 36 |
| 1 | 6 |

## Count By Speaker Bucket For Improved Rows

| Value | Rows |
| --- | ---: |
| speaker_a_only | 22 |
| speaker_b_only | 17 |
| mixed | 3 |

## Count By Ranking Subtype For Improved Rows

| Value | Rows |
| --- | ---: |
| B. Evidence ranked below final top-k due to score composition | 17 |
| C. Evidence memory is suppressed by final selection despite top-10 rank | 8 |
| E. Evidence loses to temporally nearby distractors | 6 |
| F. Query terms do not align with stored summary content | 6 |
| D. Evidence loses to wrong-speaker competitors | 5 |

## Rows Improved

| Question | Cat | Bucket | Subtype | Safe | Notes |
| --- | ---: | --- | --- | --- | --- |
| conv-26:65 | 1 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true | rescued `228714df-3d66-4c8c-beec-81c4e0921dd3` rank 21 over `0099801c-fa64-4422-b499-042ea431e694` selected rank 2 |
| conv-26:112 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true | rescued `dffdc4cd-b623-4869-854b-8af2c178306a` rank 17 over `3623b85c-e5f0-433c-9637-128957347dc4` selected rank 7 |
| conv-26:127 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true | rescued `4f5ea751-93b4-4317-a80d-71f77bc7bd1f` rank 17 over `cc6ac203-eb85-4387-945c-d01778caa15c` selected rank 4 |
| conv-26:142 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `9d190e20-d91b-400c-8df4-8e1be5eea2ab` rank 4 over `9e8d0722-bb03-4309-8057-9819eccbb371` selected rank 7 |
| conv-30:3 | 1 | mixed | B. Evidence ranked below final top-k due to score composition | true | rescued `1933008f-25e3-4752-938e-a58e5a22fbe9` rank 83 over `7fe88c53-bd34-4c4d-9aad-af9b52fab986` selected rank 1 |
| conv-41:68 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `e275221c-04f7-4a02-b323-1b3afe60a80f` rank 94 over `f140d81c-7505-418c-a92b-8ec5b003177d` selected rank 1 |
| conv-41:79 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `3df385f6-6bdf-4203-bff8-80fbfbbc5a10` rank 23 over `1fe7f0b8-5e98-4f5e-8161-92bda68d5c33` selected rank 9 |
| conv-41:110 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true | rescued `8c98d8b2-02c9-4189-a9b5-74b13d73efa6` rank 53 over `fa521f4a-34b1-4868-89b0-ccbd3c259bc4` selected rank 8 |
| conv-41:133 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true | rescued `a06869e0-0c62-4041-808a-e5e08d9b0fc3` rank 25 over `dad42b46-1f0c-41fd-abcd-9000e7235720` selected rank 4 |
| conv-42:83 | 1 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `40180695-4b4e-4cf8-a601-b98f62dc0361` rank 12 over `3534c0fb-ea05-4a86-b369-4ee1576a4899` selected rank 9 |
| conv-42:102 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `b8cbf253-0e4e-42d8-84b4-76d6af2617b1` rank 48 over `df802797-ca77-4815-88f6-0597b27e782f` selected rank 2 |
| conv-42:114 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true | rescued `9273b7e1-b6cd-43f1-8320-d5e6655f1055` rank 49 over `a69fa5ec-c224-426b-b908-d7b4a7969a48` selected rank 5 |
| conv-42:142 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `e11b80cc-a71f-4933-b0ea-8b57cb7db3a9` rank 10 over `0a85e234-e9dc-4119-99fa-714aa2b8d96b` selected rank 7 |
| conv-42:162 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `45493e4a-63fa-4a4b-8dd4-badd55a76493` rank 24 over `ed09bfa6-8bdb-41c5-b8a1-665d23faa447` selected rank 1 |
| conv-43:36 | 1 | mixed | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `b34b590c-bfff-4dce-9d7c-49b3cbe5695b` rank 3 over `ee2e5a89-8f36-4571-a12a-3d78b91004c3` selected rank 7 |
| conv-43:82 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true | rescued `957d0b1a-3ca9-461d-b03e-587ba8a28d99` rank 13 over `7524ac3b-1009-439d-bac3-1e7df3506615` selected rank 6 |
| conv-43:110 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `fd0e92e4-22ff-4626-8dec-6f0124287dc5` rank 17 over `875b3f3c-7d57-46cd-808b-5a02f8d7188d` selected rank 4 |
| conv-44:61 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true | rescued `9d9220f7-2670-4c09-8eb3-0514a2db400b` rank 37 over `a29ab37e-5dad-4a2f-bd82-5a4c850cd07e` selected rank 8 |
| conv-44:63 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `7bc10292-7659-4b64-92db-299585318bdb` rank 83 over `f17538f0-c851-4290-9d1a-918dccf087f5` selected rank 20 |
| conv-44:65 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `ee4ea75a-be19-448c-8e24-55fd1bb1624d` rank 78 over `a68940e3-9d03-4be1-a01e-c1047b128e17` selected rank 6 |
| conv-44:80 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `a60fc7ed-de77-482b-8476-942a6e20821f` rank 54 over `045119d9-d75a-44d9-91ee-84b36f284c53` selected rank 20 |
| conv-44:105 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `3282938c-5d80-48ed-9855-15c9dce8ecb0` rank 18 over `ebdd77df-729e-4d4e-b387-471bb2c72d94` selected rank 1 |
| conv-47:71 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `302d8cba-3265-409f-a75a-c0468bf28007` rank 18 over `788293b8-2e52-49df-8ad7-d48a1d721f7c` selected rank 1 |
| conv-47:72 | 4 | mixed | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `d2fb6f36-bbc2-429e-a1dc-cb6b1d8796b8` rank 95 over `88ccd086-b50d-40a7-a96e-c65463697726` selected rank 1 |
| conv-47:103 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `fec260ad-e5cf-4f73-84d3-53b84506d948` rank 29 over `729f9db9-d027-42e4-8ef0-91e6295bfcfb` selected rank 8 |
| conv-48:13 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true | rescued `c93627d0-4a38-4329-b350-4cf4a8dfa161` rank 77 over `0d330608-3ab1-40eb-b9ed-da87e901498f` selected rank 1 |
| conv-48:84 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true | rescued `83d7ec20-0306-461c-8f08-b4aa751e1514` rank 84 over `179cc2bd-79a2-4ca9-a238-c75bfa22efe3` selected rank 1 |
| conv-48:107 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `21ca58f2-41e1-4717-8223-86b77ab3b66a` rank 69 over `1df9f7b3-f9b5-472b-ae50-ae62a792a751` selected rank 10 |
| conv-48:114 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `44aa694d-1692-4541-9548-bc08cc914bdb` rank 6 over `ca7d3f29-cf8f-48ab-b906-1b2e8aa970ec` selected rank 10 |
| conv-48:122 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true | rescued `92f93665-a682-48c7-92ec-cda5ba579f5a` rank 6 over `6db9dc0a-78ea-485d-aaf2-03c2be828b45` selected rank 8 |
| conv-48:124 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true | rescued `6511e0f9-317a-4035-9e05-8878b6304c65` rank 28 over `dd4c9acc-2a4c-431c-843e-3b43982a145c` selected rank 6 |
| conv-48:126 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `a16832ac-3b36-4ffd-89f9-ae52d3c3c78d` rank 60 over `ec1008b9-4aab-431a-b2cb-00082b25c35e` selected rank 1 |
| conv-48:145 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true | rescued `892fde55-8379-4094-8703-01a67f299b29` rank 58 over `2524f874-2a61-45fa-a8e3-7f860ea46ac1` selected rank 3 |
| conv-48:179 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true | rescued `a8d9c507-919c-4ba8-b588-d6d88bc434a4` rank 16 over `0aa3ac69-92ed-4e81-b0a9-bacd693569d8` selected rank 2 |
| conv-49:89 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `28c9de4c-4b94-4273-9abc-228d24c22d8c` rank 20 over `a62c672b-0baa-4938-b096-31659156999a` selected rank 10 |
| conv-49:105 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true | rescued `7825b597-3a60-40ef-976f-89d93392f449` rank 79 over `b52ddeb5-f491-4fd0-acfc-6669eca22f19` selected rank 1 |
| conv-49:108 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `75a05179-7b93-4bf8-a2c1-73a2f67cbbf8` rank 65 over `cff09c00-ba33-4bba-94c8-7dbe471ff616` selected rank 1 |
| conv-50:76 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true | rescued `0e5693b5-ff98-43f6-bfeb-ff1fa15636df` rank 74 over `e61f7226-d1e7-4ea8-ab6f-5d341dfdf1a9` selected rank 2 |
| conv-50:89 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true | rescued `ac075faf-ec9a-4d32-ab96-44fc15b1191b` rank 100 over `bfc54ed9-fd95-41d0-ab40-4a8c5cca40ee` selected rank 1 |
| conv-50:111 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true | rescued `a99c9d00-879e-43c5-9d5c-26cbda394147` rank 7 over `a69494c3-646d-42e9-b117-2e5dd8d6228f` selected rank 7 |
| conv-50:118 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true | rescued `36697c80-de0d-4bb3-8975-cd6b5f7521b8` rank 46 over `d7203abe-9df2-4f9f-a82f-e25ae166c19c` selected rank 1 |
| conv-50:125 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true | rescued `4c30aa7f-ef87-454d-8d75-426a243188a0` rank 13 over `15f46d73-082b-4728-a595-6d9dd479e378` selected rank 10 |

## Rows At Risk

| Question | Cat | Bucket | Subtype | Safe | Notes |
| --- | ---: | --- | --- | --- | --- |
| conv-26:107 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | false | rescued `e590a4b4-f31c-48c1-9a76-59adef10eb31` rank 8 over `aed9808c-74c9-44ba-aeaf-366730b1a593` selected rank 8 |
| conv-42:184 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | false | rescued `bf401fc9-549b-4ea5-8637-305e180827b1` rank 19 over `b766bc65-c3ba-4f07-8c77-877ee568ca0a` selected rank 10 |
| conv-48:152 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | false | rescued `1df9f7b3-f9b5-472b-ae50-ae62a792a751` rank 25 over `92d07f79-6a58-486b-97af-51a47ac96395` selected rank 10 |
| conv-50:11 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | false | rescued `ba12ac94-b633-4c8a-a4ba-5eb6ead9d5e9` rank 6 over `e7fd2fee-4cad-49dd-9175-1f4fd8633bd2` selected rank 8 |

## Rows Neutral

| Question | Cat | Bucket | Subtype | Safe | Notes |
| --- | ---: | --- | --- | --- | --- |
| conv-26:3 | 1 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-26:13 | 1 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:24 | 1 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:37 | 1 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:43 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-26:51 | 1 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:55 | 1 | mixed | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:56 | 1 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-26:61 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-26:66 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-26:75 | 1 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-26:85 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-26:88 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-26:89 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:90 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-26:94 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-26:95 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:98 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-26:99 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-26:107 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | false | risk row not moved |
| conv-26:116 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:124 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-26:139 | 4 | speaker_b_only | A. Evidence memory is below selection confidence threshold | true |  |
| conv-26:141 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-26:149 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-26:150 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-30:25 | 1 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-30:31 | 1 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-30:42 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-30:46 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-30:47 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-30:50 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-30:53 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-30:56 | 4 | mixed | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-30:68 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-30:74 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-30:75 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-41:3 | 1 | mixed | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-41:7 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-41:25 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-41:62 | 1 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-41:72 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-41:74 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-41:98 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-41:105 | 4 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-41:122 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-42:42 | 1 | mixed | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-42:49 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-42:61 | 1 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-42:67 | 1 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-42:71 | 1 | mixed | E. Evidence loses to temporally nearby distractors | true |  |
| conv-42:135 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-42:140 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-42:150 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-42:169 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-42:184 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | false | risk row not moved |
| conv-42:186 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-42:195 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-42:198 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-43:35 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-43:76 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-43:84 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-43:88 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-43:120 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-43:160 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-43:161 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-43:164 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-43:166 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-43:175 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-44:12 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-44:35 | 1 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-44:36 | 1 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-44:40 | 1 | speaker_a_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-44:56 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-44:99 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-44:117 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-47:5 | 1 | mixed | F. Query terms do not align with stored summary content | true |  |
| conv-47:9 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-47:18 | 1 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-47:68 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-47:75 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-47:77 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-47:96 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-47:117 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-47:136 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:15 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-48:19 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:25 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:58 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-48:25 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:58 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-48:101 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:102 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-48:103 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-48:117 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-48:121 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-48:133 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-48:141 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-48:146 | 4 | speaker_a_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-48:152 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | false | risk row not moved |
| conv-48:155 | 4 | speaker_a_only | A. Evidence memory is below selection confidence threshold | true |  |
| conv-48:177 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-49:32 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-49:95 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-49:112 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:3 | 1 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:11 | 1 | speaker_a_only | F. Query terms do not align with stored summary content | false | risk row not moved |
| conv-50:29 | 1 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |
| conv-50:73 | 4 | speaker_a_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-50:86 | 4 | speaker_a_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-50:88 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-50:117 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:119 | 4 | speaker_b_only | B. Evidence ranked below final top-k due to score composition | true |  |
| conv-50:132 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:139 | 4 | speaker_a_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:151 | 4 | speaker_b_only | D. Evidence loses to wrong-speaker competitors | true |  |
| conv-50:152 | 4 | speaker_b_only | F. Query terms do not align with stored summary content | true |  |
| conv-50:153 | 4 | speaker_b_only | C. Evidence memory is suppressed by final selection despite top-10 rank | true |  |
| conv-50:156 | 4 | speaker_b_only | E. Evidence loses to temporally nearby distractors | true |  |

## Rows Regressed

| Question | Cat | Bucket | Subtype | Safe | Notes |
| --- | ---: | --- | --- | --- | --- |
| none |  |  |  |  |  |

## Removed Competitor Analysis: First 30 Rescued Rows

| # | Question | Session | Candidate moved in | Candidate rank/conf | Candidate coverage | Removed competitor | Removed rank/conf | Removed coverage | Why removal qualifies |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | conv-26:65 | conv-26:speaker_a | `228714df-3d66-4c8c-beec-81c4e0921dd3` On September 13, 2023, Caroline stated that her transition changed her relati... | rank 21, conf 99 | caroline, chang, some, transition | `0099801c-fa64-4422-b499-042ea431e694` On October 19, 2023, Caroline passed the adoption agency interviews. | rank 2, conf 100 | caroline | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 2 | conv-26:112 | conv-26:speaker_a | `dffdc4cd-b623-4869-854b-8af2c178306a` On July 15, 2023, Melanie stated that she and her kids love painting nature-i... | rank 17, conf 93 | 2023, july, kids, latest, paint, project | `3623b85c-e5f0-433c-9637-128957347dc4` [date:1:51 pm on 15 July, 2023] [speaker:Melanie] Wow, looks awesome! Did you... | rank 7, conf 99 | 2023, july | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 3 | conv-26:127 | conv-26:speaker_a | `4f5ea751-93b4-4317-a80d-71f77bc7bd1f` On August 25, 2023, Melanie asked Caroline what inspired her stained glass wi... | rank 17, conf 93 | caroline, church | `cc6ac203-eb85-4387-945c-d01778caa15c` On August 28, 2023, Caroline volunteered at an LGBTQ+ youth center where she ... | rank 4, conf 99 | caroline | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 4 | conv-26:142 | conv-26:speaker_a | `9d190e20-d91b-400c-8df4-8e1be5eea2ab` On October 13, 2023, Melanie expressed that life is about learning and explor... | rank 4, conf 93 | caroline, journey, life, melanie, together | `9e8d0722-bb03-4309-8057-9819eccbb371` On October 13, 2023, Melanie asked Caroline for tips on how to get started wi... | rank 7, conf 91 | caroline, melanie | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 5 | conv-30:3 | conv-30:speaker_a | `1933008f-25e3-4752-938e-a58e5a22fbe9` On 8 February 2023, Gina encouraged Jon to keep pursuing his passions and not... | rank 83, conf 100 | both, gina, jon | `7fe88c53-bd34-4c4d-9aad-af9b52fab986` On 23 July 2023, Gina acknowledged Jon's enthusiastic response with 'That's t... | rank 1, conf 100 | gina, jon | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 6 | conv-41:68 | conv-41:speaker_a | `e275221c-04f7-4a02-b323-1b3afe60a80f` [date:11:01 am on 17 December, 2022] [speaker:Maria] Been busy volunteering a... | rank 94, conf 100 | class, december, doing, maria, start, workout | `f140d81c-7505-418c-a92b-8ec5b003177d` On August 3, 2023, Maria explained that she started volunteering at the homel... | rank 1, conf 100 | 2023, maria, start | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 7 | conv-41:79 | conv-41:speaker_a | `3df385f6-6bdf-4203-bff8-80fbfbbc5a10` John takes his kids to the park a few times a week for family bonding and let... | rank 23, conf 73 | john, kids, park | `1fe7f0b8-5e98-4f5e-8161-92bda68d5c33` On June 16, 2023, John stated he is lucky to have his family on his journey w... | rank 9, conf 81 | john | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 8 | conv-41:110 | conv-41:speaker_a | `8c98d8b2-02c9-4189-a9b5-74b13d73efa6` [date:7:20 pm on 16 June, 2023] [speaker:Maria] Hey John, been good since we ... | rank 53, conf 82 | 2023, june, maria, news, share | `fa521f4a-34b1-4868-89b0-ccbd3c259bc4` On June 27, 2023, John encouraged Maria to keep going with her efforts to mak... | rank 8, conf 95 | 2023, june, maria | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 9 | conv-41:133 | conv-41:speaker_a | `a06869e0-0c62-4041-808a-e5e08d9b0fc3` On August 3, 2023, John shared a photo of his young son holding a flag in a c... | rank 25, conf 88 | 2023, august, john, kids, week | `dad42b46-1f0c-41fd-abcd-9000e7235720` On April 18, 2023, John planned a trip to the East Coast. | rank 4, conf 95 | 2023, john | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 10 | conv-42:83 | conv-42:speaker_a | `40180695-4b4e-4cf8-a601-b98f62dc0361` Nate offered to help the other tournament participants improve their game ski... | rank 12, conf 91 | help, nate, other, skill | `3534c0fb-ea05-4a86-b369-4ee1576a4899` [date:6:03 pm on 5 September, 2022] [speaker:Nate] What else are you making? ... | rank 9, conf 74 | nate | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 11 | conv-42:102 | conv-42:speaker_a | `b8cbf253-0e4e-42d8-84b4-76d6af2617b1` Nate's favorite flavors for dairy-free desserts are coconut milk, chocolate, ... | rank 48, conf 92 | dairy, dessert, enjoy, flavor, free, nate | `df802797-ca77-4815-88f6-0597b27e782f` [date:1:43 pm on 14 September, 2022] [speaker:Nate] Coconut milk ice cream is... | rank 2, conf 100 | dairy, free, nate | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 12 | conv-42:114 | conv-42:speaker_a | `9273b7e1-b6cd-43f1-8320-d5e6655f1055` Nate sent Joanna a photo of a bunch of books on a table on April 21, 2022. | rank 49, conf 100 | books, enjoy, nate | `a69fa5ec-c224-426b-b908-d7b4a7969a48` On November 7, 2022, Joanna commented on Nate's enjoyment of his busy schedul... | rank 5, conf 100 | nate | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 13 | conv-42:142 | conv-42:speaker_a | `e11b80cc-a71f-4933-b0ea-8b57cb7db3a9` On July 10, 2022, Nate expresses pride in being able to make money doing what... | rank 10, conf 95 | loves, make, money, nate | `0a85e234-e9dc-4119-99fa-714aa2b8d96b` [date:2:34 pm on 10 July, 2022] [speaker:Nate] I'm always here for you! You'v... | rank 7, conf 89 | nate | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 14 | conv-42:162 | conv-42:speaker_a | `45493e4a-63fa-4a4b-8dd4-badd55a76493` On October 9, 2022, Nate met people at a game convention who played the same ... | rank 24, conf 97 | 2022, convention, game, nate, october, play | `ed09bfa6-8bdb-41c5-b8a1-665d23faa447` [date:5:54 pm on 9 November, 2022] [speaker:Nate] Congrats on the chance to p... | rank 1, conf 100 | 2022, game, nate | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 15 | conv-43:36 | conv-43:speaker_a | `b34b590c-bfff-4dce-9d7c-49b3cbe5695b` John considers LeBron James his favorite basketball player, admiring his skil... | rank 3, conf 100 | basketball, favorite, john, player, tim | `ee2e5a89-8f36-4571-a12a-3d78b91004c3` John feels elated after winning the trophy and appreciates Tim's support. | rank 7, conf 97 | john, tim | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 16 | conv-43:82 | conv-43:speaker_a | `957d0b1a-3ca9-461d-b03e-587ba8a28d99` On December 19, 2023, John discovered a peaceful spot with rocks and a river ... | rank 13, conf 76 | feel, john, while | `7524ac3b-1009-439d-bac3-1e7df3506615` [date:4:21 pm on 16 July, 2023] [speaker:Tim] Wow! How long have you been sur... | rank 6, conf 66 | surf | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 17 | conv-43:110 | conv-43:speaker_a | `fd0e92e4-22ff-4626-8dec-6f0124287dc5` Tim recommended the fantasy novel by Patrick Rothfuss to John for his upcomin... | rank 17, conf 96 | book, john, tim, trip | `875b3f3c-7d57-46cd-808b-5a02f8d7188d` On January 7, 2024, Tim stated that he is currently reading the fantasy novel... | rank 4, conf 100 | tim | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 18 | conv-44:61 | conv-44:speaker_a | `9d9220f7-2670-4c09-8eb3-0514a2db400b` Andrew's favorite type of bird is eagles, as he finds them strong and graceful. | rank 37, conf 86 | andrew, bird, mesmeriz, type | `a29ab37e-5dad-4a2f-bd82-5a4c850cd07e` Andrew has a balcony with flowers that he is taking care of, as of September ... | rank 8, conf 97 | andrew | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 19 | conv-44:63 | conv-44:speaker_a | `7bc10292-7659-4b64-92db-299585318bdb` Andrew and his girlfriend had delicious croissants, muffins, and tarts at the... | rank 83, conf 100 | andrew, cafe, girlfriend | `f17538f0-c851-4290-9d1a-918dccf087f5` [date:2:42 pm on 2 April, 2023] [speaker:Andrew] I'll keep you posted. Ttyl, ... | rank 20, conf 87 | andrew | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 20 | conv-44:65 | conv-44:speaker_a | `ee4ea75a-be19-448c-8e24-55fd1bb1624d` Audrey meets other dog owners in the park for doggie playdates to socialize w... | rank 78, conf 80 | audrey, dog, park, playdat | `a68940e3-9d03-4be1-a01e-c1047b128e17` Andrew asked what activities Audrey's dogs enjoy doing the most on July 3, 2023. | rank 6, conf 100 | audrey | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 21 | conv-44:80 | conv-44:speaker_a | `a60fc7ed-de77-482b-8476-942a6e20821f` Audrey's favorite dish to make with garlic is Roasted Chicken, which she cons... | rank 54, conf 100 | 2023, audrey, dish, favorite, garlic, july, one | `045119d9-d75a-44d9-91ee-84b36f284c53` [date:4:18 pm on 4 October, 2023] [speaker:Andrew] Hi Audrey! Been a while si... | rank 20, conf 82 | 2023, andrew, audrey | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 22 | conv-44:105 | conv-44:speaker_a | `3282938c-5d80-48ed-9855-15c9dce8ecb0` Audrey's dogs love playing Fetch and Frisbee at the park and can run for hours. | rank 18, conf 100 | audrey, dogs, park, play | `ebdd77df-729e-4d4e-b387-471bb2c72d94` Audrey's dogs are doing great, exploring and meeting new people, making her g... | rank 1, conf 100 | audrey, dogs | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 23 | conv-47:71 | conv-47:speaker_a | `302d8cba-3265-409f-a75a-c0468bf28007` On 13 October 2022, John offered his support to James, stating 'I'm here for ... | rank 18, conf 100 | james, john, offer | `788293b8-2e52-49df-8ad7-d48a1d721f7c` On 7 November 2022, John stated that he still does not have a dog but really ... | rank 1, conf 100 | john | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 24 | conv-47:72 | conv-47:speaker_a | `d2fb6f36-bbc2-429e-a1dc-cb6b1d8796b8` James is learning to play the drums, describing it as quite a journey. | rank 95, conf 74 | 2022, instrument, john, learn, march, play | `88ccd086-b50d-40a7-a96e-c65463697726` [date:9:20 am on 3 October, 2022] [speaker:John] Cool, James! What kind of ga... | rank 1, conf 100 | 2022, john, play | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 25 | conv-47:103 | conv-47:speaker_a | `fec260ad-e5cf-4f73-84d3-53b84506d948` On 9 July 2022, James stated he has become interested in extreme sports and w... | rank 29, conf 90 | 2022, become, interest, james, july | `729f9db9-d027-42e4-8ef0-91e6295bfcfb` James went bowling on 16 March 2022 and got 2 strikes. | rank 8, conf 95 | 2022, james | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 26 | conv-48:13 | conv-48:speaker_a | `c93627d0-4a38-4329-b350-4cf4a8dfa161` Deborah traveled to Bali last year (relative to February 2023), which she con... | rank 77, conf 100 | deborah, peace, plac | `0d330608-3ab1-40eb-b9ed-da87e901498f` Deborah has a gorgeous blossom tree near her home that blooms every spring, w... | rank 1, conf 100 | deborah | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 27 | conv-48:84 | conv-48:speaker_a | `83d7ec20-0306-461c-8f08-b4aa751e1514` Jolene finished an electrical engineering project last week (relative to Janu... | rank 84, conf 100 | engineer, jolene, project, work | `179cc2bd-79a2-4ca9-a238-c75bfa22efe3` Jolene realized the importance of incorporating relaxation, self-care, and ba... | rank 1, conf 100 | engineer, jolene | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 28 | conv-48:107 | conv-48:speaker_a | `21ca58f2-41e1-4717-8223-86b77ab3b66a` Deborah brings an amulet from her mother when visiting the spot by the water ... | rank 69, conf 75 | bring, deborah, mom, whenever | `1df9f7b3-f9b5-472b-ae50-ae62a792a751` Deborah's mother passed away a few years ago (relative to January 23, 2023). | rank 10, conf 86 | deborah | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 29 | conv-48:114 | conv-48:speaker_a | `44aa694d-1692-4541-9548-bc08cc914bdb` Jolene met her partner in an engineering class in college, where they quickly... | rank 6, conf 94 | jolene, partner | `ca7d3f29-cf8f-48ab-b906-1b2e8aa970ec` [date:11:22 am on 13 March, 2023] [speaker:Jolene] Congrats. How did you do t... | rank 10, conf 65 | jolene | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |
| 30 | conv-48:122 | conv-48:speaker_a | `92f93665-a682-48c7-92ec-cda5ba579f5a` Deborah offered to explain her prioritization method, which organizes tasks b... | rank 6, conf 97 | based, importance, jolene, method, organiz, tasks, urgency | `6db9dc0a-78ea-485d-aaf2-03c2be828b45` Deborah asked Jolene if she has tried mindfulness on August 16, 2023. | rank 8, conf 95 | jolene | removed item had 0 unique query tokens and lower/equal coverage under the replay guard |

## Implementation Gate

The replay covers 42 safe rows and affects 4 risk rows, with 0 risk rows gaining target-gold evidence and 0 rows losing target-gold coverage. The approved gate is `>=8` safe rows with `<=4` risk rows. Result: **GO for minimal implementation**.

The production implementation must keep the same limits: already-ranked candidates only, confidence floor 65, rank band <=100, explicit provenance, at most one replacement per speaker recall, fixed returned count, and no benchmark-specific labels.

## Evidence Artifacts

- Replay rows JSON: `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/final_selection_rescue_replay_rows.json`

- Source trace directory: `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/server-traces`

- Target subtype rows: `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/retrieval_ranking_subtype_rows.json`

- V2 attribution rows: `/home/ec2-user/Documents/Dev/harness/diagnostics/20260511T062806Z-er0-trace/exports/er0_attribution_v2_rows.json`
