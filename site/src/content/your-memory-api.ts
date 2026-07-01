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

const userProfileResponseFields = response(
  ['generatedAt', 'Profile generation timestamp.'],
  ['source', 'Source summary with `memoryTypes` and `memoryCount`.'],
  ['summary', 'Profile summary with `text`, optional `message`, and `evidence`.'],
  ['attributes', 'Profile attribute records.'],
  ['changes', 'Profile attribute change records.'],
  ['items', 'Current priorities, companion styles, and agent constraints.'],
);

const memoryAnalysisReportResponseFields = response(
  ['report_id', 'Numeric report identifier used by the detail endpoint.'],
  ['template_id', 'Report type/template identifier.'],
  ['report_content', 'JSON-encoded report content when `render_status` is `success`; otherwise null.'],
  ['generated_at', 'Report record creation timestamp.'],
  ['started_at', 'Processing start timestamp or null.'],
  ['completed_at', 'Processing completion timestamp or null.'],
  ['startTime', 'Requested analysis range start timestamp or null.'],
  ['endTime', 'Requested analysis range end timestamp or null.'],
  ['render_status', '`queued`, `running`, `success`, or `fail`.'],
  ['report_stage', '`queued`, `fetch_source`, `period_summary`, `aggregation`, `save_result`, `complete`, or `failed`.'],
  ['fail_code', 'Failure code or null.'],
  ['fail_reason', 'Failure explanation or null.'],
  ['memory_count', 'Number of source memories included.'],
);

const deepAnalysisListItemFields = response(
  ['id', 'Deep analysis report identifier.'], ['status', 'Report status.'], ['stage', 'Current processing stage.'],
  ['progressPercent', 'Completion percentage.'], ['lang', 'Report language.'], ['timezone', 'Report timezone.'],
  ['memoryCount', 'Source memory count.'], ['requestedAt', 'Request timestamp.'], ['startedAt', 'Start timestamp or null.'],
  ['completedAt', 'Completion timestamp or null.'], ['errorCode', 'Failure code or null.'], ['errorMessage', 'Failure message or null.'],
  ['preview', 'Report preview or null.'],
);

const groups: SiteApiEndpointGroupCopy[] = [
  {
    id: 'your-memory-profile',
    title: 'User Profile',
    description: 'Build the Your Memory profile model from saved facts and generated insights.',
    endpoints: [{
      method: 'GET', path: '/v1/user-profile', summary: 'Get the user profile page model.',
      description: 'Returns the profile header, fact statistics, focus areas, long-term goals, emotion insights, preference signals, and growth signals available to the current API key.',
      headers: apiKey,
      responseFields: userProfileResponseFields,
      examples: [{ label: 'Get user profile', code: "curl -sS 'https://napi.mem9.ai/v1/user-profile' \\\n  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
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
        responseFields: memoryAnalysisReportResponseFields,
      },
      {
        method: 'POST', path: '/v1/memory-analysis/report', summary: 'Create a memory analysis report job.',
        description: 'Preferred explicit report route. Queues the same asynchronous analysis as the compatibility endpoint.',
        headers: apiKey,
        queryParams: [field('createdAfter', 'Inclusive ISO-8601 start timestamp.', true), field('createdBefore', 'Inclusive ISO-8601 end timestamp.', true)],
        responseFields: memoryAnalysisReportResponseFields,
        examples: [{ label: 'Create report', code: "curl -sS -X POST 'https://napi.mem9.ai/v1/memory-analysis/report?createdAfter=2026-06-22T00%3A00%3A00.000Z&createdBefore=2026-06-22T23%3A59%3A59.999Z' \\\n  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
      },
      {
        method: 'GET', path: '/v1/memory-analysis/report/list', summary: 'List memory analysis reports.',
        description: 'Lists reports owned by the current API key, optionally filtered by insight type.',
        headers: apiKey,
        queryParams: [field('type', 'Optional: `memory_analysis`, `focus_area`, `long_term_goal`, `emotion`, `preference_signal`, or `growth_signal`.')],
        responseFields: memoryAnalysisReportResponseFields.map((item) => ({ ...item, name: `[].${item.name}` })),
      },
      {
        method: 'GET', path: '/v1/memory-analysis/report/{report_id}', summary: 'Get one memory analysis report.',
        description: 'Returns the report status and its generated result when processing has completed.',
        headers: apiKey, pathParams: [path('report_id')],
        responseFields: memoryAnalysisReportResponseFields,
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
        responseFields: response(['id', 'Source message identifier.'], ['correctness', '`correct` or `incorrect`.'], ['version', 'Updated source-message version.']),
      },
      {
        method: 'PUT', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Correct a source session message.',
        description: 'Upserts a correction overlay and invalidates the affected analysis-day cache.', headers: jsonHeaders,
        pathParams: [path('id')], bodyFields: [field('content', 'Corrected non-empty message content.', true), field('tags', 'Optional array of correction tags.'), field('reason', 'Optional reason for the correction.')],
        responseFields: response(['id', 'Source message identifier.'], ['editId', 'Correction overlay identifier.'], ['version', 'Updated version.'], ['correctness', 'Current correctness value or null.'], ['originalContent', 'Original message content.'], ['editedContent', 'Corrected message content.'], ['tags', 'Correction tags or null.'], ['session', 'Updated source session-message view.'], ['invalidatedPeriodKey', 'Invalidated analysis period key or null.']),
      },
      {
        method: 'GET', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Get a source message correction.',
        description: 'Returns the current correction overlay for a source session message.', headers: apiKey,
        pathParams: [path('id')], responseFields: response(['id', 'Source message identifier.'], ['version', 'Current edit version.'], ['correctness', 'Current correctness value or null.'], ['originalContent', 'Original message content.'], ['editedContent', 'Corrected content or null.'], ['tags', 'Correction tags or null.'], ['createdAt', 'Creation timestamp.'], ['updatedAt', 'Last update timestamp.']),
      },
      {
        method: 'DELETE', path: '/v1/memory-analysis/session-messages/{id}/edit', summary: 'Revert a source message correction.',
        description: 'Removes the correction overlay and invalidates the affected analysis-day cache.', headers: apiKey,
        pathParams: [path('id')], responseFields: response(['id', 'Source message identifier.'], ['reverted', 'Whether the correction was reverted.'], ['invalidatedPeriodKey', 'Invalidated analysis period key or null.']),
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
        responseFields: response(['reportId', 'New deep analysis report identifier.'], ['status', 'Initial report status.'], ['stage', 'Initial processing stage.'], ['progressPercent', 'Initial completion percentage.'], ['requestedAt', 'Request timestamp.'], ['memoryCount', 'Source memory count.']),
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports', summary: 'List deep analysis reports.',
        description: 'Returns a paginated list owned by the current API key.', headers: apiKey,
        queryParams: [field('limit', 'Page size from 1 to 50; default 20.'), field('offset', 'Zero-based offset; default 0.')],
        responseFields: [field('reports', 'Array of deep analysis report summaries.'), ...deepAnalysisListItemFields.map((item) => ({ ...item, name: `reports[].${item.name}` })), ...response(['total', 'Total matching report count.'], ['limit', 'Applied page size.'], ['offset', 'Applied zero-based offset.'])],
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports/{reportId}', summary: 'Get a deep analysis report.',
        description: 'Returns status, progress, report sections, and duplicate-memory findings when ready.', headers: apiKey,
        pathParams: [path('reportId')], responseFields: [...deepAnalysisListItemFields, field('report', 'Completed deep-analysis document or null while processing.')],
      },
      {
        method: 'GET', path: '/v1/deep-analysis/reports/{reportId}/duplicates.csv', summary: 'Download duplicate cleanup CSV.',
        description: 'Downloads duplicate-memory candidates as UTF-8 CSV.', headers: apiKey, pathParams: [path('reportId')],
        responseFields: response(['CSV file', 'Attachment containing duplicate cleanup rows.']),
      },
      {
        method: 'POST', path: '/v1/deep-analysis/reports/{reportId}/delete-duplicates', summary: 'Delete duplicate memories.',
        description: 'Queues deletion of duplicates selected by the report and returns `202 Accepted`.', headers: apiKey,
        pathParams: [path('reportId')], responseFields: response(['reportId', 'Deep analysis report identifier.'], ['duplicateCleanup', 'Cleanup status, counts, timestamps, deleted IDs, failed IDs, and error details.']),
      },
      {
        method: 'DELETE', path: '/v1/deep-analysis/reports/{reportId}', summary: 'Delete a deep analysis report.',
        description: 'Deletes one report owned by the current API key.', headers: apiKey, pathParams: [path('reportId')],
        responseFields: response(['reportId', 'Deleted deep analysis report identifier.']),
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
        responseFields: response(['jobId', 'New analysis job identifier.'], ['status', 'Initial job status.'], ['expectedTotalBatches', 'Expected batch count.'], ['uploadConcurrency', 'Recommended concurrent upload count.'], ['pollAfterMs', 'Recommended polling delay in milliseconds.']),
      },
      {
        method: 'PUT', path: '/v1/analysis-jobs/{jobId}/batches/{batchIndex}', summary: 'Upload one memory batch.',
        description: 'Uploads a 1-based batch index and queues it for processing. Reusing a batch index supports idempotent retries.', headers: jsonHeaders,
        pathParams: [path('jobId'), path('batchIndex')],
        bodyFields: [field('batchHash', 'Optional idempotency/content hash, maximum 64 characters.'), field('memoryCount', 'Number of memories in this batch.', true), field('memories[].id', 'Memory identifier.', true), field('memories[].content', 'Memory text.', true), field('memories[].createdAt', 'ISO-8601 creation timestamp.', true), field('memories[].metadata', 'Memory metadata object.', true)],
        responseFields: response(['jobId', 'Analysis job identifier.'], ['batchIndex', 'Accepted batch index.'], ['status', 'Batch processing status.'], ['payloadObjectKey', 'Stored batch payload object key.'], ['payloadHash', 'Canonical payload SHA-256 hash.'], ['queuedAt', 'Queue timestamp.']),
      },
      { method: 'POST', path: '/v1/analysis-jobs/{jobId}/finalize', summary: 'Finalize batch uploads.', description: 'Signals that all batches have been uploaded so final aggregation can begin.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['jobId', 'Analysis job identifier.'], ['status', 'Updated job status.'], ['uploadedBatches', 'Uploaded batch count.'], ['expectedTotalBatches', 'Expected batch count.']) },
      { method: 'POST', path: '/v1/analysis-jobs/{jobId}/cancel', summary: 'Cancel an analysis job.', description: 'Cancels an in-flight job owned by the current API key.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['jobId', 'Analysis job identifier.'], ['status', 'Cancelled job status.']) },
      { method: 'GET', path: '/v1/analysis-jobs/{jobId}', summary: 'Get an analysis job snapshot.', description: 'Returns progress plus partial aggregate results accumulated so far.', headers: apiKey, pathParams: [path('jobId')], responseFields: response(['jobId', 'Analysis job identifier.'], ['status', 'Current job status.'], ['expectedTotalMemories', 'Expected memory count.'], ['expectedTotalBatches', 'Expected batch count.'], ['batchSize', 'Configured batch size.'], ['pipelineVersion', 'Analysis pipeline version.'], ['taxonomyVersion', 'Taxonomy version.'], ['llmEnabled', 'Whether LLM enrichment is enabled.'], ['createdAt', 'Creation timestamp.'], ['startedAt', 'Start timestamp or null.'], ['completedAt', 'Completion timestamp or null.'], ['expiresAt', 'Expiration timestamp or null.'], ['progress', 'Batch and memory progress counters.'], ['aggregate', 'Current aggregate snapshot.'], ['aggregateCards', 'Category summary cards.'], ['topTagStats', 'Top tag statistics.'], ['topTopicStats', 'Top topic statistics.'], ['topTags', 'Top tag values.'], ['topTopics', 'Top topic values.'], ['batchSummaries', 'Per-batch summaries.']) },
      { method: 'GET', path: '/v1/analysis-jobs/{jobId}/updates', summary: 'Get incremental job updates.', description: 'Returns updates newer than a cursor for efficient polling.', headers: apiKey, pathParams: [path('jobId')], queryParams: [field('cursor', 'Non-negative update cursor; default 0.')], responseFields: response(['cursor', 'Requested/current cursor.'], ['nextCursor', 'Cursor for the next poll.'], ['events', 'Ordered analysis events.'], ['completedBatchResults', 'Newly completed batch summaries.'], ['aggregate', 'Current aggregate snapshot.'], ['progress', 'Current progress counters.']) },
      { method: 'GET', path: '/v1/taxonomy', summary: 'Get the active taxonomy.', description: 'Returns the requested or currently active taxonomy and analysis rule set.', headers: apiKey, queryParams: [field('version', 'Optional taxonomy version.')], responseFields: response(['version', 'Taxonomy version.'], ['updatedAt', 'Last update timestamp.'], ['categories', 'Available analysis categories.'], ['rules', 'Taxonomy rule definitions.']) },
    ],
  },
  {
    id: 'your-memory-health',
    title: 'Service Status',
    description: 'Unauthenticated probes for deployment and orchestration health checks.',
    endpoints: [
      { method: 'GET', path: '/health/live', summary: 'Check process liveness.', description: 'Returns whether the API process is running.', responseFields: response(['status', 'Liveness status.']) },
      { method: 'GET', path: '/health/ready', summary: 'Check service readiness.', description: 'Checks required dependencies and reports whether the API can serve traffic.', responseFields: response(['status', 'Returns `ready` when dependencies are available.']) },
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

type LocalizedYourMemoryCopy = {
  title: string; intro: string; summary: string; auth: string; async: string;
  quick: string; quickDescription: string; example: string; cta: string; ctaBody: string;
  groups: Array<[string, string]>; verbs: Record<string, string>; detail: string; field: string;
};

const localizedCopy: Partial<Record<SiteLocale, LocalizedYourMemoryCopy>> = {
  ja: { title: 'Your Memory API リファレンス', intro: 'API でユーザープロファイルの取得、インサイトレポートの生成、ソースメッセージの修正、詳細分析やバッチ分析を実行します。', summary: 'ヘルスチェック以外は `x-mem9-api-key` が必要です。非同期 API が返す ID で結果を取得してください。', auth: 'Base URL と認証', async: '非同期処理', quick: 'クイックスタート', quickDescription: 'API key を設定し、プロファイルと記憶分析レポートを取得します。', example: 'ユーザープロファイルを取得', cta: 'Your Memory を始める', ctaBody: '同じ mem9 API key でプロファイルと分析結果を確認します。', groups: [['ユーザープロファイル', '保存した事実とインサイトからプロファイルを構築します。'], ['記憶分析レポート', '非同期の記憶インサイトレポートを生成・取得します。'], ['ソースメッセージの確認', '分析元の会話メッセージを確認、修正、復元します。'], ['詳細分析', '詳細分析レポートを管理します。'], ['バッチ分析ジョブ', '記憶を分割アップロードして結果を取得します。'], ['サービス状態', 'liveness と readiness を確認します。']], verbs: { GET: '取得', POST: '作成', PUT: '更新', DELETE: '削除' }, detail: '現在の API key の範囲で処理し、結果または状態を返します。', field: 'このリクエストまたはレスポンスのフィールドです。' },
  ko: { title: 'Your Memory API 레퍼런스', intro: 'API로 사용자 프로필을 조회하고 인사이트 보고서를 생성하며 원본 메시지와 메모리 분석을 관리합니다.', summary: '상태 확인을 제외한 모든 API에는 `x-mem9-api-key`가 필요합니다. 비동기 API가 반환한 ID로 결과를 조회하세요.', auth: 'Base URL 및 인증', async: '비동기 처리', quick: '빠른 시작', quickDescription: 'API key를 설정하고 프로필과 메모리 분석 보고서를 조회합니다.', example: '사용자 프로필 조회', cta: 'Your Memory 시작하기', ctaBody: '같은 mem9 API key로 프로필과 분석 결과를 확인합니다.', groups: [['사용자 프로필', '저장된 사실과 인사이트로 프로필을 구성합니다.'], ['메모리 분석 보고서', '비동기 메모리 인사이트 보고서를 생성하고 조회합니다.'], ['원본 메시지 검토', '분석 원본 메시지를 검토, 수정 및 복원합니다.'], ['심층 분석', '심층 분석 보고서를 관리합니다.'], ['배치 분석 작업', '메모리를 배치로 업로드하고 결과를 조회합니다.'], ['서비스 상태', 'liveness 및 readiness를 확인합니다.']], verbs: { GET: '조회', POST: '생성', PUT: '수정', DELETE: '삭제' }, detail: '현재 API key 범위에서 처리하고 결과 또는 상태를 반환합니다.', field: '요청 또는 응답에 사용되는 필드입니다.' },
  id: { title: 'Referensi API Your Memory', intro: 'Gunakan API untuk membaca profil, membuat laporan insight, memperbaiki pesan sumber, dan menjalankan analisis memori.', summary: 'Semua API selain health probe memerlukan `x-mem9-api-key`. Gunakan ID dari API asinkron untuk mengambil hasil.', auth: 'Base URL dan autentikasi', async: 'Proses asinkron', quick: 'Mulai cepat', quickDescription: 'Atur API key lalu ambil profil dan laporan analisis memori.', example: 'Baca profil pengguna', cta: 'Mulai dengan Your Memory', ctaBody: 'Gunakan mem9 API key yang sama untuk melihat profil dan hasil analisis.', groups: [['Profil Pengguna', 'Bangun profil dari fakta dan insight tersimpan.'], ['Laporan Analisis Memori', 'Buat dan ambil laporan insight asinkron.'], ['Tinjauan Pesan Sumber', 'Tinjau, koreksi, dan pulihkan pesan sumber.'], ['Analisis Mendalam', 'Kelola laporan analisis mendalam.'], ['Job Analisis Batch', 'Upload memori secara batch dan ambil hasilnya.'], ['Status Layanan', 'Periksa liveness dan readiness.']], verbs: { GET: 'Ambil', POST: 'Buat', PUT: 'Perbarui', DELETE: 'Hapus' }, detail: 'Memproses data dalam scope API key saat ini dan mengembalikan hasil atau status.', field: 'Field untuk request atau response ini.' },
  th: { title: 'เอกสารอ้างอิง Your Memory API', intro: 'ใช้ API เพื่ออ่านโปรไฟล์ สร้างรายงาน insight แก้ไขข้อความต้นทาง และวิเคราะห์หน่วยความจำ', summary: 'API ทั้งหมดยกเว้น health probe ต้องใช้ `x-mem9-api-key` และใช้ ID จาก API แบบ asynchronous เพื่อดึงผลลัพธ์', auth: 'Base URL และการยืนยันตัวตน', async: 'การประมวลผลแบบ asynchronous', quick: 'เริ่มต้นอย่างรวดเร็ว', quickDescription: 'ตั้งค่า API key แล้วดึงโปรไฟล์และรายงานการวิเคราะห์', example: 'อ่านโปรไฟล์ผู้ใช้', cta: 'เริ่มใช้ Your Memory', ctaBody: 'ใช้ mem9 API key เดียวกันเพื่อดูโปรไฟล์และผลการวิเคราะห์', groups: [['โปรไฟล์ผู้ใช้', 'สร้างโปรไฟล์จากข้อเท็จจริงและ insight ที่บันทึกไว้'], ['รายงานการวิเคราะห์หน่วยความจำ', 'สร้างและดึงรายงาน insight แบบ asynchronous'], ['การตรวจสอบข้อความต้นทาง', 'ตรวจสอบ แก้ไข และย้อนคืนข้อความต้นทาง'], ['การวิเคราะห์เชิงลึก', 'จัดการรายงานการวิเคราะห์เชิงลึก'], ['งานวิเคราะห์แบบ Batch', 'อัปโหลดหน่วยความจำเป็น batch และดึงผลลัพธ์'], ['สถานะบริการ', 'ตรวจสอบ liveness และ readiness']], verbs: { GET: 'ดึง', POST: 'สร้าง', PUT: 'อัปเดต', DELETE: 'ลบ' }, detail: 'ประมวลผลภายใน scope ของ API key ปัจจุบันและคืนผลลัพธ์หรือสถานะ', field: 'Field สำหรับ request หรือ response นี้' },
};

localizedCopy.zh = { title: 'Your Memory API 参考', intro: '通过 API 读取用户画像、生成洞察报告、校正来源消息，并执行深度或分批记忆分析。', summary: '除健康检查外，所有接口都需要 `x-mem9-api-key`。请使用异步接口返回的 ID 查询结果。', auth: 'Base URL 与认证', async: '异步处理', quick: '快速开始', quickDescription: '设置 API key，然后读取画像并创建记忆分析报告。', example: '读取用户画像', cta: '开始使用 Your Memory', ctaBody: '使用同一 mem9 API key 查看画像与分析结果。', groups: Object.values(zhGroups), verbs: { GET: '获取', POST: '创建', PUT: '更新', DELETE: '删除' }, detail: '在当前 API key 范围内执行操作，并返回结果或处理状态。', field: '该请求或响应中的字段。' };
localizedCopy['zh-Hant'] = { title: 'Your Memory API 參考', intro: '透過 API 讀取使用者畫像、產生洞察報告、校正來源訊息，並執行深度或分批記憶分析。', summary: '除健康檢查外，所有介面都需要 `x-mem9-api-key`。請使用非同步介面回傳的 ID 查詢結果。', auth: 'Base URL 與驗證', async: '非同步處理', quick: '快速開始', quickDescription: '設定 API key，然後讀取畫像並建立記憶分析報告。', example: '讀取使用者畫像', cta: '開始使用 Your Memory', ctaBody: '使用同一 mem9 API key 查看畫像與分析結果。', groups: [['使用者畫像', '根據已保存的事實與洞察建立使用者畫像。'], ['記憶分析報告', '產生並讀取各類非同步記憶洞察報告。'], ['來源訊息校正', '審核、修正、查看和撤銷分析引用的會話訊息。'], ['深度分析', '建立、查看、清理和刪除深度分析報告。'], ['分批分析任務', '分批上傳大量記憶並增量查詢分析結果。'], ['服務狀態', '用於部署與編排的存活和就緒檢查。']], verbs: { GET: '取得', POST: '建立', PUT: '更新', DELETE: '刪除' }, detail: '在目前 API key 範圍內執行操作，並回傳結果或處理狀態。', field: '此 request 或 response 中的欄位。' };

function translateGroups(locale: SiteLocale, copy: LocalizedYourMemoryCopy): SiteApiEndpointGroupCopy[] {
  return groups.map((group, index) => ({ ...group, title: copy.groups[index][0], description: copy.groups[index][1], endpoints: group.endpoints.map((endpoint) => ({ ...endpoint, summary: `${copy.verbs[endpoint.method] ?? endpoint.method} ${endpoint.path}`, description: copy.detail, headers: endpoint.headers?.map((item) => ({ ...item, description: copy.field })), pathParams: endpoint.pathParams?.map((item) => ({ ...item, description: copy.field })), queryParams: endpoint.queryParams?.map((item) => ({ ...item, description: copy.field })), bodyFields: endpoint.bodyFields?.map((item) => ({ ...item, description: copy.field })), responseFields: endpoint.responseFields?.map((item) => ({ ...item, description: copy.field })), examples: endpoint.examples?.map((example) => ({ ...example, label: copy.example })) })) }));
}

export function yourMemoryApiPage(locale: SiteLocale, base: SiteApiPageCopy): SiteApiPageCopy {
  const chinese = locale === 'zh' || locale === 'zh-Hant';
  const translated = localizedCopy[locale];
  if (translated) return { ...base, meta: { title: 'Your Memory API | API Reference', description: translated.intro }, kicker: 'YOUR MEMORY API', title: translated.title, intro: translated.intro, summary: translated.summary, authTitle: translated.auth, authCards: [{ title: 'Base URL', body: 'mem9-node API: `https://napi.mem9.ai`' }, { title: 'API key', body: '`x-mem9-api-key`' }, { title: translated.async, body: translated.summary }], quickstartTitle: translated.quick, quickstartDescription: translated.quickDescription, quickstartSteps: ['`MEM9_API_KEY`', '`GET /v1/user-profile`', '`POST /v1/memory-analysis/report`', translated.quickDescription], quickstartExamples: [{ label: translated.example, code: `curl -sS 'https://napi.mem9.ai/v1/user-profile' \\
  -H "x-mem9-api-key: $MEM9_API_KEY"` }], endpointGroups: translateGroups(locale, translated), ctaTitle: translated.cta, ctaBody: translated.ctaBody };
  return {
    ...base,
    meta: { title: 'Your Memory API | API Reference', description: 'Your Memory API reference.' },
    kicker: 'YOUR MEMORY API',
    title: chinese ? 'Your Memory API 参考' : 'Your Memory API reference',
    intro: chinese ? '通过 API 读取用户画像、生成洞察报告、校正来源消息，并执行深度或分批记忆分析。' : 'Use the API to read user profiles, generate insight reports, correct source messages, and run deep or batched memory analysis.',
    summary: chinese ? '除健康检查外，所有接口都需要 `x-mem9-api-key`。异步创建接口返回任务或报告 ID，请通过对应查询接口获取结果。' : 'All endpoints except health probes require `x-mem9-api-key`. Async creation endpoints return a job or report ID that you poll through the corresponding read endpoint.',
    authTitle: chinese ? 'Base URL 与认证' : 'Base URL & authentication',
    authCards: [
      { title: 'Base URL', body: chinese ? 'mem9-node API 的服务地址是 `https://napi.mem9.ai`。' : 'The mem9-node API base URL is `https://napi.mem9.ai`.' },
      { title: 'API key', body: chinese ? '在 `x-mem9-api-key` 请求头中传入 mem9 API key。服务仅保存 key 的指纹。' : 'Send the mem9 API key in `x-mem9-api-key`. The service stores only its fingerprint.' },
      { title: chinese ? '异步处理' : 'Asynchronous work', body: chinese ? '报告和分析任务会异步执行。保存创建响应中的 ID，并通过详情或 updates 接口轮询。' : 'Reports and analysis jobs run asynchronously. Keep the returned ID and poll the detail or updates endpoint.' },
    ],
    quickstartTitle: chinese ? '快速开始' : 'Quick start',
    quickstartDescription: chinese ? '设置 API key，读取画像，然后创建并查询一份记忆分析报告。' : 'Set your API key, read the profile, then create and retrieve a memory analysis report.',
    quickstartSteps: chinese ? ['设置 `MEM9_API_KEY`。', '调用 `GET /v1/user-profile` 读取当前画像。', '调用 `POST /v1/memory-analysis/report` 创建报告。', '使用返回的报告 ID 查询结果。'] : ['Set `MEM9_API_KEY`.', 'Call `GET /v1/user-profile`.', 'Create a report with `POST /v1/memory-analysis/report`.', 'Use the returned report ID to retrieve the result.'],
    quickstartExamples: [{ label: chinese ? '读取用户画像' : 'Read user profile', code: "curl -sS 'https://napi.mem9.ai/v1/user-profile' \\\n  -H \"x-mem9-api-key: $MEM9_API_KEY\"" }],
    endpointGroups: groups.map((group) => chinese && zhGroups[group.id] ? { ...group, title: zhGroups[group.id][0], description: zhGroups[group.id][1] } : group),
    ctaTitle: chinese ? '开始使用 Your Memory' : 'Start with Your Memory',
    ctaBody: chinese ? '登录 Your Memory，使用同一 mem9 API key 查看画像与分析结果。' : 'Open Your Memory and use the same mem9 API key to view profiles and analysis results.',
  };
}
