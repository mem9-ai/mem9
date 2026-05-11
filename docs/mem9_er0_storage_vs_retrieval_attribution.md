# mem9 ER0 Storage-vs-Retrieval Attribution

Date: 2026-05-11 UTC

Mode: Experiment #1 diagnostic only. No production code, benchmark code, harness
logic, prompt, config, scoring, or registry logic was modified. No full benchmark
was run. The current suspicious `last-ingest-cache.json` was not used as an
authoritative evidence source.

## Executive Summary

Stop condition triggered: I cannot classify >=50 Cat1/Cat4 ER0 failures into the
requested storage-vs-retrieval taxonomy with trustworthy evidence.

What is trustworthy:

- The current accepted baseline result is
  `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json`,
  documented in `benchmark/BASELINE.md:14-20`.
- That accepted run used the active mem0-style-on-mem9 framework with
  `LOCOMO_PROTOCOL=mem0-style`, `LOCOMO_ANSWER_PROMPT=mem0-speaker`,
  `LOCOMO_SPEAKER_TOP_K=10`, and `MEM9_RETRIEVAL_LIMIT=20`,
  documented in `benchmark/BASELINE.md:7-12`.
- The accepted run's clean score shape is 1,985 F1 rows and 1,539 LLM-judged rows,
  documented in `benchmark/BASELINE.md:42-46`.
- The accepted result contains enough row-level fields to identify Cat1/Cat4
  ER0 rows and prove that their gold dialogue IDs were not in the returned
  retrieved dialogue IDs or final returned prompt context. This comes from the
  result fields written by `/home/ec2-user/git/mem9-benchmark/locomo/src/cli.ts:668-690`.

What is not trustworthy or missing:

- The accepted run archive
  `/home/ec2-user/Documents/Dev/harness/results/20260510T024951` contains only
  `cache-backend-manifest.json`, `locomo.log`, `mem9-server.log`,
  `mnemo-server`, and `tiup.log`; it does not contain a DB snapshot, stored-memory
  export, per-query server candidate pool trace, or filtered/ranked candidate
  trace.
- The current live `last-ingest-cache.json` was explicitly ruled out by the
  readiness report because its producer lineage is tied to reverted iteration
  548. The current cache has `created_at=2026-05-10T16:42:56.710Z` in
  `/home/ec2-user/git/mem9-benchmark/locomo/results/last-ingest-cache.json:7`,
  while the accepted baseline cache was `2026-05-10T02:50:01.599Z` in
  `/home/ec2-user/Documents/Dev/harness/results/20260510T024951/cache-backend-manifest.json:5-7`.
- The accepted baseline archive manifest proves that a complete backend existed
  at run time with active memory count 7,844
  (`/home/ec2-user/Documents/Dev/harness/results/20260510T024951/cache-backend-manifest.json:8-15`),
  but it does not preserve the actual stored rows.
- The mem0-style benchmark result artifacts do not record pre-final candidate
  pools. The unified result maps `retrieval.rankedItems` from
  `result.retrieved_memories`, and `totalResults` from that same final returned
  list in `/home/ec2-user/git/mem9-benchmark/locomo/src/cli.ts:917-929`.

Conclusion: The latest clean accepted artifact supports "gold evidence absent
from final returned context" for 235 Cat1/Cat4 ER0 rows, including the 50 rows
listed below. It does not support a trustworthy distinction among "never stored",
"incorrectly merged", "stored but not retrieved", "candidate but filtered",
"ranked too low", or "lost during context assembly". The correct recommendation
is NO-CODE until a clean backend/candidate trace source is restored or rebuilt.

## Evidence Sources

| Source | Evidence type | What it supports | Trustworthiness | Gap |
|---|---|---|---|---|
| `/home/ec2-user/git/mem9/benchmark/BASELINE.md:7-20` | Baseline policy | Accepted result path and active protocol settings | High | Does not contain row-level traces |
| `/home/ec2-user/git/mem9/benchmark/BASELINE.md:42-53` | Baseline policy | Clean denominator and absence of same-cache control for accepted cache | High | Does not provide DB snapshot |
| `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.json` | Accepted result | Row-level questions, evidence IDs, retrieved memories, retrieved dia IDs, final context, judge score | High for final returned context | No stored-memory inventory or candidate pool |
| `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-10T02-50-01-542Z_mem0-style.unified.json` | Accepted unified result | Result schema and final ranked items | Medium | Ranked items are final retrieved memories, not full candidate pool |
| `/home/ec2-user/git/mem9-benchmark/locomo/data/locomo10.json` | Ground truth data | Speaker bucket and source turn metadata for evidence IDs | High | Does not show what mem9 stored |
| `/home/ec2-user/Documents/Dev/harness/results/20260510T024951/cache-backend-manifest.json:1-28` | Accepted archive manifest | Accepted cache sha, created time, complete sample count, active memory count 7,844 | High for manifest metadata | No actual DB state |
| `/home/ec2-user/Documents/Dev/harness/results/20260510T024951` | Accepted archive directory | Shows only logs, manifest, server binary, and tiup log are archived | High | Missing DB snapshot and candidate traces |
| `/home/ec2-user/git/mem9-benchmark/locomo/src/retrieve.ts:81-123` | Benchmark retrieval code | mem0-style runs speaker A and B retrieval separately and returns final combined context | High | Does not trace server-side candidate pool |
| `/home/ec2-user/git/mem9-benchmark/locomo/src/cli.ts:625-690` | Benchmark answer/result code | Answer uses returned speaker contexts and result saves final retrieved IDs/memories | High | Cutoff loop does not expose independent candidate-depth evidence |
| `/home/ec2-user/git/mem9-benchmark/locomo/src/cli.ts:917-929` | Unified conversion code | Unified ranked items come from final `retrieved_memories` | High | Not a pre-filter candidate pool |
| `/home/ec2-user/git/mem9/docs/mem9_post_retrospective_execution_readiness.md` | Readiness audit | Current live cache/backend lineage is not trustworthy for ER0 attribution | High | It is an audit doc, not a restored clean trace source |

## Artifact-Level Inventory

From the accepted baseline result:

- Cat1/Cat4 ER0 rows: 235.
- Category split: Cat1 = 79, Cat4 = 156.
- LLM judge split among these ER0 rows: 168 wrong, 67 right.
- Speaker bucket split from `locomo10.json`: speaker_a_only = 98,
  speaker_b_only = 109, mixed = 28.
- Returned memory count split among these ER0 rows: 168 rows returned 20
  memories, and 67 rows returned 40 memories.

Interpretation:

- `evidence_recall=0` proves none of the gold evidence dialogue IDs appeared in
  `retrieved_dia_ids` for those rows.
- Because `context_retrieved` is assembled from the same final returned memories
  in `/home/ec2-user/git/mem9-benchmark/locomo/src/retrieve.ts:100-122`, those
  evidence dialogue IDs also did not appear as source-linked final prompt context.
- This does not prove whether the evidence was absent from storage, merged away,
  absent from raw candidates, filtered, ranked too low, or context-assembly lost.

## Classification Table

This table contains 50 Cat1/Cat4 ER0 rows from the accepted result. It is an
artifact-level table, not a completed storage-vs-retrieval attribution. Each row
is safe as evidence of final-context absence only. None is safe to target as a
specific production mechanism without clean storage and candidate-pool evidence.

| # | question id | cat | bucket | question | gold / expected evidence | expected answer | stored memory evidence | candidate pool / rank | final top20 | final prompt | failure class | confidence / risk | safe target |
|---:|---|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `conv-26:3` | 1 | speaker_a_only | What did Caroline research? | `D2:8` / D2:8 Caroline 1:14 pm on 25 May, 2023: Researching adoption agencie... | Adoption agencies | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 2 | `conv-26:4` | 1 | speaker_a_only | What is Caroline's identity? | `D1:5` / D1:5 Caroline 1:56 pm on 8 May, 2023: The transgender stories were ... | Transgender woman | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 3 | `conv-26:13` | 1 | speaker_a_only | What career path has Caroline decided to persue? | `D4:13,D1:11` / D4:13 Caroline 10:37 am on 27 June, 2023; D1:11 Caroline 1:56 pm on 8 May, 2023 | counseling or mental health for Transgender people | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 4 | `conv-26:24` | 1 | speaker_b_only | What does Melanie do to destress? | `D7:22,D5:4` / D7:22 Melanie 4:33 pm on 12 July, 2023; D5:4 Melanie 1:36 pm on 3 July, 2023 | Running, pottery | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 5 | `conv-26:32` | 1 | speaker_a_only | What LGBTQ+ events has Caroline participated in? | `D5:1,D8:17,D3:1,D1:3` / D5:1 Caroline 1:36 pm on 3 July, 2023; D8:17 Caroline 1:51 pm on 15 July, 2023; D3:1 Caroline 7:55 pm on 9 June, 2023; +1 more | Pride parade, school speech, support group | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 6 | `conv-26:37` | 1 | speaker_b_only | What did Melanie paint recently? | `D8:6,D9:17` / D8:6 Melanie 1:51 pm on 15 July, 2023; D9:17 Melanie 2:31 pm on 17 July, 2023 | sunset | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 7 | `conv-26:43` | 1 | speaker_a_only | What kind of art does Caroline make? | `D11:12,D11:8,D9:14` / D11:12 Caroline 2:24 pm on 14 August, 2023; D11:8 Caroline 2:24 pm on 14 August, 2023; D9:14 Caroline 2:31 pm on 17 July, 2023 | abstract art | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 8 | `conv-26:48` | 1 | speaker_b_only | What types of pottery have Melanie and her kids made? | `D12:14,D8:4,D5:6` / D12:14 Melanie 1:50 pm on 17 August, 2023; D8:4 Melanie 1:51 pm on 15 July, 2023; D5:6 Melanie 1:36 pm on 3 July, 2023 | bowls, cup | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 9 | `conv-26:51` | 1 | speaker_b_only | What has Melanie painted? | `D13:8,D8:6,D1:12` / D13:8 Melanie 3:31 pm on 23 August, 2023; D8:6 Melanie 1:51 pm on 15 July, 2023; D1:12 Melanie 1:56 pm on 8 May, 2023 | Horse, sunset, sunrise | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 10 | `conv-26:55` | 1 | mixed | What subject have Caroline and Melanie both painted? | `D14:5,D8:6` / D14:5 Caroline 1:33 pm on 25 August, 2023; D8:6 Melanie 1:51 pm on 15 July, 2023 | Sunsets | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 11 | `conv-26:56` | 1 | speaker_a_only | What symbols are important to Caroline? | `D14:15,D4:1` / D14:15 Caroline 1:33 pm on 25 August, 2023; D4:1 Caroline 10:37 am on 27 June, 2023 | Rainbow flag, transgender symbol | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 12 | `conv-26:61` | 1 | speaker_b_only | What musical artists/bands has Melanie seen? | `D15:16,D11:3` / D15:16 Melanie 3:19 pm on 28 August, 2023; D11:3 Melanie 2:24 pm on 14 August, 2023 | Summer Sounds, Matt Patterson | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 13 | `conv-26:65` | 1 | speaker_a_only | What are some changes Caroline has faced during her transition journey? | `D16:15,D11:14` / D16:15 Caroline 12:09 am on 13 September, 2023; D11:14 Caroline 2:24 pm on 14 August, 2023 | Changes to her body, losing unsupportive friends | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 14 | `conv-26:66` | 1 | speaker_b_only | What does Melanie do with her family on hikes? | `D16:4,D10:12` / D16:4 Melanie 12:09 am on 13 September, 2023; D10:12 Melanie 8:56 pm on 20 July, 2023 | Roast marshmallows, tell stories | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 15 | `conv-26:75` | 1 | speaker_b_only | How many children does Melanie have? | `D18:1,D18:7` / D18:1 Melanie 6:55 pm on 20 October, 2023; D18:7 Melanie 6:55 pm on 20 October, 2023 | 3 | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 16 | `conv-26:85` | 4 | speaker_a_only | What are Caroline's plans for the summer? | `D2:8` / D2:8 Caroline 1:14 pm on 25 May, 2023 | researching adoption agencies | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 17 | `conv-26:88` | 4 | speaker_a_only | What is Caroline excited about in the adoption process? | `D2:14` / D2:14 Caroline 1:14 pm on 25 May, 2023 | creating a family for kids who need one | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 18 | `conv-26:89` | 4 | speaker_b_only | What does Melanie think about Caroline's decision to adopt? | `D2:15` / D2:15 Melanie 1:14 pm on 25 May, 2023 | she thinks Caroline is doing something amazing and will be an awesome parent | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 19 | `conv-26:90` | 4 | speaker_b_only | How long have Mel and her husband been married? | `D3:16` / D3:16 Melanie 7:55 pm on 9 June, 2023 | Mel and her husband have been married for 5 years. | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 20 | `conv-26:94` | 4 | speaker_a_only | What is Melanie's hand-painted bowl a reminder of? | `D4:5` / D4:5 Caroline 10:37 am on 27 June, 2023 | art and self-expression | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 21 | `conv-26:95` | 4 | speaker_b_only | What did Melanie and her family do while camping? | `D4:8` / D4:8 Melanie 10:37 am on 27 June, 2023 | explored nature, roasted marshmallows, and went on a hike | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 22 | `conv-26:98` | 4 | speaker_a_only | What was discussed in the LGBTQ+ counseling workshop? | `D4:13` / D4:13 Caroline 10:37 am on 27 June, 2023 | therapeutic methods and how to best work with trans people | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 23 | `conv-26:99` | 4 | speaker_a_only | What motivated Caroline to pursue counseling? | `D4:15` / D4:15 Caroline 10:37 am on 27 June, 2023 | her own journey and the support she received, and how counseling could help people like her | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 24 | `conv-26:106` | 4 | speaker_a_only | What are the new shoes that Melanie got used for? | `D7:19` / D7:19 Caroline 4:33 pm on 12 July, 2023 | Running | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 25 | `conv-26:107` | 4 | speaker_a_only | What is Melanie's reason for getting into running? | `D7:21` / D7:21 Caroline 4:33 pm on 12 July, 2023 | To de-stress and clear her mind | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 26 | `conv-26:112` | 4 | speaker_b_only | What did Mel and her kids paint in their latest project in July 2023? | `D8:6` / D8:6 Melanie 1:51 pm on 15 July, 2023 | a sunset with a palm tree | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 27 | `conv-26:116` | 4 | speaker_a_only | What inspired Caroline's painting for the art show? | `D9:16` / D9:16 Caroline 2:31 pm on 17 July, 2023 | visiting an LGBTQ center and wanting to capture unity and strength | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 28 | `conv-26:123` | 4 | speaker_a_only | What pet does Caroline have? | `D13:3` / D13:3 Caroline 3:31 pm on 23 August, 2023 | guinea pig | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 29 | `conv-26:124` | 4 | speaker_b_only | What pets does Melanie have? | `D13:4` / D13:4 Melanie 3:31 pm on 23 August, 2023 | Two cats and a dog | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 30 | `conv-26:127` | 4 | speaker_a_only | What did Caroline make for a local church? | `D14:17` / D14:17 Caroline 1:33 pm on 25 August, 2023 | a stained glass window | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 31 | `conv-26:139` | 4 | speaker_b_only | What was the poetry reading that Caroline attended about? | `D17:18` / D17:18 Melanie 10:31 am on 13 October, 2023 | It was a transgender poetry reading where transgender people shared their stories | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 32 | `conv-26:141` | 4 | speaker_a_only | What does Caroline's drawing symbolize for her? | `D17:23` / D17:23 Caroline 10:31 am on 13 October, 2023 | Freedom and being true to herself. | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 33 | `conv-26:142` | 4 | speaker_a_only | How do Melanie and Caroline describe their journey through life together? | `D17:25` / D17:25 Caroline 10:31 am on 13 October, 2023 | An ongoing adventure of learning and growing. | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 34 | `conv-26:149` | 4 | speaker_b_only | What do Melanie's family give her? | `D18:9` / D18:9 Melanie 6:55 pm on 20 October, 2023 | Strength and motivation | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 35 | `conv-26:150` | 4 | speaker_b_only | How did Melanie feel about her family supporting her? | `D18:13` / D18:13 Melanie 6:55 pm on 20 October, 2023 | She appreciated them a lot | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 36 | `conv-30:201` | 4 | mixed | How do Jon and Gina both like to destress? | `D1:7,D1:6` / D1:7 Gina 4:04 pm on 20 January, 2023; D1:6 Jon 4:04 pm on 20 January, 2023 | by dancing | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 37 | `conv-30:202` | 1 | mixed | What do Jon and Gina both have in common? | `D1:2,D1:3,D1:4,D2:1` / D1:2 Jon 4:04 pm on 20 January, 2023; D1:3 Gina 4:04 pm on 20 January, 2023; D1:4 Jon 4:04 pm on 20 January, 2023; +1 more | They lost their jobs and decided to start their own businesses. | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 38 | `conv-30:208` | 1 | mixed | Which city have both Jean and John visited? | `D2:5,D15:1` / D2:5 Gina 2:32 pm on 29 January, 2023; D15:1 Jon 10:04 am on 19 June, 2023 | Rome | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 39 | `conv-30:217` | 1 | mixed | Do Jon and Gina start businesses out of what they love? | `D1:4,D6:8` / D1:4 Jon 4:04 pm on 20 January, 2023; D6:8 Gina 2:35 pm on 16 March, 2023 | Yes | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 40 | `conv-30:224` | 1 | speaker_a_only | What does Jon's dance studio offer? | `D13:7,D8:13` / D13:7 Jon 8:29 pm on 13 June, 2023; D8:13 Jon 1:26 pm on 3 April, 2023 | one-on-one metoring and training to dancers, workshops and classes | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 41 | `conv-30:230` | 1 | speaker_a_only | How long did it take for Jon to open his studio? | `D1:2,D15:13` / D1:2 Jon 4:04 pm on 20 January, 2023; D15:13 Jon 10:04 am on 19 June, 2023 | six months | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 42 | `conv-30:241` | 4 | speaker_b_only | What kind of dance piece did Gina's team perform to win first place? | `D1:19` / D1:19 Gina 4:04 pm on 20 January, 2023 | "Finding Freedom" | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 43 | `conv-30:243` | 4 | speaker_a_only | What does Gina say about the dancers in the photo? | `D1:26` / D1:26 Jon 4:04 pm on 20 January, 2023 | They look graceful | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 44 | `conv-30:245` | 4 | speaker_a_only | What kind of flooring is Jon looking for in his dance studio? | `D2:8` / D2:8 Jon 2:32 pm on 29 January, 2023 | Marley flooring | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=40 | no |
| 45 | `conv-30:246` | 4 | speaker_b_only | What did Gina find for her clothing store on 1 February, 2023? | `D3:2` / D3:2 Gina 12:48 am on 1 February, 2023 | The perfect spot for her store | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 46 | `conv-30:249` | 4 | speaker_a_only | What did Jon say about Gina's progress with her store? | `D3:3` / D3:3 Jon 12:48 am on 1 February, 2023 | hard work's paying off | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 47 | `conv-30:252` | 4 | speaker_b_only | What did Gina say about creating an experience for her customers? | `D3:8` / D3:8 Gina 12:48 am on 1 February, 2023 | making them want to come back | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 48 | `conv-30:255` | 4 | mixed | What did Jon and Gina compare their entrepreneurial journeys to? | `D6:15,D6:16` / D6:15 Jon 2:35 pm on 16 March, 2023; D6:16 Gina 2:35 pm on 16 March, 2023 | dancing together and supporting each other | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 49 | `conv-30:267` | 4 | speaker_a_only | What does Jon tell Gina he won't do? | `D14:17` / D14:17 Jon 9:38 pm on 16 June, 2023 | quit | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |
| 50 | `conv-30:271` | 4 | speaker_a_only | How does Jon feel about the opening night of his dance studio? | `D15:7` / D15:7 Jon 10:04 am on 19 June, 2023 | excited | unknown; clean stored-memory inventory unavailable | unknown; clean pre-filter candidate pool unavailable | no; evidence dia_id absent from returned dia_ids | no; evidence absent from returned prompt context | unclassified: missing clean storage/candidate evidence | final-context absence high; storage/retrieval boundary none; returned_n=20 | no |

## Counts

Requested failure-class taxonomy:

| Requested class | Trustworthy count |
|---|---:|
| never stored | not computable |
| incorrectly merged | not computable |
| stored but not retrieved | not computable |
| retrieved in candidate pool but filtered | not computable |
| retrieved but ranked too low | not computable |
| retrieved but lost during context assembly | not computable |
| present in context but failed during answer synthesis | 0 among ER0 rows by definition; gold evidence was absent from returned evidence IDs |

Evidence-bound class for the 50-row table:

| Evidence-bound class | Count |
|---|---:|
| unclassified: missing clean storage/candidate evidence | 50 |

Counts by category for the 50-row table:

| Category | Count |
|---|---:|
| Cat1 | 20 |
| Cat4 | 30 |

Counts by speaker bucket for the 50-row table:

| Speaker bucket | Count |
|---|---:|
| speaker_a_only | 26 |
| speaker_b_only | 18 |
| mixed | 6 |

Counts for all Cat1/Cat4 ER0 rows in the accepted result:

| Dimension | Count |
|---|---:|
| Total Cat1/Cat4 ER0 | 235 |
| Cat1 | 79 |
| Cat4 | 156 |
| speaker_a_only | 98 |
| speaker_b_only | 109 |
| mixed | 28 |
| LLM wrong | 168 |
| LLM right | 67 |

## Top Recurring Mechanism

Evidence-backed mechanism:

- The recurring mechanism visible in the accepted artifact is final returned
  context miss: the gold evidence dialogue IDs were absent from final
  `retrieved_dia_ids` for 235 Cat1/Cat4 rows.

What cannot be concluded:

- This is not enough to say storage, reconciliation, retrieval, ranking, filtering,
  or context assembly is the true cause. All of those remain possible because the
  accepted artifacts do not include a clean stored-memory inventory or a pre-final
  candidate pool.

## Production-Legitimate Mechanism Gate

Question: Is there one production-legitimate mechanism covering >=8 judged rows
with <=4 risk rows?

Answer: No, not from the available trustworthy evidence.

The only mechanism covering >=8 rows is final returned context miss, but that is
an observed symptom rather than a production mechanism. It does not identify the
actionable stage. Treating it as a mechanism would collapse storage,
reconciliation, retrieval, ranking, filtering, and context assembly into one
bucket, which violates the experiment rules.

## Recommended Next Experiment

NO-CODE recommendation.

Before any production or benchmark change, restore or rebuild a clean read-only
trace environment for the accepted framework:

1. Use clean repos and a clean no-change backend/cache lineage, not the current
   suspicious `last-ingest-cache.json`.
2. Preserve or export stored memories for the accepted framework's 10 samples.
3. Capture raw server candidate pools, post-filter pools, ranked lists, final
   top-k lists, and final prompt context for the same ER0 row set.
4. Re-run this attribution study against those artifacts only.

This is still diagnostic work. It should not change production code, benchmark
logic, prompts, configs, scoring, or harness registry logic.

## Explicit Approval Gate

No implementation should start from this report. The attribution target is not
identified with enough confidence. Any next step that changes code or benchmark
behavior requires explicit user approval after clean storage and candidate-pool
evidence exists.
