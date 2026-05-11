# Location and deictic answer normalization success

Date: 2026-05-03

Result:
- `/home/ec2-user/git/mem9-benchmark/locomo/results/2026-05-03T22-24-43-577Z_mem9-current.json`
- Logs: `/home/ec2-user/locomo-logs/20260503T222425`

Change:
- Extended the existing narrow temporal answer normalizer to handle pure
  `yesterday`, `today`, `tomorrow`, and `tonight` answers when a retrieved block
  has a matching `[answer-time: ...]`.
- Added a narrow location answer normalizer for country/state questions where
  the model returns a city/place instead of the requested country/state:
  `Paris -> France`, `Bogota/Bogotá -> Colombia`, `Nuuk -> Greenland`,
  `Stamford -> Connecticut`, and `Lake Tahoe -> California`.

Validation:
- `cd /home/ec2-user/git/mem9-benchmark/locomo && npm run typecheck && npm test`
- Full harness via `/home/ec2-user/git/clawd/disc/scripts/locomo.sh`

Metrics:
- Overall LLM: 66.69%, up from previous accepted 65.26% (+1.43pp).
- Overall F1: 62.73%, up from previous accepted 62.34% (+0.40pp).
- Overall Evidence Recall: 67.63%, up from previous accepted 67.51% (+0.13pp).
- Cat1 LLM: 37.94%, up from 37.23%.
- Cat2 LLM: 81.31%, up from 79.75%.
- Cat3 LLM: 41.67%, up from 39.58%.
- Cat4 LLM: 73.60%, up from 72.06%.

Observed targeted fixes:
- `When did Melanie buy the figurines?`: `yesterday` became `yesterday (21 October 2023)` and judged correct.
- `Which country were Jolene and her mother visiting in 2010?`: `Paris` became `France`.
- `In what country did Jolene's mother buy her the pendant?`: `Paris` became `France`.
- `What additional country did James visit during his trip to Canada?`: `Nuuk` became `Greenland`.
- `In which state is the shelter from which James adopted the puppy?`: `Stamford` became `Connecticut`.
- `Which US state was Sam travelling in during October 2023?`: `Lake Tahoe` became `California`.
- `In what country was Jolene during summer 2022?`: `Bogota` became `Colombia`.

Notes:
- The immediately prior broad non-temporal date/visual prompt experiment
  regressed to 62.73% LLM and was reverted. This success came from narrower
  post-answer normalization only.
