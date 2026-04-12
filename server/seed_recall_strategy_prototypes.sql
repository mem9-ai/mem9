-- Seed data for recall_strategy_prototypes (v1 router).
-- English prototype rows are the canonical source-of-truth.
-- Each English prototype has exactly one Chinese companion row with the same
-- strategy_class and answer_family.
-- Safe to re-run via the idempotent INSERT ... WHERE NOT EXISTS pattern below.

INSERT INTO recall_strategy_prototypes
  (pattern_text, strategy_class, answer_family, language, source, priority, active, notes)
SELECT *
FROM (
  -- exact_event_temporal
  SELECT 'When did X attend Y?' AS pattern_text, 'exact_event_temporal' AS strategy_class, NULL AS answer_family, 'en' AS language, 'benchmark_derived' AS source, 1 AS priority, 1 AS active, 'Temporal event lookup' AS notes
  UNION ALL SELECT 'X 是什么时候参加 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal event lookup'
  UNION ALL
  SELECT 'What date did X join Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal join-date lookup'
  UNION ALL SELECT 'X 是哪天加入 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal join-date lookup'
  UNION ALL
  SELECT 'When did X sign up for Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal signup lookup'
  UNION ALL SELECT 'X 是什么时候报名 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal signup lookup'
  UNION ALL
  SELECT 'When did X go to Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal event lookup'
  UNION ALL SELECT 'X 是什么时候去 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal event lookup'
  UNION ALL
  SELECT 'When did X meet Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal meeting lookup'
  UNION ALL SELECT 'X 是什么时候见到 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal meeting lookup'
  UNION ALL
  SELECT 'When did X first do Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal first-event lookup'
  UNION ALL SELECT 'X 第一次做 Y 是什么时候？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal first-event lookup'
  UNION ALL
  SELECT 'When was X''s Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal possession/event lookup'
  UNION ALL SELECT 'X 的 Y 是什么时候？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal possession/event lookup'
  UNION ALL
  SELECT 'When is X planning to Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Future temporal lookup'
  UNION ALL SELECT 'X 打算什么时候去做 Y？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Future temporal lookup'
  UNION ALL
  SELECT 'How long ago was X''s Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Relative-time lookup'
  UNION ALL SELECT 'X 的 Y 是多久以前发生的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Relative-time lookup'
  UNION ALL
  SELECT 'When did X adopt Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal adoption lookup'
  UNION ALL SELECT 'X 是什么时候收养 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal adoption lookup'
  UNION ALL
  SELECT 'When did X paint Y?', 'exact_event_temporal', NULL, 'en', 'benchmark_derived', 1, 1, 'Temporal art-event lookup'
  UNION ALL SELECT 'X 是什么时候画 Y 的？', 'exact_event_temporal', NULL, 'zh', 'manual_translation', 1, 1, 'Temporal art-event lookup'

  -- set_aggregation
  UNION ALL
  SELECT 'What events has X participated in?', 'set_aggregation', 'events', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for events'
  UNION ALL SELECT 'X 参加过哪些活动？', 'set_aggregation', 'events', 'zh', 'manual_translation', 1, 1, 'Set aggregation for events'
  UNION ALL
  SELECT 'What books has X read?', 'set_aggregation', 'books', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for books'
  UNION ALL SELECT 'X 读过哪些书？', 'set_aggregation', 'books', 'zh', 'manual_translation', 1, 1, 'Set aggregation for books'
  UNION ALL
  SELECT 'What are X''s pets'' names?', 'set_aggregation', 'pets', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for pet names'
  UNION ALL SELECT 'X 的宠物叫什么名字？', 'set_aggregation', 'pets', 'zh', 'manual_translation', 1, 1, 'Set aggregation for pet names'
  UNION ALL
  SELECT 'What activities does X do?', 'set_aggregation', 'activities', 'en', 'manual', 1, 1, 'Set aggregation for activities'
  UNION ALL SELECT 'X 平时会做哪些活动？', 'set_aggregation', 'activities', 'zh', 'manual_translation', 1, 1, 'Set aggregation for activities'
  UNION ALL
  SELECT 'What activities has X done with family?', 'set_aggregation', 'activities', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for family activities'
  UNION ALL SELECT 'X 和家人一起做过哪些活动？', 'set_aggregation', 'activities', 'zh', 'manual_translation', 1, 1, 'Set aggregation for family activities'
  UNION ALL
  SELECT 'What types of Y has X made?', 'set_aggregation', 'types', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for types'
  UNION ALL SELECT 'X 做过哪些类型的 Y？', 'set_aggregation', 'types', 'zh', 'manual_translation', 1, 1, 'Set aggregation for types'
  UNION ALL
  SELECT 'Who has X helped?', 'set_aggregation', 'people', 'en', 'manual', 1, 1, 'Set aggregation for people'
  UNION ALL SELECT 'X 帮助过哪些人？', 'set_aggregation', 'people', 'zh', 'manual_translation', 1, 1, 'Set aggregation for people'
  UNION ALL
  SELECT 'Who did X work with?', 'set_aggregation', 'people', 'en', 'manual', 1, 1, 'Set aggregation for collaborators'
  UNION ALL SELECT 'X 和谁一起合作过？', 'set_aggregation', 'people', 'zh', 'manual_translation', 1, 1, 'Set aggregation for collaborators'
  UNION ALL
  SELECT 'What are the names of X''s children?', 'set_aggregation', 'people', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for names'
  UNION ALL SELECT 'X 的孩子们叫什么名字？', 'set_aggregation', 'people', 'zh', 'manual_translation', 1, 1, 'Set aggregation for names'
  UNION ALL
  SELECT 'Which city have X and Y both visited?', 'set_aggregation', 'places', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for shared places'
  UNION ALL SELECT 'X 和 Y 都去过哪座城市？', 'set_aggregation', 'places', 'zh', 'manual_translation', 1, 1, 'Set aggregation for shared places'
  UNION ALL
  SELECT 'What symbols or items are important to X?', 'set_aggregation', 'items', 'en', 'benchmark_derived', 1, 1, 'Set aggregation for symbols or items'
  UNION ALL SELECT '哪些象征物或物品对 X 很重要？', 'set_aggregation', 'items', 'zh', 'manual_translation', 1, 1, 'Set aggregation for symbols or items'

  -- count_query
  UNION ALL
  SELECT 'How many times has X done Y?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 做过 Y 多少次？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many children does X have?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 有几个孩子？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many pets does X have?', 'count_query', 'counts', 'en', 'manual', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 有多少只宠物？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many events has X attended?', 'count_query', 'counts', 'en', 'manual', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 参加过多少次活动？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many tournaments has X won?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 赢过多少次比赛？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many places has X visited?', 'count_query', 'counts', 'en', 'manual', 1, 1, 'Numeric count query'
  UNION ALL SELECT 'X 去过多少个地方？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric count query'
  UNION ALL
  SELECT 'How many years passed between X and Y?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Numeric interval query'
  UNION ALL SELECT 'X 和 Y 之间相隔多少年？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric interval query'
  UNION ALL
  SELECT 'How many weeks passed between X and Y?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Numeric interval query'
  UNION ALL SELECT 'X 和 Y 之间相隔多少周？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Numeric interval query'
  UNION ALL
  SELECT 'How many people attended X''s event?', 'count_query', 'counts', 'en', 'benchmark_derived', 1, 1, 'Attendance count query'
  UNION ALL SELECT '有多少人参加了 X 的活动？', 'count_query', 'counts', 'zh', 'manual_translation', 1, 1, 'Attendance count query'

  -- attribute_inference
  UNION ALL
  SELECT 'Would X be considered Y?', 'attribute_inference', 'boolean', 'en', 'manual', 1, 1, 'Attribute inference for modal queries'
  UNION ALL SELECT 'X 会被认为是 Y 吗？', 'attribute_inference', 'boolean', 'zh', 'manual_translation', 1, 1, 'Attribute inference for modal queries'
  UNION ALL
  SELECT 'What might X''s degree be in?', 'attribute_inference', 'education', 'en', 'benchmark_derived', 1, 1, 'Inference over background evidence'
  UNION ALL SELECT 'X 的学位可能是什么专业？', 'attribute_inference', 'education', 'zh', 'manual_translation', 1, 1, 'Inference over background evidence'
  UNION ALL
  SELECT 'What kind of person is X?', 'attribute_inference', 'traits', 'en', 'manual', 1, 1, 'Trait inference from multiple memories'
  UNION ALL SELECT 'X 是什么样的人？', 'attribute_inference', 'traits', 'zh', 'manual_translation', 1, 1, 'Trait inference from multiple memories'
  UNION ALL
  SELECT 'What attributes describe X?', 'attribute_inference', 'traits', 'en', 'manual', 1, 1, 'Trait inference from multiple memories'
  UNION ALL SELECT '哪些特质描述了 X？', 'attribute_inference', 'traits', 'zh', 'manual_translation', 1, 1, 'Trait inference from multiple memories'
  UNION ALL
  SELECT 'What job might X pursue in the future?', 'attribute_inference', 'career', 'en', 'benchmark_derived', 1, 1, 'Career inference from goals and interests'
  UNION ALL SELECT 'X 未来可能从事什么工作？', 'attribute_inference', 'career', 'zh', 'manual_translation', 1, 1, 'Career inference from goals and interests'

  -- exact_entity_lookup
  UNION ALL
  SELECT 'What state did X visit?', 'exact_entity_lookup', 'state', 'en', 'benchmark_derived', 1, 1, 'Exact canonical entity lookup for state answers'
  UNION ALL SELECT 'X 去了哪个州？', 'exact_entity_lookup', 'state', 'zh', 'manual_translation', 1, 1, 'Exact canonical entity lookup for state answers'
  UNION ALL
  SELECT 'In what country was X?', 'exact_entity_lookup', 'country', 'en', 'benchmark_derived', 1, 1, 'Exact canonical entity lookup for country answers'
  UNION ALL SELECT 'X 当时在哪个国家？', 'exact_entity_lookup', 'country', 'zh', 'manual_translation', 1, 1, 'Exact canonical entity lookup for country answers'
  UNION ALL
  SELECT 'What card game is X talking about?', 'exact_entity_lookup', 'game', 'en', 'benchmark_derived', 1, 1, 'Exact canonical entity lookup for game names'
  UNION ALL SELECT 'X 在说什么卡牌游戏？', 'exact_entity_lookup', 'game', 'zh', 'manual_translation', 1, 1, 'Exact canonical entity lookup for game names'
  UNION ALL
  SELECT 'Who is X to Y?', 'exact_entity_lookup', 'name', 'en', 'manual', 1, 1, 'Exact canonical entity lookup for relationship labels'
  UNION ALL SELECT 'X 对 Y 来说是谁？', 'exact_entity_lookup', 'name', 'zh', 'manual_translation', 1, 1, 'Exact canonical entity lookup for relationship labels'
  UNION ALL
  SELECT 'Which composer does X enjoy?', 'exact_entity_lookup', 'composer', 'en', 'manual', 1, 1, 'Exact canonical entity lookup for composer names'
  UNION ALL SELECT 'X 喜欢哪位作曲家？', 'exact_entity_lookup', 'composer', 'zh', 'manual_translation', 1, 1, 'Exact canonical entity lookup for composer names'

  -- default_mixed
  UNION ALL
  SELECT 'What is X''s job?', 'default_mixed', NULL, 'en', 'manual', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 的工作是什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What did X research?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 研究过什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What is X''s relationship status?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 的感情状态是什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'Where did X move from?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 搬家前来自哪里？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What career path has X decided to pursue?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 决定走什么职业方向？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'Who supports X?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT '谁在支持 X？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What has X painted?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 画过什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What instruments does X play?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 会演奏哪些乐器？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What do X''s children like?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 的孩子喜欢什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What does X do to relax?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 会做什么来放松？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'Where has X camped?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 在哪里露营过？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What is X''s identity?', 'default_mixed', NULL, 'en', 'benchmark_derived', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 的身份是什么？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
  UNION ALL
  SELECT 'What subject do X and Y both like?', 'default_mixed', NULL, 'en', 'manual', 1, 1, 'Default mixed recall'
  UNION ALL SELECT 'X 和 Y 都喜欢什么主题？', 'default_mixed', NULL, 'zh', 'manual_translation', 1, 1, 'Default mixed recall'
) AS seed_rows
WHERE NOT EXISTS (
  SELECT 1
  FROM recall_strategy_prototypes existing
  WHERE existing.pattern_text = seed_rows.pattern_text
    AND existing.strategy_class = seed_rows.strategy_class
    AND existing.language = seed_rows.language
);
