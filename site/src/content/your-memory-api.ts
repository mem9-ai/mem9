import type { SiteApiEndpointGroupCopy, SiteApiPageCopy, SiteLocale } from './site';

const apiKey = [{
  name: 'x-mem9-api-key',
  required: true,
  description: 'Your mem9 API key. The service keeps only a fingerprint of the key.',
}];

const jsonHeaders = [
  ...apiKey,
  { name: 'Content-Type', required: true, description: 'Use `application/json`.' },
];

const field = (name: string, description: string, required = false) => ({ name, description, required });
const path = (name: string) => field(name, 'Path parameter.', true);
const response = (...items: Array<[string, string]>) => items.map(([name, description]) => field(name, description));

const groups: SiteApiEndpointGroupCopy[] = [
  {
    id: 'your-memory-profile',
    title: 'User Profile',
    description: 'Build the Your Memory profile model from saved facts and generated insights.',
    endpoints: [{
      method: 'GET', path: '/v1/user-profile', summary: 'Get the user profile page model.',
      description: 'Returns the profile header, fact statistics, focus areas, long-term goals, emotion insights, preference signals, and growth signals available to the current API key.',
      headers: apiKey,
      responseFields: response(['profile', 'Aggregated user profile and insight sections.'], ['generatedAt', 'Profile generation timestamp.']),
      examples: [{ label: 'Get user profile', code: "curl -sS 'https://your-memory-api.mem9.ai/v1/user-profile' \\\n+  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
    }],
  },
  {
    id: 'your-memory-reports',
    title: 'Memory Analysis Reports',
    description: 'Generate and retrieve asynchronous reports for daily memory insights, focus areas, goals, emotions, preferences, and growth.',
    endpoints: [
      {
        method: 'POST', path: '/v1/memory-analysis', summary: 'Create a memory analysis report job.',
        description: 'Queues an asynchronous report for the requested ISO-8601 time range. This is the compatibility alias of `POST /v1/memory-analysis/report`.',
        headers: apiKey,
        queryParams: [field('createdAfter', 'Inclusive ISO-8601 start timestamp.', true), field('createdBefore', 'Inclusive ISO-8601 end timestamp.', true)],
        responseFields: response(['id', 'Report identifier.'], ['type', 'Report type.'], ['status', 'Queued or processing status.']),
      },
      {
        method: 'POST', path: '/v1/memory-analysis/report', summary: 'Create a memory analysis report job.',
        description: 'Preferred explicit report route. Queues the same asynchronous analysis as the compatibility endpoint.',
        headers: apiKey,
        queryParams: [field('createdAfter', 'Inclusive ISO-8601 start timestamp.', true), field('createdBefore', 'Inclusive ISO-8601 end timestamp.', true)],
        responseFields: response(['id', 'Report identifier.'], ['type', 'Report type.'], ['status', 'Queued or processing status.']),
        examples: [{ label: 'Create report', code: "curl -sS -X POST 'https://your-memory-api.mem9.ai/v1/memory-analysis/report?createdAfter=2026-06-22T00%3A00%3A00.000Z&createdBefore=2026-06-22T23%3A59%3A59.999Z' \\\n+  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
      },
      {
        method: 'GET', path: '/v1/memory-analysis/report/list', summary: 'List memory analysis reports.',
        description: 'Lists reports owned by the current API key, optionally filtered by insight type.',
        headers: apiKey,
        queryParams: [field('type', 'Optional: `memory_analysis`, `focus_area`, `long_term_goal`, `emotion`, `preference_signal`, or `growth_signal`.')],
        responseFields: response(['[]', 'Array of report summaries with status, type, timestamps, and result when available.']),
      },
      {
        method: 'GET', path: '/v1/memory-analysis/report/{report_id}', summary: 'Get one memory analysis report.',
        description: 'Returns the report status and its generated result when processing has completed.',
        headers: apiKey, pathParams: [path('report_id')],
        responseFields: response(['id', 'Report identifier.'], ['status', 'Current processing status.'], ['result', 'Generated report payload when ready.']),
      },
    ],
  },
  {
    id: 'your-memory-source-messages',
    title: 'Source Message Review',
    description: 'Review, correct, inspect, and revert source session messages used by memory analysis.',
    endpoints: [
      {
        method: 'PUT', path: '/v1/memory-analysis/session-messages/{id}/mark', summary: 'Mark a source message as correct or incorrect.',
        description: 'Stores a correctness judgment for a source session message.', headers: jsonHeaders,
        pathParams: [path('id')], bodyFields: [field('correctness', '`correct` or `incorrect`.', true)],
        responseFields: response(['message', 'Updated source message view.'], ['correctness', 'Saved correctness value.']),
      },
      {
        method: 'PUT', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Correct a source session message.',
        description: 'Upserts a correction overlay and invalidates the affected analysis-day cache.', headers: jsonHeaders,
        pathParams: [path('id')], bodyFields: [field('content', 'Corrected non-empty message content.', true), field('tags', 'Optional array of correction tags.'), field('reason', 'Optional reason for the correction.')],
        responseFields: response(['edit', 'Saved correction overlay.'], ['invalidatedDate', 'Analysis date whose cache was invalidated.']),
      },
      {
        method: 'GET', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Get a source message correction.',
        description: 'Returns the current correction overlay for a source session message.', headers: apiKey,
        pathParams: [path('id')], responseFields: response(['edit', 'Current content, tags, reason, and edit metadata.']),
      },
      {
        method: 'DELETE', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Revert a source message correction.',
        description: 'Removes the correction overlay and invalidates the affected analysis-day cache.', headers: apiKey,
        pathParams: [path('id')], responseFields: response(['deleted', 'Whether the overlay was removed.'], ['invalidatedDate', 'Analysis date whose cache was invalidated.']),
      },
    ],
  },
  {
    id: 'your-memory-deep-analysis',
    title: 'Deep Analysis',
    description: 'Create, browse, download cleanup data for, and delete full-memory deep analysis reports.',
    endpoints: [
      {
        method: 'POST', path: '/v1/deep-analysis/reports', summary: 'Create a deep analysis report.',
        description: 'Queues a full-memory analysis and returns `202 Accepted`.', headers: jsonHeaders,
        bodyFields: [field('lang', 'Output language, for example `zh-CN`.', true), field('timezone', 'IANA timezone, for example `Asia/Shanghai`.', true)],
        responseFields: response(['reportId', 'New deep analysis report identifier.'], ['status', 'Initial queued status.']),
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports', summary: 'List deep analysis reports.',
        description: 'Returns a paginated list owned by the current API key.', headers: apiKey,
        queryParams: [field('limit', 'Page size from 1 to 50; default 20.'), field('offset', 'Zero-based offset; default 0.')],
        responseFields: response(['items', 'Deep analysis report summaries.'], ['total', 'Total matching report count.']),
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports/{reportId}', summary: 'Get a deep analysis report.',
        description: 'Returns status, progress, report sections, and duplicate-memory findings when ready.', headers: apiKey,
        pathParams: [path('reportId')], responseFields: response(['report', 'Complete report detail and processing state.']),
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports/{reportId}/duplicates.csv', summary: 'Download duplicate cleanup CSV.',
        description: 'Downloads duplicate-memory candidates as UTF-8 CSV.', headers: apiKey, pathParams: [path('reportId')],
        responseFields: response(['CSV file', 'Attachment containing duplicate cleanup rows.']),
      },
      {
        method: 'POST', path: '/v1/deep-analysis/reports/{reportId}/delete-duplicates', summary: 'Delete duplicate memories.',
        description: 'Queues deletion of duplicates selected by the report and returns `202 Accepted`.', headers: apiKey,
        pathParams: [path('reportId')], responseFields: response(['status', 'Queued duplicate-deletion status.']),
      },
      {
        method: 'DELETE', path: '/v1/deep-analysis/reports/{reportId}', summary: 'Delete a deep analysis report.',
        description: 'Deletes one report owned by the current API key.', headers: apiKey, pathParams: [path('reportId')],
        responseFields: response(['deleted', 'Whether the report was deleted.']),
      },
    ],
  },
  {
    id: 'your-memory-analysis-jobs',
    title: 'Batch Analysis Jobs',
    description: 'Run large client-uploaded analyses in batches and poll incremental results.',
    endpoints: [
      {
        method: 'POST', path: '/v1/analysis-jobs', summary: 'Create a long-running analysis job.',
        description: 'Initializes an upload plan and reserves a job for the expected memory batches.', headers: jsonHeaders,
        bodyFields: [field('dateRange.start', 'ISO-8601 start timestamp.', true), field('dateRange.end', 'ISO-8601 end timestamp.', true), field('expectedTotalMemories', 'Positive expected memory count.', true), field('expectedTotalBatches', 'Positive expected batch count.', true), field('batchSize', 'Positive planned batch size.', true), field('options.lang', 'Output language.', true), field('options.taxonomyVersion', 'Taxonomy version.', true), field('options.llmEnabled', 'Enable LLM enrichment.', true), field('options.includeItems', 'Include analyzed items.', true), field('options.includeSummary', 'Include aggregate summary.', true)],
        responseFields: response(['jobId', 'New analysis job identifier.'], ['status', 'Initial upload status.']),
      },
      {
        method: 'PUT', path: '/v1/analysis-jobs/{jobId}/batches/{batchIndex}', summary: 'Upload one memory batch.',
        description: 'Uploads a zero-indexed batch and queues it for processing. Reusing a batch index supports idempotent retries.', headers: jsonHeaders,
        pathParams: [path('jobId'), path('batchIndex')],
        bodyFields: [field('batchHash', 'Optional idempotency/content hash, maximum 64 characters.'), field('memoryCount', 'Number of memories in this batch.', true), field('memories[].id', 'Memory identifier.', true), field('memories[].content', 'Memory text.', true), field('memories[].createdAt', 'ISO-8601 creation timestamp.', true), field('memories[].metadata', 'Memory metadata object.', true)],
        responseFields: response(['batchIndex', 'Accepted batch index.'], ['status', 'Batch processing status.']),
      },
      { method: 'POST', path: '/v1/analysis-jobs/{jobId}/finalize', summary: 'Finalize batch uploads.', description: 'Signals that all batches have been uploaded so final aggregation can begin.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['status', 'Updated job status.']) },
      { method: 'POST', path: '/v1/analysis-jobs/{jobId}/cancel', summary: 'Cancel an analysis job.', description: 'Cancels an in-flight job owned by the current API key.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['status', 'Cancelled job status.']) },
      { method: 'GET', path: '/v1/analysis-jobs/{jobId}', summary: 'Get an analysis job snapshot.', description: 'Returns progress plus partial aggregate results accumulated so far.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['job', 'Current job status, progress, errors, and aggregate result.']) },
      { method: 'GET', path: '/v1/analysis-jobs/{jobId}/updates', summary: 'Get incremental job updates.', description: 'Returns updates newer than a cursor for efficient polling.', headers: apiKey, pathParams: [path('jobId')], queryParams: [field('cursor', 'Non-negative update cursor; default 0.')], responseFields: response(['updates', 'Ordered updates after the cursor.'], ['nextCursor', 'Cursor for the next poll.']) },
      { method: 'GET', path: '/v1/taxonomy', summary: 'Get the active taxonomy.', description: 'Returns the requested or currently active taxonomy and analysis rule set.', headers: apiKey, queryParams: [field('version', 'Optional taxonomy version.')], responseFields: response(['taxonomy', 'Taxonomy categories, version, and rules.']) },
    ],
  },
  {
    id: 'your-memory-health',
    title: 'Service Status',
    description: 'Unauthenticated probes for deployment and orchestration health checks.',
    endpoints: [
      { method: 'GET', path: '/health/live', summary: 'Check process liveness.', description: 'Returns whether the API process is running.', responseFields: response(['status', 'Liveness status.']) },
      { method: 'GET', path: '/health/ready', summary: 'Check service readiness.', description: 'Checks required dependencies and reports whether the API can serve traffic.', responseFields: response(['status', 'Readiness status.'], ['checks', 'Dependency readiness details.']) },
    ],
  },
];

const zhGroups: Record<string, [string, string]> = {
  'your-memory-profile': ['用户画像', '根据已保存的事实与洞察构建 Your Memory 用户画像。'],
  'your-memory-reports': ['记忆分析报告', '异步生成并读取每日记忆洞察、关注领域、长期目标、情绪、偏好和成长报告。'],
  'your-memory-source-messages': ['来源消息校正', '审核、修正、查看和撤销记忆分析引用的会话消息。'],
  'your-memory-deep-analysis': ['深度分析', '创建、查看、清理重复记忆并删除全量记忆深度分析报告。'],
  'your-memory-analysis-jobs': ['分批分析任务', '分批上传大量记忆，执行长任务并增量轮询结果。'],
  'your-memory-health': ['服务状态', '用于部署与编排的免认证存活和就绪检查。'],
};

export function yourMemoryApiPage(locale: SiteLocale, base: SiteApiPageCopy): SiteApiPageCopy {
  const chinese = locale === 'zh' || locale === 'zh-Hant';
  return {
    ...base,
    meta: { title: 'Your Memory Open API | API Reference', description: 'Your Memory Open API reference.' },
    kicker: 'YOUR MEMORY OPEN API',
    title: chinese ? 'Your Memory Open API 参考' : 'Your Memory Open API reference',
    intro: chinese ? '通过 Open API 读取用户画像、生成洞察报告、校正来源消息，并执行深度或分批记忆分析。' : 'Use the Open API to read user profiles, generate insight reports, correct source messages, and run deep or batched memory analysis.',
    summary: chinese ? '除健康检查外，所有接口都需要 `x-mem9-api-key`。异步创建接口返回任务或报告 ID，请通过对应查询接口获取结果。' : 'All endpoints except health probes require `x-mem9-api-key`. Async creation endpoints return a job or report ID that you poll through the corresponding read endpoint.',
    authTitle: chinese ? 'Base URL 与认证' : 'Base URL & authentication',
    authCards: [
      { title: 'Base URL', body: chinese ? '使用 Your Memory API 的部署地址；本地开发默认使用 `http://127.0.0.1:3000`。' : 'Use your Your Memory API deployment origin. Local development uses `http://127.0.0.1:3000` by default.' },
      { title: 'API key', body: chinese ? '在 `x-mem9-api-key` 请求头中传入 mem9 API key。服务仅保存 key 的指纹。' : 'Send the mem9 API key in `x-mem9-api-key`. The service stores only its fingerprint.' },
      { title: chinese ? '异步处理' : 'Asynchronous work', body: chinese ? '报告和分析任务会异步执行。保存创建响应中的 ID，并通过详情或 updates 接口轮询。' : 'Reports and analysis jobs run asynchronously. Keep the returned ID and poll the detail or updates endpoint.' },
    ],
    quickstartTitle: chinese ? '快速开始' : 'Quick start',
    quickstartDescription: chinese ? '设置 API key，读取画像，然后创建并查询一份记忆分析报告。' : 'Set your API key, read the profile, then create and retrieve a memory analysis report.',
    quickstartSteps: chinese ? ['设置 `MEM9_API_KEY`。', '调用 `GET /v1/user-profile` 读取当前画像。', '调用 `POST /v1/memory-analysis/report` 创建报告。', '使用返回的报告 ID 查询结果。'] : ['Set `MEM9_API_KEY`.', 'Call `GET /v1/user-profile`.', 'Create a report with `POST /v1/memory-analysis/report`.', 'Use the returned report ID to retrieve the result.'],
    quickstartExamples: [{ label: chinese ? '读取用户画像' : 'Read user profile', code: "curl -sS 'http://127.0.0.1:3000/v1/user-profile' \\\n+  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
    endpointGroups: groups.map((group) => chinese && zhGroups[group.id] ? { ...group, title: zhGroups[group.id][0], description: zhGroups[group.id][1] } : group),
    ctaTitle: chinese ? '开始使用 Your Memory' : 'Start with Your Memory',
    ctaBody: chinese ? '登录 Your Memory，使用同一 mem9 API key 查看画像与分析结果。' : 'Open Your Memory and use the same mem9 API key to view profiles and analysis results.',
  };
}
