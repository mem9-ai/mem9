export type SiteLocale = 'en' | 'zh' | 'zh-Hant' | 'ja' | 'ko' | 'id' | 'th';
export type SiteThemePreference = 'light' | 'dark' | 'system';
export type SiteResolvedTheme = 'light' | 'dark';

export const agentGuideTargets = {
  openclaw: {
    href: 'https://mem9.ai/SKILL.md',
    external: true,
  },
  hermes: {
    href: 'https://github.com/mem9-ai/mem9-hermes-plugin#readme',
    external: true,
  },
  claude: {
    href: 'https://github.com/mem9-ai/mem9/tree/main/claude-plugin#readme',
    external: true,
  },
  opencode: {
    href: 'https://github.com/mem9-ai/mem9/tree/main/opencode-plugin#readme',
    external: true,
  },
  codex: {
    href: 'https://github.com/mem9-ai/mem9/tree/main/codex-plugin#readme',
    external: true,
  },
  dify: {
    href: 'https://github.com/mem9-ai/mem9-dify-plugin#readme',
    external: true,
  },
} as const;

export type SiteAgentGuideId = keyof typeof agentGuideTargets;

export interface SiteMeta {
  title: string;
  description: string;
}

export interface SiteNavCopy {
  home: string;
  features: string;
  platforms: string;
  benchmark: string;
  openclaw: string;
  yourMemory: string;
  yourMemoryDescription: string;
  webConsole: string;
  webConsoleDescription: string;
  login: string;
  billing: string;
  security: string;
  faq: string;
  github: string;
  xcom: string;
  docs: string;
  mem9Docs: string;
  consoleDocs: string;
  api: string;
  apiReferences: string;
  releaseNotes: string;
  contact: string;
}

export interface SiteHeroHighlight {
  title: string;
  description: string;
}

export interface SiteHeroFeature {
  title: string;
  description: string;
}

export interface SiteGuideLinkCopy {
  id: SiteAgentGuideId;
  label: string;
}

export interface SiteHeroGuideSelectorCopy {
  label: string;
  items: SiteGuideLinkCopy[];
}

export interface SiteHeroCopy {
  eyebrow: string;
  titleLead: string;
  titleAccent: string;
  subtitle: string;
  guideSelector?: SiteHeroGuideSelectorCopy;
  onboardingLabel: string;
  onboardingBadge: string;
  onboardingHint: string;
  onboardingStableLabel: string;
  onboardingBetaLabel: string;
  onboardingCommandStable: string;
  onboardingCommandBeta: string;
  betaFeature: SiteHeroFeature;
  highlights: SiteHeroHighlight[];
}

export interface SiteTrustCopy {
  title: string;
  body: string;
  supporting: string;
  overviewLabel: string;
  whitePaperLabel: string;
}

export interface SiteLinkCopy {
  label: string;
  href: string;
  external?: boolean;
}

export interface SiteCodeSampleCopy {
  label: string;
  code: string;
}

export interface SiteFaqGroupCopy {
  label: string;
  body?: string;
  example?: SiteCodeSampleCopy;
  link?: SiteLinkCopy;
}

export interface SiteFaqItemCopy {
  question: string;
  answer: string[];
  bullets?: string[];
  groups?: SiteFaqGroupCopy[];
  links?: SiteLinkCopy[];
  examples?: SiteCodeSampleCopy[];
}

export interface SiteFaqCopy {
  kicker: string;
  title: string;
  description: string;
  items: SiteFaqItemCopy[];
}

export interface SiteFeatureItem {
  icon: string;
  title: string;
  description: string;
}

export interface SiteFeaturesCopy {
  kicker: string;
  title: string;
  description: string;
  items: SiteFeatureItem[];
}

export interface SitePlatformItem {
  name: string;
  desc: string;
  detail: string;
  badge?: string;
  guideId?: SiteAgentGuideId;
  href?: string;
  external?: boolean;
}

export interface SitePlatformsCopy {
  kicker: string;
  title: string;
  description: string;
  items: SitePlatformItem[];
  ctaLabel: string;
  guideCtaLabel: string;
  note: string;
}

export interface SiteSecurityProtectionCopy {
  title: string;
  description: string;
}

export interface SiteSecurityPageCopy {
  meta: SiteMeta;
  kicker: string;
  title: string;
  intro: string;
  bridgeBody?: string;
  bridgeCtaLabel?: string;
  dataTitle: string;
  dataBody: string;
  protectionsTitle: string;
  protections: SiteSecurityProtectionCopy[];
  foundationTitle: string;
  foundationBody: string;
  learnMoreTitle: string;
  learnMoreBody: string;
}

export interface SiteBillingTier {
  name: string;
  price: string;
  promoPrice?: string;
  period: string;
  features: string[];
  ctaLabel: string;
  ctaAction: 'alert' | 'mailto';
  highlighted?: boolean;
}

export interface SiteBillingPageCopy {
  meta: SiteMeta;
  kicker: string;
  title: string;
  description: string;
  featureLabels: string[];
  tiers: SiteBillingTier[];
  alertMessage: string;
  contactMessage: string;
  contactCopyLabel: string;
  contactCopiedMessage: string;
  contactCopyFailedMessage: string;
  contactEmail: string;
  modalOkLabel: string;
}

export interface SiteApiFieldCopy {
  name: string;
  description: string;
  required?: boolean;
}

export interface SiteApiEndpointCopy {
  method: string;
  path: string;
  summary: string;
  description?: string;
  notes?: string[];
  headers?: SiteApiFieldCopy[];
  queryParams?: SiteApiFieldCopy[];
  bodyFields?: SiteApiFieldCopy[];
  responseFields?: SiteApiFieldCopy[];
  examples?: SiteCodeSampleCopy[];
}

export interface SiteApiEndpointGroupCopy {
  id: string;
  title: string;
  description: string;
  endpoints: SiteApiEndpointCopy[];
}

export interface SiteApiPageCopy {
  meta: SiteMeta;
  kicker: string;
  title: string;
  intro: string;
  summary: string;
  labels: {
    headers: string;
    queryParams: string;
    body: string;
    response: string;
    examples: string;
    required: string;
    next: string;
    sidebarTitle: string;
    sidebarAuth: string;
    sidebarQuickstart: string;
    apiSearch: string;
    apiSearchPlaceholder: string;
    apiSearchEmpty: string;
    testApi: string;
    testTitle: string;
    close: string;
    closeApiTestModal: string;
    reset: string;
    run: string;
    baseUrl: string;
    pathParams: string;
    jsonBody: string;
    ready: string;
    responseReady: string;
    emptyResponse: string;
    running: string;
    runningRequest: string;
    requestFailed: string;
    pathParameter: string;
    saveFormInfo: string;
    apiTestCorsNotice: string;
  };
  authTitle: string;
  authCards: {
    title: string;
    body: string;
  }[];
  quickstartTitle: string;
  quickstartDescription: string;
  quickstartSteps: string[];
  quickstartExamples: SiteCodeSampleCopy[];
  endpointGroups: SiteApiEndpointGroupCopy[];
  ctaTitle: string;
  ctaBody: string;
  ctaLinks: SiteLinkCopy[];
}

export interface SiteReleaseNoteSource {
  label: string;
  href: string;
}

export interface SiteReleaseNoteSection {
  title: string;
  body?: string;
  items?: string[];
  ordered?: boolean;
}

export interface SiteReleaseNoteItem {
  date: string;
  version: string;
  title: string;
  summary: string;
  sections?: SiteReleaseNoteSection[];
  sources: SiteReleaseNoteSource[];
}

export interface SiteReleaseNoteGroup {
  period: string;
  items: SiteReleaseNoteItem[];
}

export interface SiteReleaseNotesPageCopy {
  meta: SiteMeta;
  kicker: string;
  title: string;
  intro: string;
  heroImageAlt: string;
  starPrompt: string;
  starBadgeAlt: string;
  starBadgeSrc: string;
  starHref: string;
  updatedLabel: string;
  updatedValue: string;
  sourcesLabel: string;
  sourcesFeedback: string;
  groups: SiteReleaseNoteGroup[];
}

type SiteReleaseNoteDraftItem = Omit<SiteReleaseNoteItem, 'sources' | 'version'> & {
  sources?: SiteReleaseNoteSource[];
  version?: string;
};

type SiteReleaseNoteDraftGroup = Omit<SiteReleaseNoteGroup, 'items'> & {
  items: SiteReleaseNoteDraftItem[];
};

type SiteReleaseNotesPageDraft = Omit<SiteReleaseNotesPageCopy, 'groups'> & {
  groups: SiteReleaseNoteDraftGroup[];
};

export interface SiteBenchmarkCategoryScore {
  name: string;
  f1: string;
  llm: string;
  er: string;
}

export interface SiteBenchmarkCopy {
  kicker: string;
  title: string;
  description: string;
  model: string;
  modelLabel: string;
  overallF1: string;
  overallLLM: string;
  overallER: string;
  f1Label: string;
  llmLabel: string;
  erLabel: string;
  categoryLabel: string;
  categories: SiteBenchmarkCategoryScore[];
  source: string;
}

export interface SiteFooterCopy {
  github: string;
  license: string;
  contributing: string;
  security: string;
  contact: string;
  poweredByLabel: string;
  copyright: string;
}

export interface SiteAriaCopy {
  home: string;
  mainMenu: string;
  changeLanguage: string;
  changeTheme: string;
  themeModeLight: string;
  themeModeDark: string;
  themeModeSystem: string;
  copyOnboarding: string;
}

export interface SiteThemeOptionsCopy {
  light: string;
  dark: string;
  system: string;
}

export interface SiteCopyFeedback {
  copied: string;
  copyFailed: string;
}

export interface SiteDictionary {
  meta: SiteMeta;
  nav: SiteNavCopy;
  hero: SiteHeroCopy;
  trust: SiteTrustCopy;
  features: SiteFeaturesCopy;
  platforms: SitePlatformsCopy;
  benchmark: SiteBenchmarkCopy;
  faq: SiteFaqCopy;
  apiPage: SiteApiPageCopy;
  releaseNotesPage: SiteReleaseNotesPageCopy;
  securityPage: SiteSecurityPageCopy;
  billing: SiteBillingPageCopy;
  footer: SiteFooterCopy;
  aria: SiteAriaCopy;
  themeOptions: SiteThemeOptionsCopy;
  copyFeedback: SiteCopyFeedback;
  localeNames: Record<SiteLocale, string>;
}

export const DEFAULT_LOCALE: SiteLocale = 'en';
export const DEFAULT_THEME_PREFERENCE: SiteThemePreference = 'system';
export const LOCALE_STORAGE_KEY = 'mem9.locale';
export const THEME_STORAGE_KEY = 'mem9.theme';
export const siteLocales: SiteLocale[] = ['en', 'zh', 'zh-Hant', 'ja', 'ko', 'id', 'th'];

const localeNames: Record<SiteLocale, string> = {
  en: 'EN',
  zh: '中文（简体）',
  'zh-Hant': '中文（繁體）',
  ja: '日本語',
  ko: '한국어',
  id: 'Indonesian',
  th: 'ไทย',
};

const guideSelectorItems: SiteGuideLinkCopy[] = [
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'hermes', label: 'Hermes Agent' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'codex', label: 'Codex' },
  { id: 'dify', label: 'Dify' },
];

const stableOnboardingCommand =
  'Read https://mem9.ai/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw';
const provisionKeyCode = 'curl -sX POST https://api.mem9.ai/v1alpha1/mem9s';
const exportApiEnvCode = `export API_KEY="your-api-key"
export API="https://api.mem9.ai/v1alpha2/mem9s"`;
const exportChainApiEnvCode = `export CHAIN_API_KEY="your-chain-api-key"
export API="https://api.mem9.ai/v1alpha2/mem9s"
export CHAIN_API="https://api.mem9.ai/v1alpha2/space-chains"`;
const healthCheckCode = 'curl -s https://api.mem9.ai/healthz';
const versionCheckCode = 'curl -s https://api.mem9.ai/versionz';
const createMemoryCode = `curl -sX POST "$API/memories" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Mnemo-Agent-Id: openclaw-main" \\
  -d '{"appId":"docs","content":"Project uses PostgreSQL 15","tags":["tech","database"],"metadata":{"source":"setup-note"}}'`;
const smartIngestCode = `curl -sX POST "$API/memories" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Mnemo-Agent-Id: openclaw-main" \\
  -d '{"appId":"docs","session_id":"ses-001","mode":"smart","sync":true,"messages":[{"role":"user","content":"We use PostgreSQL 15"},{"role":"assistant","content":"Noted."}]}'`;
const listMemoryCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/memories?q=postgres&appId=docs&limit=5"';
const filterMemoryCode =
  'curl -s -H "X-API-Key: $API_KEY" "$API/memories?tags=tech&source=openclaw-main&appId=null&limit=10"';
const keywordListMemoryCode =
  'curl -s -H "X-API-Key: $API_KEY" "$API/memories?q=postgres&search_mode=keyword&appId=docs&limit=10&sort_by=updated_at&sort_dir=desc"';
const getMemoryCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/memories/{id}"';
const updateMemoryCode = `curl -sX PUT "$API/memories/{id}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -H "If-Match: 3" \\
  -d '{"content":"Project uses PostgreSQL 16","tags":["tech","database"]}'`;
const deleteMemoryCode = 'curl -sX DELETE -H "X-API-Key: $API_KEY" "$API/memories/{id}"';
const batchDeleteMemoryCode = `curl -sX POST "$API/memories/batch-delete" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{"ids":["memory-id-1","memory-id-2"]}'`;
const importMemoryFileCode = `curl -sX POST "$API/imports" \\
  -H "X-API-Key: $API_KEY" \\
  -F "file=@memory.json" \\
  -F "file_type=memory" \\
  -F "agent_id=openclaw-main"

# memory.json may include:
# {"appId":"docs","memories":[{"content":"Project uses PostgreSQL 15","appId":"docs"}]}`;
const importSessionFileCode = `curl -sX POST "$API/imports" \\
  -H "X-API-Key: $API_KEY" \\
  -F "file=@session.json" \\
  -F "file_type=session" \\
  -F "session_id=ses-001" \\
  -F "agent_id=openclaw-main"

# session.json may include:
# {"appId":"docs","session_id":"ses-001","messages":[{"role":"user","content":"..."}]}`;
const listImportsCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/imports"';
const getImportCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/imports/{id}"';
const sessionMessagesCode =
  'curl -s -H "X-API-Key: $API_KEY" "$API/session-messages?session_id=ses-001&session_id=ses-002&appId=docs&limit_per_session=20"';
const keyStatusCode = 'curl -s -H "X-API-Key: $API_KEY" https://api.mem9.ai/v1alpha2/status';
const chainKeyStatusCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" https://api.mem9.ai/v1alpha2/status';
const createSpaceChainCode = `curl -sX POST https://api.mem9.ai/v1alpha2/space-chains \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Team Knowledge Chain","description":"Ordered recall across team spaces"}'`;
const getSpaceChainByKeyCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" "$CHAIN_API/by-key"';
const getSpaceChainCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" "$CHAIN_API/{chain_id}"';
const updateSpaceChainCode = `curl -sX PATCH "$CHAIN_API/{chain_id}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CHAIN_API_KEY" \\
  -d '{"name":"Team Knowledge Chain","description":"Updated description"}'`;
const deleteSpaceChainCode = `curl -sX DELETE "$CHAIN_API/{chain_id}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CHAIN_API_KEY" \\
  -d '{"deleted_by_user_id":"user-123"}'`;
const listSpaceChainNodesCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" "$CHAIN_API/{chain_id}/nodes"';
const replaceSpaceChainNodesCode = `curl -sX PUT "$CHAIN_API/{chain_id}/nodes" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CHAIN_API_KEY" \\
  -d '{"nodes":[{"tenant_id":"space_key_a","display_name":"Team"},{"tenant_id":"space_key_b","display_name":"Company"}]}'`;
const listSpaceChainBindingsCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" "$CHAIN_API/{chain_id}/bindings"';
const createSpaceChainBindingCode = `curl -sX POST "$CHAIN_API/{chain_id}/bindings" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CHAIN_API_KEY" \\
  -d '{}'`;
const disableSpaceChainBindingCode = `curl -sX PATCH "$CHAIN_API/{chain_id}/bindings/{binding_id}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CHAIN_API_KEY" \\
  -d '{"disabled":true,"disabled_by_user_id":"user-123"}'`;
const recallSpaceChainCode = 'curl -s -H "X-API-Key: $CHAIN_API_KEY" "$API/memories?q=postgres&scanAll=true&limit=10"';

const faqCopyByLocale: Record<SiteLocale, SiteFaqCopy> = {
  en: {
    kicker: 'FAQ',
    title: 'Common questions',
    description: 'Quick answers about API keys, security, and using mem9.',
    items: [
      {
        question: 'How do I get a mem9 API key?',
        answer: [
          'Pick the path that matches how you use mem9. Each one provisions a key tied to the same memory space.',
        ],
        groups: [
          {
            label: 'For OpenClaw users',
            body: 'Paste this command into your OpenClaw chat. It will install mem9 and provision a key automatically.',
            example: { label: 'Paste in OpenClaw', code: stableOnboardingCommand },
          },
          {
            label: 'For other agents',
            body: 'Open the setup guide for your agent. They ship a one-step install or plugin readme that handles the key for you.',
            link: { label: 'See all supported agents', href: '#platforms' },
          },
          {
            label: 'For custom integrations',
            body: 'Provision a key yourself via the HTTP API, then pass it as the `X-API-Key` header.',
            example: { label: 'Provision via API', code: provisionKeyCode },
            link: { label: 'Open API reference', href: '/api' },
          },
        ],
      },
      {
        question: 'How should I keep my API key safe?',
        answer: [
          'Treat your API key like a password. Anyone with the key can read and write your memories.',
        ],
        bullets: [
          'Store it in a password manager or a controlled secret store.',
          'Never commit it to a repository, paste it into screenshots, or share it in public channels.',
          'If a key is leaked, rotate it by provisioning a new one.',
        ],
      },
      {
        question: 'Can I reuse the same API key across machines and agents?',
        answer: [
          'Yes. The same key connects to the same memory space from any machine, agent, or the Your Memory dashboard.',
        ],
      },
      {
        question: 'What can I do with the mem9 API?',
        answer: [
          'Read, write, search, and manage memories and sessions. Most integrations use the `v1alpha2` endpoints with the `X-API-Key` header.',
        ],
        links: [{ label: 'Browse all endpoints', href: '/api' }],
      },
      {
        question: 'Is my data secure?',
        answer: [
          'mem9 runs on enterprise-grade cloud infrastructure with encryption in transit and at rest, plus access controls and audit logging.',
        ],
        links: [{ label: 'Jump to security overview', href: '/#security' }],
      },
    ],
  },
  zh: {
    kicker: 'FAQ',
    title: '常见问题',
    description: '关于 API Key、安全和使用 mem9 的快速解答。',
    items: [
      {
        question: '如何获取 mem9 API key？',
        answer: [
          '按你使用 mem9 的方式选择一种获取方式，每条路径都会绑定到同一个记忆空间。',
        ],
        groups: [
          {
            label: 'OpenClaw 用户',
            body: '把下面这条命令粘贴到 OpenClaw 对话中，它会自动为你安装 mem9 并申请 API Key。',
            example: { label: '粘贴到 OpenClaw', code: stableOnboardingCommand },
          },
          {
            label: '使用其他 Agent',
            body: '打开你所用 Agent 的接入指南，它们都会有一键安装或插件 readme，自动帮你完成 Key 的申请。',
            link: { label: '查看所有支持的 Agent', href: '#platforms' },
          },
          {
            label: '自己集成',
            body: '通过 HTTP API 自己申请一个 Key，然后用 `X-API-Key` 请求头携带它。',
            example: { label: '通过 API 申请', code: provisionKeyCode },
            link: { label: '打开 API 文档', href: '/api' },
          },
        ],
      },
      {
        question: '如何保护我的 API key？',
        answer: [
          '请把 API Key 当作密码对待，任何拿到它的人都能读写你的记忆。',
        ],
        bullets: [
          '存放在密码管理器或受控的 secret store 中。',
          '不要提交到代码仓库、出现在截图里，也不要发到公开聊天频道。',
          '一旦泄漏，请立即申请一个新的 Key 替换。',
        ],
      },
      {
        question: '同一个 API key 可以在不同机器和 Agent 中复用吗？',
        answer: [
          '可以。同一个 Key 在任意机器、Agent 或 Your Memory 面板中都连接到同一个记忆空间。',
        ],
      },
      {
        question: 'mem9 API 能做什么？',
        answer: [
          '读写、搜索和管理你的记忆与会话。大多数集成使用带有 `X-API-Key` 请求头的 `v1alpha2` 接口。',
        ],
        links: [{ label: '查看全部接口', href: '/api' }],
      },
      {
        question: 'mem9 安全吗？',
        answer: [
          'mem9 运行在企业级云基础设施上，提供传输与静态加密、访问控制以及审计日志。',
        ],
        links: [{ label: '跳转到安全概览', href: '/#security' }],
      },
    ],
  },
  'zh-Hant': {
    kicker: 'FAQ',
    title: '常見問題',
    description: '關於 API Key、安全和使用 mem9 的快速解答。',
    items: [
      {
        question: '如何取得 mem9 API key？',
        answer: [
          '依你使用 mem9 的方式挑一條路徑，每條都會綁定到同一個記憶空間。',
        ],
        groups: [
          {
            label: 'OpenClaw 用戶',
            body: '把下面這條命令貼到 OpenClaw 對話中，它會自動為你安裝 mem9 並申請 API Key。',
            example: { label: '貼到 OpenClaw', code: stableOnboardingCommand },
          },
          {
            label: '使用其他 Agent',
            body: '開啟你所用 Agent 的接入指南，它們都會有一鍵安裝或外掛 readme，自動幫你完成 Key 的申請。',
            link: { label: '查看所有支援的 Agent', href: '#platforms' },
          },
          {
            label: '自己整合',
            body: '透過 HTTP API 自己申請一個 Key，再用 `X-API-Key` 請求頭帶上它。',
            example: { label: '透過 API 申請', code: provisionKeyCode },
            link: { label: '打開 API 文件', href: '/api' },
          },
        ],
      },
      {
        question: '如何保護我的 API key？',
        answer: [
          '請把 API Key 當作密碼對待，任何拿到它的人都能讀寫你的記憶。',
        ],
        bullets: [
          '存放在密碼管理器或受控的 secret store 中。',
          '不要提交到程式碼倉庫、出現在截圖裡，也不要貼到公開聊天頻道。',
          '一旦外洩，請立即申請一個新的 Key 替換。',
        ],
      },
      {
        question: '同一個 API key 可以在不同機器和 Agent 中重複使用嗎？',
        answer: [
          '可以。同一個 Key 在任意機器、Agent 或 Your Memory 面板中都連接到同一個記憶空間。',
        ],
      },
      {
        question: 'mem9 API 能做什麼？',
        answer: [
          '讀寫、搜尋和管理你的記憶與會話。大多數整合使用帶有 `X-API-Key` 請求頭的 `v1alpha2` 介面。',
        ],
        links: [{ label: '查看全部端點', href: '/api' }],
      },
      {
        question: 'mem9 安全嗎？',
        answer: [
          'mem9 運行在企業級雲端基礎設施上，提供傳輸與靜態加密、存取控制以及稽核日誌。',
        ],
        links: [{ label: '跳到安全概覽', href: '/#security' }],
      },
    ],
  },
  ja: {
    kicker: 'FAQ',
    title: 'よくある質問',
    description: 'API Key、セキュリティ、mem9 の使い方についての簡単な回答です。',
    items: [
      {
        question: 'mem9 API key はどう取得しますか？',
        answer: [
          'mem9 の使い方に合わせてパスを選んでください。どのパスでも同じメモリ空間に紐づく Key が発行されます。',
        ],
        groups: [
          {
            label: 'OpenClaw ユーザー',
            body: 'このコマンドを OpenClaw のチャットに貼り付けてください。OpenClaw が mem9 をインストールし、API Key を自動発行します。',
            example: { label: 'OpenClaw に貼り付け', code: stableOnboardingCommand },
          },
          {
            label: 'その他のエージェント',
            body: '使用しているエージェントのセットアップガイドを開いてください。各ガイドにワンステップのインストールやプラグイン readme があり、Key の発行も自動で行われます。',
            link: { label: '対応エージェント一覧へ', href: '#platforms' },
          },
          {
            label: '独自連携を作る場合',
            body: 'HTTP API 経由で自分で Key を発行し、`X-API-Key` ヘッダーに乗せてください。',
            example: { label: 'API で発行', code: provisionKeyCode },
            link: { label: 'API リファレンスを開く', href: '/api' },
          },
        ],
      },
      {
        question: 'API key はどう安全に保管すべきですか？',
        answer: [
          'API Key はパスワードと同様に扱ってください。Key を持つ人はあなたのメモリを読み書きできます。',
        ],
        bullets: [
          'パスワードマネージャーや管理された secret store に保存します。',
          'リポジトリへのコミット、スクリーンショットへの露出、公開チャネルでの共有は避けます。',
          '漏洩した場合は、新しい Key を発行してローテーションしてください。',
        ],
      },
      {
        question: 'マシンやエージェントをまたいで同じ API key を使えますか？',
        answer: [
          'はい。同じ Key であれば、どのマシンやエージェントからでも、Your Memory ダッシュボードからでも、同じメモリ空間に接続できます。',
        ],
      },
      {
        question: 'mem9 API では何ができますか？',
        answer: [
          'メモリやセッションの読み書き、検索、管理ができます。ほとんどの連携では `X-API-Key` ヘッダー付きの `v1alpha2` エンドポイントを使用します。',
        ],
        links: [{ label: '全エンドポイントを見る', href: '/api' }],
      },
      {
        question: 'データは安全ですか？',
        answer: [
          'mem9 はエンタープライズ級のクラウド基盤上で運用され、転送時・保存時の暗号化、アクセス制御、監査ログを備えています。',
        ],
        links: [{ label: 'Security overview へ移動', href: '/#security' }],
      },
    ],
  },
  ko: {
    kicker: 'FAQ',
    title: '자주 묻는 질문',
    description: 'API Key, 보안, mem9 사용법에 대한 빠른 답변입니다.',
    items: [
      {
        question: 'mem9 API key 는 어떻게 얻나요?',
        answer: [
          'mem9 사용 방식에 맞는 경로를 선택하세요. 모든 경로는 같은 메모리 공간에 연결되는 Key를 발급합니다.',
        ],
        groups: [
          {
            label: 'OpenClaw 사용자',
            body: '이 명령어를 OpenClaw 채팅에 붙여넣으세요. OpenClaw가 mem9를 설치하고 API Key를 자동 발급합니다.',
            example: { label: 'OpenClaw에 붙여넣기', code: stableOnboardingCommand },
          },
          {
            label: '다른 에이전트',
            body: '사용 중인 에이전트의 설정 가이드를 여세요. 가이드에는 한 번에 설치되는 명령이나 플러그인 readme가 있어 Key 발급도 자동으로 처리됩니다.',
            link: { label: '지원 에이전트 보기', href: '#platforms' },
          },
          {
            label: '자체 통합',
            body: 'HTTP API로 Key를 직접 발급한 뒤 `X-API-Key` 헤더에 실어 보내세요.',
            example: { label: 'API로 발급', code: provisionKeyCode },
            link: { label: 'API 레퍼런스 열기', href: '/api' },
          },
        ],
      },
      {
        question: 'API key 를 어떻게 안전하게 보관하나요?',
        answer: [
          'API Key는 비밀번호처럼 다루세요. Key를 가진 사람은 누구나 당신의 메모리를 읽고 쓸 수 있습니다.',
        ],
        bullets: [
          '비밀번호 관리자나 통제된 secret store에 보관합니다.',
          '저장소에 커밋하거나, 스크린샷에 노출하거나, 공개 채널에 공유하지 마세요.',
          '유출되었다면 즉시 새 Key를 발급해 교체하세요.',
        ],
      },
      {
        question: '여러 머신과 에이전트에서 같은 API key 를 재사용할 수 있나요?',
        answer: [
          '네. 같은 Key는 어느 머신, 에이전트, Your Memory 대시보드에서든 같은 메모리 공간에 연결됩니다.',
        ],
      },
      {
        question: 'mem9 API 로 무엇을 할 수 있나요?',
        answer: [
          '메모리와 세션을 읽고, 쓰고, 검색하고 관리할 수 있습니다. 대부분의 통합은 `X-API-Key` 헤더와 함께 `v1alpha2` 엔드포인트를 사용합니다.',
        ],
        links: [{ label: '전체 엔드포인트 보기', href: '/api' }],
      },
      {
        question: '데이터는 안전한가요?',
        answer: [
          'mem9는 전송 중과 저장 시 암호화, 접근 제어, 감사 로그를 갖춘 엔터프라이즈급 클라우드 인프라에서 실행됩니다.',
        ],
        links: [{ label: 'Security overview 로 이동', href: '/#security' }],
      },
    ],
  },
  id: {
    kicker: 'FAQ',
    title: 'Pertanyaan Umum',
    description: 'Jawaban cepat tentang API key, keamanan, dan penggunaan mem9.',
    items: [
      {
        question: 'Bagaimana cara mendapatkan mem9 API key?',
        answer: [
          'Pilih jalur yang sesuai dengan cara Anda memakai mem9. Semua jalur menghasilkan Key yang terhubung ke ruang memori yang sama.',
        ],
        groups: [
          {
            label: 'Pengguna OpenClaw',
            body: 'Tempelkan perintah ini ke obrolan OpenClaw Anda. OpenClaw akan menginstal mem9 dan menyediakan API Key secara otomatis.',
            example: { label: 'Tempel di OpenClaw', code: stableOnboardingCommand },
          },
          {
            label: 'Agent lain',
            body: 'Buka panduan setup untuk agent Anda. Masing-masing menyediakan instalasi satu langkah atau readme plugin yang juga mengurus pembuatan Key.',
            link: { label: 'Lihat semua agent yang didukung', href: '#platforms' },
          },
          {
            label: 'Integrasi kustom',
            body: 'Buat Key sendiri lewat HTTP API, lalu kirim sebagai header `X-API-Key`.',
            example: { label: 'Buat via API', code: provisionKeyCode },
            link: { label: 'Buka referensi API', href: '/api' },
          },
        ],
      },
      {
        question: 'Bagaimana cara menjaga keamanan API key?',
        answer: [
          'Perlakukan API Key seperti kata sandi. Siapa pun yang memiliki Key dapat membaca dan menulis memori Anda.',
        ],
        bullets: [
          'Simpan di password manager atau secret store yang terkontrol.',
          'Jangan commit ke repository, jangan tampilkan di screenshot, dan jangan bagikan di channel publik.',
          'Jika bocor, segera rotasi dengan membuat Key baru.',
        ],
      },
      {
        question: 'Bisakah saya menggunakan API key yang sama di beberapa mesin dan agent?',
        answer: [
          'Ya. Key yang sama terhubung ke ruang memori yang sama dari mesin, agent, atau dasbor Your Memory mana pun.',
        ],
      },
      {
        question: 'Apa saja yang bisa dilakukan dengan mem9 API?',
        answer: [
          'Membaca, menulis, mencari, dan mengelola memori serta sesi. Sebagian besar integrasi menggunakan endpoint `v1alpha2` dengan header `X-API-Key`.',
        ],
        links: [{ label: 'Lihat semua endpoint', href: '/api' }],
      },
      {
        question: 'Apakah data saya aman?',
        answer: [
          'mem9 berjalan di infrastruktur cloud kelas enterprise dengan enkripsi saat transit dan saat tersimpan, kontrol akses, dan log audit.',
        ],
        links: [{ label: 'Lompat ke ringkasan security', href: '/#security' }],
      },
    ],
  },
  th: {
    kicker: 'FAQ',
    title: 'คำถามที่พบบ่อย',
    description: 'คำตอบด่วนเกี่ยวกับ API Key ความปลอดภัย และการใช้งาน mem9',
    items: [
      {
        question: 'จะขอ mem9 API key ได้อย่างไร?',
        answer: [
          'เลือกเส้นทางที่ตรงกับวิธีใช้ mem9 ของคุณ ทุกเส้นทางจะออก Key ที่ผูกกับพื้นที่หน่วยความจำเดียวกัน',
        ],
        groups: [
          {
            label: 'ผู้ใช้ OpenClaw',
            body: 'วางคำสั่งนี้ลงในแชท OpenClaw แล้ว OpenClaw จะติดตั้ง mem9 และออก API Key ให้คุณโดยอัตโนมัติ',
            example: { label: 'วางใน OpenClaw', code: stableOnboardingCommand },
          },
          {
            label: 'เอเจนต์อื่น ๆ',
            body: 'เปิดคู่มือตั้งค่าของเอเจนต์ที่คุณใช้ ทุกคู่มือมีคำสั่งติดตั้งหรือ readme ของปลั๊กอิน ที่จัดการเรื่องการขอ Key ให้เรียบร้อย',
            link: { label: 'ดูเอเจนต์ที่รองรับ', href: '#platforms' },
          },
          {
            label: 'สร้างการเชื่อมต่อเอง',
            body: 'สร้าง Key ผ่าน HTTP API ของเรา แล้วส่งผ่าน header `X-API-Key`',
            example: { label: 'ออก Key ผ่าน API', code: provisionKeyCode },
            link: { label: 'เปิดเอกสาร API', href: '/api' },
          },
        ],
      },
      {
        question: 'จะรักษาความปลอดภัยของ API key อย่างไร?',
        answer: [
          'ปฏิบัติกับ API Key เหมือนรหัสผ่าน ใครก็ตามที่มี Key สามารถอ่านและเขียนหน่วยความจำของคุณได้',
        ],
        bullets: [
          'เก็บไว้ใน password manager หรือ secret store ที่ควบคุมได้',
          'อย่า commit ลง repository อย่าให้ติดใน screenshot และอย่าแชร์ในช่องทางสาธารณะ',
          'หากรั่วไหล ให้สร้าง Key ใหม่เพื่อหมุนเวียนทันที',
        ],
      },
      {
        question: 'ใช้ API key เดียวกันข้ามเครื่องและเอเจนต์ได้ไหม?',
        answer: [
          'ได้ Key เดียวกันเชื่อมต่อกับพื้นที่หน่วยความจำเดียวกันจากทุกเครื่อง เอเจนต์ หรือแดชบอร์ด Your Memory',
        ],
      },
      {
        question: 'mem9 API ทำอะไรได้บ้าง?',
        answer: [
          'อ่าน เขียน ค้นหา และจัดการหน่วยความจำกับเซสชัน การผสานการทำงานส่วนใหญ่ใช้ endpoint `v1alpha2` พร้อม header `X-API-Key`',
        ],
        links: [{ label: 'ดู endpoint ทั้งหมด', href: '/api' }],
      },
      {
        question: 'ข้อมูลของฉันปลอดภัยไหม?',
        answer: [
          'mem9 ทำงานบนโครงสร้างพื้นฐานคลาวด์ระดับองค์กร พร้อมการเข้ารหัสทั้งขณะส่งและขณะเก็บ การควบคุมสิทธิ์ และ audit log',
        ],
        links: [{ label: 'ไปที่ security overview', href: '/#security' }],
      },
    ],
  },
};

const hostedReadHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'mem9 API key for your space.', required: true },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const hostedJSONWriteHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'mem9 API key for your space.', required: true },
  { name: 'Content-Type', description: 'Set to `application/json` for JSON request bodies.', required: true },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const hostedUpdateHeaders: SiteApiFieldCopy[] = [
  ...hostedJSONWriteHeaders,
  { name: 'If-Match', description: 'Optional version guard for optimistic updates.' },
];

const hostedMultipartHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'mem9 API key for your space.', required: true },
  {
    name: 'Content-Type',
    description: 'Your HTTP client sends this as `multipart/form-data`.',
    required: true,
  },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const chainManagementHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'Active Space Chain API key for this chain.', required: true },
];

const chainJSONWriteHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'Active Space Chain API key for this chain.', required: true },
  { name: 'Content-Type', description: 'Set to `application/json` for JSON request bodies.', required: true },
];

const memoryCreateBodyFields: SiteApiFieldCopy[] = [
  { name: 'content', description: 'Plain memory content for direct writes. Required when `messages` is absent.' },
  { name: 'messages', description: 'Conversation messages for ingest-based writes. Required when `content` is absent.' },
  {
    name: 'appId',
    description:
      'Optional application isolation id, max 100 characters. Omitted, null, empty, or whitespace values write to the default/global appId; non-empty values are trimmed and stored exactly.',
  },
  { name: 'memory_type', description: 'Only accepted with `content` writes. Use `insight` or `pinned`; defaults to `insight`.' },
  { name: 'agent_id', description: 'Optional agent id to store with the write.' },
  { name: 'session_id', description: 'Optional session id for ingest or attribution.' },
  { name: 'tags', description: 'Optional string tags stored on the memory.' },
  { name: 'metadata', description: 'Optional JSON metadata payload.' },
  { name: 'mode', description: 'Ingest mode such as `smart` or `raw` when using `messages`.' },
  { name: 'sync', description: 'When true, wait for completion before returning.' },
  { name: 'disableSessionSave', description: 'Message ingest only. When true, skip raw session persistence and only extract/reconcile facts.' },
];

const memoryListQueryParams: SiteApiFieldCopy[] = [
  { name: 'q', description: 'Search query. Omit to list memories by filters.' },
  {
    name: 'search_mode',
    description:
      'Optional search behavior. Use `keyword` for direct content substring matching in list UIs; omit it for the default recall-style search.',
  },
  { name: 'tags', description: 'Comma-separated tag filter.' },
  { name: 'source', description: 'Filter by stored source value.' },
  { name: 'state', description: 'Filter by lifecycle state such as `active` or `archived`.' },
  { name: 'memory_type', description: 'Filter by `insight`, `pinned`, or `session`.' },
  { name: 'agent_id', description: 'Filter by agent id.' },
  { name: 'session_id', description: 'Filter by session id.' },
  {
    name: 'appId',
    description:
      'Optional appId filter. Omit to search all appIds, pass a value for exact isolation, or use `appId=null` / `appId=` for default/global.',
  },
  { name: 'limit', description: 'Page size. The handler caps large values.' },
  { name: 'offset', description: 'Offset for pagination.' },
  { name: 'sort_by', description: 'Sort field used when listing memories, such as `updated_at`.' },
  { name: 'sort_dir', description: 'Sort direction, `asc` or `desc`.' },
  {
    name: 'scanAll',
    description:
      'Space Chain keys only. When true, recall searches every node and globally reranks the merged facts.',
  },
];

const memoryUpdateBodyFields: SiteApiFieldCopy[] = [
  { name: 'content', description: 'Updated memory content.' },
  { name: 'tags', description: 'Updated tag array.' },
  { name: 'metadata', description: 'Updated JSON metadata payload.' },
];

const batchDeleteBodyFields: SiteApiFieldCopy[] = [
  { name: 'ids', description: 'Array of memory ids to delete.', required: true },
];

const importBodyFields: SiteApiFieldCopy[] = [
  { name: 'file', description: 'Uploaded file payload.', required: true },
  { name: 'file_type', description: 'Use `memory` or `session`.', required: true },
  { name: 'agent_id', description: 'Optional agent id for attribution.' },
  { name: 'session_id', description: 'Required when uploading `session` files.' },
  { name: 'file.appId', description: 'Optional top-level appId inside JSON memory/session files.' },
  { name: 'file.memories[].appId', description: 'Optional per-memory appId override inside JSON memory files.' },
  { name: 'file.sessions[].appId', description: 'Optional per-session appId override inside JSON session files.' },
];

const sessionMessagesQueryParams: SiteApiFieldCopy[] = [
  { name: 'session_id', description: 'Repeat this query param for each session to fetch.', required: true },
  {
    name: 'appId',
    description:
      'Optional appId filter. Omit to fetch matching sessions across all appIds, or use `appId=null` / `appId=` for default/global.',
  },
  { name: 'limit_per_session', description: 'Optional per-session row limit.' },
];

const provisionResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'The newly provisioned mem9 API key / space identifier.', required: true },
];

const healthResponseFields: SiteApiFieldCopy[] = [
  { name: 'status', description: 'Health status string. Hosted service returns `ok`.', required: true },
];

const versionResponseFields: SiteApiFieldCopy[] = [
  { name: 'go_version', description: 'Go runtime version used by the server.', required: true },
  { name: 'started_at', description: 'Server start timestamp.', required: true },
];

const keyStatusResponseFields: SiteApiFieldCopy[] = [
  { name: 'status', description: '`active` when the key can be used, otherwise `inactive`.', required: true },
];

const memoryListResponseFields: SiteApiFieldCopy[] = [
  { name: 'memories', description: 'Array of memory objects for the current page.', required: true },
  { name: 'total', description: 'Total matched rows before pagination.', required: true },
  { name: 'limit', description: 'Applied page size.', required: true },
  { name: 'offset', description: 'Applied page offset.', required: true },
];

const memoryObjectResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'Memory id.', required: true },
  { name: 'content', description: 'Stored memory content.', required: true },
  { name: 'memory_type', description: 'Memory type such as `insight`, `pinned`, or `session`.', required: true },
  { name: 'appId', description: 'Application isolation id. Empty string means default/global.' },
  { name: 'source', description: 'Stored source value when present.' },
  { name: 'tags', description: 'String tag array when present.' },
  { name: 'metadata', description: 'Raw JSON metadata when present.' },
  { name: 'agent_id', description: 'Agent id associated with the memory when present.' },
  { name: 'session_id', description: 'Session id associated with the memory when present.' },
  { name: 'updated_by', description: 'Agent or actor that last updated the memory when present.' },
  { name: 'superseded_by', description: 'Replacement memory id when this memory has been superseded.' },
  { name: 'state', description: 'Lifecycle state.', required: true },
  { name: 'version', description: 'Current integer version.', required: true },
  { name: 'created_at', description: 'Creation timestamp.', required: true },
  { name: 'updated_at', description: 'Last update timestamp.', required: true },
  { name: 'score', description: 'Search relevance score when returned by search endpoints.' },
  { name: 'confidence', description: 'Recall confidence score when returned by recall-style search.' },
  { name: 'relative_age', description: 'Human-readable recency string populated for query-time search results.' },
];

const statusOnlyResponseFields: SiteApiFieldCopy[] = [
  { name: 'status', description: 'Handler result such as `ok` or `accepted`.', required: true },
];

const importTaskResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'Task id for polling.', required: true },
  { name: 'status', description: 'Initial task status such as `pending`.', required: true },
];

const importTaskListResponseFields: SiteApiFieldCopy[] = [
  { name: 'status', description: 'Aggregate task status for the tenant.', required: true },
  { name: 'tasks', description: 'Array of import task summaries.', required: true },
];

const importTaskDetailResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'Task id.', required: true },
  { name: 'file', description: 'Uploaded file name.', required: true },
  { name: 'status', description: 'Task status.', required: true },
  { name: 'total', description: 'Total chunk count.', required: true },
  { name: 'done', description: 'Completed chunk count.', required: true },
  { name: 'error', description: 'Error message when the task fails.' },
];

const sessionMessagesResponseFields: SiteApiFieldCopy[] = [
  { name: 'messages', description: 'Array of captured session message rows.', required: true },
  { name: 'messages[].id', description: 'Session message row id.', required: true },
  { name: 'messages[].session_id', description: 'Session id for the row.' },
  { name: 'messages[].agent_id', description: 'Agent id for the row when present.' },
  { name: 'messages[].appId', description: 'Application isolation id for each raw session row.' },
  { name: 'messages[].seq', description: 'Sequence number within the session.', required: true },
  { name: 'messages[].role', description: 'Message role such as `user` or `assistant`.', required: true },
  { name: 'messages[].content', description: 'Message content.', required: true },
  { name: 'messages[].content_type', description: 'Content type for the captured message.', required: true },
  { name: 'messages[].tags', description: 'Captured tags for the row.', required: true },
  { name: 'messages[].state', description: 'Lifecycle state for the row.', required: true },
  { name: 'messages[].created_at', description: 'Creation timestamp.', required: true },
  { name: 'messages[].updated_at', description: 'Last update timestamp.', required: true },
  { name: 'limit_per_session', description: 'Applied per-session limit.', required: true },
];

const spaceChainCreateBodyFields: SiteApiFieldCopy[] = [
  { name: 'name', description: 'Human-readable Space Chain name.', required: true },
  { name: 'project_id', description: 'Optional project id for control-plane ownership.' },
  { name: 'description', description: 'Optional Space Chain description.' },
  { name: 'created_by_user_id', description: 'Optional user id for audit attribution.' },
];

const spaceChainCreateResponseFields: SiteApiFieldCopy[] = [
  { name: 'chain', description: 'Created Space Chain object.', required: true },
  { name: 'chain_api_key', description: 'New plaintext Space Chain API key. Store it now.', required: true },
  { name: 'binding_id', description: 'Identifier of the initial key binding.', required: true },
  { name: 'key_prefix', description: 'Space Chain key prefix, currently `chain_`.', required: true },
  { name: 'key_preview', description: 'Short masked preview of the new key.', required: true },
];

const spaceChainObjectResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'Space Chain id.', required: true },
  { name: 'project_id', description: 'Owning project id when present.' },
  { name: 'name', description: 'Space Chain name.', required: true },
  { name: 'description', description: 'Space Chain description.' },
  { name: 'bindings', description: 'Key bindings when included.' },
  { name: 'nodes', description: 'Ordered node list when included.' },
  { name: 'created_at', description: 'Creation timestamp.', required: true },
  { name: 'updated_at', description: 'Last update timestamp.', required: true },
];

const spaceChainUpdateBodyFields: SiteApiFieldCopy[] = [
  { name: 'name', description: 'Updated Space Chain name.', required: true },
  { name: 'description', description: 'Updated description.' },
];

const spaceChainDeleteBodyFields: SiteApiFieldCopy[] = [
  { name: 'deleted_by_user_id', description: 'Optional user id for audit attribution.' },
];

const spaceChainNodesBodyFields: SiteApiFieldCopy[] = [
  { name: 'nodes', description: 'Ordered array of Space Chain node inputs.', required: true },
  { name: 'nodes[].tenant_id', description: 'Space API key / tenant id for the node.', required: true },
  { name: 'nodes[].external_space_id', description: 'Optional console Space id for display and sync.' },
  { name: 'nodes[].display_name', description: 'Optional display name for the node.' },
];

const spaceChainNodesResponseFields: SiteApiFieldCopy[] = [
  { name: 'nodes', description: 'Ordered node list. Positions are zero-based.', required: true },
];

const spaceChainBindingsResponseFields: SiteApiFieldCopy[] = [
  { name: 'bindings', description: 'Array of Space Chain API key bindings.', required: true },
];

const spaceChainBindingBodyFields: SiteApiFieldCopy[] = [
  { name: 'chain_api_key', description: 'Optional caller-supplied key. Omit to generate one.' },
  { name: 'created_by_user_id', description: 'Optional user id for audit attribution.' },
];

const spaceChainBindingResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'Binding id.', required: true },
  { name: 'chain_id', description: 'Space Chain id.', required: true },
  { name: 'chain_api_key', description: 'Plaintext key for newly created bindings.', required: true },
  { name: 'disabled', description: 'Whether this key binding is disabled.', required: true },
  { name: 'created_at', description: 'Creation timestamp.', required: true },
];

const spaceChainDisableBindingBodyFields: SiteApiFieldCopy[] = [
  { name: 'disabled', description: 'Must be `true`.', required: true },
  { name: 'disabled_by_user_id', description: 'Optional user id for audit attribution.' },
];

const spaceChainRuntimeResponseFields: SiteApiFieldCopy[] = [
  { name: 'memories', description: 'Merged memories from the visited Space Chain nodes.', required: true },
  { name: 'total', description: 'Matched rows before pagination after chain-level de-duplication.', required: true },
  { name: 'limit', description: 'Applied page size.', required: true },
  { name: 'offset', description: 'Applied page offset.', required: true },
];

const keyStatusEndpointGroup: SiteApiEndpointGroupCopy = {
  id: 'key-status',
  title: 'Key Status',
  description: 'Validate whether a Space key or Space Chain key is currently usable before making runtime calls.',
  endpoints: [
    {
      method: 'GET',
      path: '/v1alpha2/status',
      summary: 'Check API key status.',
      description:
        'Send either a normal mem9 Space key or a Space Chain key in `X-API-Key`. The response is `active` or `inactive`; unknown keys return `404`.',
      headers: [{ name: 'X-API-Key', description: 'Space API key or Space Chain API key.', required: true }],
      responseFields: keyStatusResponseFields,
      examples: [
        { label: 'Check Space key', code: keyStatusCode },
        { label: 'Check Space Chain key', code: chainKeyStatusCode },
      ],
    },
  ],
};

const batchDeleteMemoryEndpoint: SiteApiEndpointCopy = {
  method: 'POST',
  path: '/v1alpha2/mem9s/memories/batch-delete',
  summary: 'Delete multiple memories.',
  description:
    'Deletes the provided memory ids in one request. When authenticated with a Space Chain key, the handler resolves each id to the node that owns it.',
  headers: hostedJSONWriteHeaders,
  bodyFields: batchDeleteBodyFields,
  examples: [{ label: 'Batch delete memories', code: batchDeleteMemoryCode }],
};

const spaceChainEndpointGroup: SiteApiEndpointGroupCopy = {
  id: 'space-chains',
  title: 'Space Chains',
  description:
    'Create and manage ordered chains of Spaces. Runtime memory endpoints accept a Space Chain key and search the chain in node order, or all nodes when `scanAll=true`.',
  endpoints: [
    {
      method: 'POST',
      path: '/v1alpha2/space-chains',
      summary: 'Create a Space Chain.',
      description:
        'Creates a Space Chain and returns its first plaintext chain key once. Store `chain_api_key` securely; later list responses only expose masked or bound key records.',
      headers: [{ name: 'Content-Type', description: 'Set to `application/json` for JSON request bodies.', required: true }],
      bodyFields: spaceChainCreateBodyFields,
      responseFields: spaceChainCreateResponseFields,
      examples: [
        { label: 'Create Space Chain', code: createSpaceChainCode },
        { label: 'Export Space Chain env vars', code: exportChainApiEnvCode },
      ],
    },
    {
      method: 'GET',
      path: '/v1alpha2/space-chains/by-key',
      summary: 'Read the Space Chain for a key.',
      description: 'Looks up the active Space Chain associated with the `X-API-Key` chain key.',
      headers: chainManagementHeaders,
      responseFields: spaceChainObjectResponseFields,
      examples: [{ label: 'Get by key', code: getSpaceChainByKeyCode }],
    },
    {
      method: 'GET',
      path: '/v1alpha2/space-chains/{chain_id}',
      summary: 'Read one Space Chain.',
      description: 'Returns chain metadata, nodes, and bindings for a chain key authorized to manage this Space Chain.',
      headers: chainManagementHeaders,
      responseFields: spaceChainObjectResponseFields,
      examples: [{ label: 'Get Space Chain', code: getSpaceChainCode }],
    },
    {
      method: 'PATCH',
      path: '/v1alpha2/space-chains/{chain_id}',
      summary: 'Update Space Chain details.',
      description: 'Updates the display name and description for a Space Chain.',
      headers: chainJSONWriteHeaders,
      bodyFields: spaceChainUpdateBodyFields,
      responseFields: spaceChainObjectResponseFields,
      examples: [{ label: 'Update Space Chain', code: updateSpaceChainCode }],
    },
    {
      method: 'DELETE',
      path: '/v1alpha2/space-chains/{chain_id}',
      summary: 'Delete a Space Chain.',
      description: 'Soft-deletes the Space Chain. A successful delete returns `204 No Content`.',
      headers: chainJSONWriteHeaders,
      bodyFields: spaceChainDeleteBodyFields,
      examples: [{ label: 'Delete Space Chain', code: deleteSpaceChainCode }],
    },
    {
      method: 'GET',
      path: '/v1alpha2/space-chains/{chain_id}/nodes',
      summary: 'List Space Chain nodes.',
      description: 'Returns the ordered node list. Node positions are zero-based and define sequential recall order.',
      headers: chainManagementHeaders,
      responseFields: spaceChainNodesResponseFields,
      examples: [{ label: 'List nodes', code: listSpaceChainNodesCode }],
    },
    {
      method: 'PUT',
      path: '/v1alpha2/space-chains/{chain_id}/nodes',
      summary: 'Replace Space Chain nodes.',
      description:
        'Replaces the entire ordered node list. Each node must reference a normal Space key / tenant id, not another Space Chain key.',
      headers: chainJSONWriteHeaders,
      bodyFields: spaceChainNodesBodyFields,
      responseFields: spaceChainNodesResponseFields,
      examples: [{ label: 'Replace nodes', code: replaceSpaceChainNodesCode }],
    },
    {
      method: 'GET',
      path: '/v1alpha2/space-chains/{chain_id}/bindings',
      summary: 'List Space Chain key bindings.',
      description: 'Returns all key bindings visible to the management key for this Space Chain.',
      headers: chainManagementHeaders,
      responseFields: spaceChainBindingsResponseFields,
      examples: [{ label: 'List bindings', code: listSpaceChainBindingsCode }],
    },
    {
      method: 'POST',
      path: '/v1alpha2/space-chains/{chain_id}/bindings',
      summary: 'Create a Space Chain key binding.',
      description: 'Creates another chain key. Omit `chain_api_key` to let mem9 generate a key.',
      headers: chainJSONWriteHeaders,
      bodyFields: spaceChainBindingBodyFields,
      responseFields: spaceChainBindingResponseFields,
      examples: [{ label: 'Create binding', code: createSpaceChainBindingCode }],
    },
    {
      method: 'PATCH',
      path: '/v1alpha2/space-chains/{chain_id}/bindings/{binding_id}',
      summary: 'Disable a Space Chain key binding.',
      description: 'Disables an active binding. The API rejects disabling the last active key for a chain.',
      headers: chainJSONWriteHeaders,
      bodyFields: spaceChainDisableBindingBodyFields,
      examples: [{ label: 'Disable binding', code: disableSpaceChainBindingCode }],
    },
    {
      method: 'GET',
      path: '/v1alpha2/mem9s/memories',
      summary: 'Recall across a Space Chain.',
      description:
        'Use the normal memory search endpoint with a Space Chain key. By default recall visits nodes in order and stops early on high confidence; pass `scanAll=true` to search every node and globally rerank.',
      headers: chainManagementHeaders,
      queryParams: memoryListQueryParams,
      responseFields: spaceChainRuntimeResponseFields,
      examples: [{ label: 'Recall with scanAll', code: recallSpaceChainCode }],
    },
  ],
};

const versionEndpoint: SiteApiEndpointCopy = {
  method: 'GET',
  path: '/versionz',
  summary: 'Check server version metadata.',
  description: 'Returns runtime metadata that is useful for support and deployment verification.',
  responseFields: versionResponseFields,
  examples: [{ label: 'Version check', code: versionCheckCode }],
};

const apiPageByLocale: Record<SiteLocale, SiteApiPageCopy> = {
  en: {
    meta: {
      title: 'mem9 API | API Reference',
      description:
        'Reference for provisioning API keys, reading and writing memories, importing files, appId isolation, and querying session messages with the mem9 API.',
    },
    kicker: 'API',
    title: 'mem9 API reference',
    intro:
      'Use the mem9 API to provision a space, write or search memory, isolate sub-spaces with appId, import existing files, and inspect captured session messages. The examples use mem9.ai; self-hosted deployments use the same routes under your own base URL.',
    summary:
      'Prefer `v1alpha2` for day-to-day usage. `v1alpha1` stays available for key provisioning and tenant-scoped compatibility.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response Body',
      examples: 'Examples',
      required: 'Required',
      next: 'Next',
      sidebarTitle: 'On this page',
      sidebarAuth: 'Authentication',
      sidebarQuickstart: 'Quick Start',
      apiSearch: 'Search API',
      apiSearchPlaceholder: 'Search path or name',
      apiSearchEmpty: 'No matching APIs.',
      testApi: 'Test API',
      testTitle: 'Test API',
      close: 'Close',
      closeApiTestModal: 'Close API test modal',
      reset: 'Reset',
      run: 'Run',
      baseUrl: 'Base URL',
      pathParams: 'Path Params',
      jsonBody: 'JSON body',
      ready: 'Ready',
      responseReady: 'Run a request to inspect the response.',
      emptyResponse: 'empty response',
      running: 'Running...',
      runningRequest: 'Running request...',
      requestFailed: 'Request failed',
      pathParameter: 'Path parameter.',
      saveFormInfo: 'Save form info',
      apiTestCorsNotice:
        'The in-browser API tester is temporarily unavailable until backend CORS changes are live. This feature will be enabled after June 10.',
    },
    authTitle: 'Base URL & authentication',
    authCards: [
      {
        title: 'Base URL',
        body: 'For mem9.ai, use `https://api.mem9.ai`. For self-hosting, replace it with your deployment origin; runtime memory calls live under `/v1alpha2/mem9s/...`.',
      },
      {
        title: 'API key header',
        body: 'Send the space API key in `X-API-Key` for `v1alpha2` runtime calls. mem9.ai keys can be provisioned with `POST /v1alpha1/mem9s`; self-hosted deployments use keys from their own control plane.',
      },
      {
        title: 'Agent identity',
        body: '`X-Mnemo-Agent-Id` is optional. Use it to attribute writes and imports to a specific agent; request body `agent_id` takes precedence when both are present.',
      },
      {
        title: 'appId isolation',
        body: '`appId` partitions memories and raw sessions under the same API key. Omit `appId` to search all appIds, pass a value for exact scope, or pass `null`/empty for default global memory.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription:
      'A minimal mem9.ai flow is: provision a key, export it into your shell, then create and search memories. For self-hosting, keep the same paths and replace the base URL.',
    quickstartSteps: [
      'Provision a new API key with `POST /v1alpha1/mem9s`.',
      'Export that key as `API_KEY` and set `API=https://api.mem9.ai/v1alpha2/mem9s`.',
      'Create a memory with `POST /memories`. Add `appId` when one API key should hold separate app-specific memory pools.',
      'Search it back with `GET /memories?q=...`. Omit `appId` to search all appIds, or pass one appId to isolate the result set.',
    ],
    quickstartExamples: [
      { label: 'Provision key', code: provisionKeyCode },
      { label: 'Export env vars', code: exportApiEnvCode },
      { label: 'Create memory', code: createMemoryCode },
      { label: 'Search memories', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: 'Create the initial key you will reuse for mem9.ai API access.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: 'Provision a new mem9 API key.',
            description:
              'No auth or request body is required. The mem9.ai service returns `201` with an `id` field, and that `id` is the key you store and reuse.',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Provision key', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description:
          'Create, search, read, update, and delete stored memories in your mem9 space. The optional `appId` field lets one API key host multiple isolated application sub-spaces.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'Create a memory or ingest messages.',
            description:
              'Use `content` for direct writes or `messages` for ingest-driven writes. Do not send both in the same request. `appId` is optional; omitted, null, empty, and whitespace values are stored as the default/global appId.',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: 'Create memory', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'List or search memories.',
            description:
              'When `q` is present, the handler runs recall search by default. Use `search_mode=keyword` for direct content substring matching. `appId` has three-state query semantics: omit it to search all appIds, pass a non-empty value for exact isolation, or pass `appId=null` / `appId=` for the default/global appId.',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'Search memories', code: listMemoryCode },
              { label: 'Filter by tags / source', code: filterMemoryCode },
              { label: 'Direct content keyword search', code: keywordListMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Read one memory by id.',
            description: 'Fetch a single stored memory object from the mem9 API.',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Get memory', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Update one memory.',
            description:
              'Update content, tags, or metadata. Send `If-Match` when you want optimistic version checks.',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Update memory', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Delete one memory.',
            description: 'Deletes the selected memory row and returns `204 No Content` on success.',
            headers: hostedReadHeaders,
            examples: [{ label: 'Delete memory', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: 'Upload memory or session files and poll their background task status. Imported memories and raw sessions can carry `appId` at the file, memory, or session level.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: 'Create an import task.',
            description:
              'Upload a file as `memory` or `session`. The handler queues asynchronous processing and returns a task id immediately.',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: 'Import memory file', code: importMemoryFileCode },
              { label: 'Import session file', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: 'List import tasks.',
            description: 'Return all import tasks visible in the current mem9 space.',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: 'List import tasks', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: 'Read one import task.',
            description: 'Poll a single task until it becomes `done` or `failed`.',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: 'Get import task', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: 'Inspect raw captured conversation rows that were stored during ingest. `appId` uses the same omitted / exact / default-global filtering behavior as memory search.',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'List session messages by session id.',
            description:
              'Repeat `session_id` in the query string for each session you want to fetch. Use `limit_per_session` to cap rows per session. If different appIds reused the same session id, pass `appId` to prevent cross-app raw session mixing.',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: 'Read session messages', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health & Compatibility',
        description:
          'Use `/healthz` for liveness checks. Legacy tenant-scoped routes still exist under `/v1alpha1/mem9s/{tenantID}/...`, but most clients should prefer `v1alpha2` plus `X-API-Key`.',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: 'Check service health.',
            description: 'Useful before onboarding or when debugging network reachability.',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: 'Need the guided path instead?',
    ctaBody:
      'If you are onboarding OpenClaw rather than building a direct integration, start from the public SKILL.md. Use the same API key later in Your Memory.',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  zh: {
    meta: {
      title: 'mem9 API | API 文档',
      description: '查看如何创建 API key、读写记忆、使用 appId 隔离子空间、上传文件，以及查询 mem9 API 的 session messages。',
    },
    kicker: 'API',
    title: 'mem9 API 文档',
    intro: '使用 mem9 API 创建 space、写入或搜索记忆、通过 appId 隔离同一 API key 下的子空间、导入已有文件，并查看捕获到的 session messages。示例使用 mem9.ai；自托管部署可以使用自己的 base URL 调用同一组路径。',
    summary: '日常调用优先使用 `v1alpha2`。`v1alpha1` 继续保留给 key provision 和 tenant-scoped 兼容路径。',
    labels: {
      headers: '请求头',
      queryParams: '查询参数',
      body: '请求体',
      response: '响应 Body',
      examples: '示例',
      required: '必填',
      next: '下一步',
      sidebarTitle: '本页目录',
      sidebarAuth: '认证',
      sidebarQuickstart: '快速开始',
      apiSearch: '搜索 API',
      apiSearchPlaceholder: '搜索 path 或名称',
      apiSearchEmpty: '没有匹配的 API。',
      testApi: '测试 API',
      testTitle: '测试 API',
      close: '关闭',
      closeApiTestModal: '关闭 API 测试弹窗',
      reset: '重置',
      run: '运行',
      baseUrl: 'Base URL',
      pathParams: '路径参数',
      jsonBody: 'JSON 请求体',
      ready: '就绪',
      responseReady: '运行请求后在这里查看响应。',
      emptyResponse: '空响应',
      running: '运行中...',
      runningRequest: '正在发送请求...',
      requestFailed: '请求失败',
      pathParameter: '路径参数。',
      saveFormInfo: '保存表单信息',
      apiTestCorsNotice: '后端 CORS 改动尚未上线，浏览器内 API 测试功能暂不可用，将于 6/10 之后开启。',
    },
    authTitle: 'Base URL 与认证方式',
    authCards: [
      {
        title: 'Base URL',
        body: '使用 mem9.ai 时 base URL 是 `https://api.mem9.ai`；自托管时替换成自己的服务地址。runtime memory 接口路径仍是 `/v1alpha2/mem9s/...`。',
      },
      {
        title: 'API key header',
        body: '`v1alpha2` 调用把 space API key 放在 `X-API-Key`。mem9.ai 可通过 `POST /v1alpha1/mem9s` 创建 key；自托管则使用自己控制面生成的 key。',
      },
      {
        title: 'Agent 身份',
        body: '`X-Mnemo-Agent-Id` 可选，用来标记写入或导入来自哪个 agent；如果请求体同时传了 `agent_id`，以请求体为准。',
      },
      {
        title: 'appId 隔离',
        body: '`appId` 用来在同一个 API key 下隔离 memory 和 raw session 子空间。不传 `appId` 表示搜索全部子空间；传具体值表示精确隔离；传 `null` 或空值表示 default/global 记忆。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小 mem9.ai 流程是：先 provision 一个 key，把它导出到 shell，然后创建并搜索记忆。自托管时保留相同路径，只替换 base URL。',
    quickstartSteps: [
      '通过 `POST /v1alpha1/mem9s` 创建新的 API key。',
      '把该 key 导出成 `API_KEY`，并设置 `API=https://api.mem9.ai/v1alpha2/mem9s`。',
      '用 `POST /memories` 写入一条记忆；当一个 API key 需要承载多个应用场景时，传入 `appId`。',
      '再用 `GET /memories?q=...` 搜回来；不传 `appId` 表示跨全部 appId 搜索，传入某个 `appId` 表示只查该子空间。',
    ],
    quickstartExamples: [
      { label: '创建 key', code: provisionKeyCode },
      { label: '导出环境变量', code: exportApiEnvCode },
      { label: '写入记忆', code: createMemoryCode },
      { label: '搜索记忆', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: '创建你后续会重复使用的 mem9.ai API 访问 key。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: '创建新的 mem9 API key。',
            description: '不需要认证，也不需要请求体。mem9.ai 服务会返回 `201` 和一个 `id` 字段，这个 `id` 就是你要保存和复用的 key。',
            responseFields: provisionResponseFields,
            examples: [{ label: '创建 key', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: '在你的 mem9 space 中创建、搜索、读取、更新和删除记忆。可选的 `appId` 让同一个 API key 拥有多个相互隔离的应用子记忆空间。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: '创建记忆或执行 message ingest。',
            description: '直接写入时使用 `content`；走 ingest 时使用 `messages`。同一个请求里不要同时发送这两个字段。`appId` 可选；省略、null、空字符串和纯空白都会写入默认/global appId。',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: '创建记忆', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: '列出或搜索记忆。',
            description: '带 `q` 时默认走 recall search；`search_mode=keyword` 用于直接按 content 子串搜索。`appId` 是三态语义：不传表示跨全部 appId 搜索，传非空值表示精确隔离，传 `appId=null` 或 `appId=` 表示只查默认/global appId。',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: '搜索记忆', code: listMemoryCode },
              { label: '按标签 / source 过滤', code: filterMemoryCode },
              { label: '直接内容关键词搜索', code: keywordListMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '按 id 读取单条记忆。',
            description: '从 mem9 API 拉取一条完整的记忆对象。',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: '读取记忆', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '更新单条记忆。',
            description: '更新内容、tags 或 metadata。若需要版本保护，请同时发送 `If-Match`。',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: '更新记忆', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '删除单条记忆。',
            description: '删除目标记忆，成功时返回 `204 No Content`。',
            headers: hostedReadHeaders,
            examples: [{ label: '删除记忆', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: '上传 memory / session 文件，并轮询后台任务状态。导入的 memory 和 raw session 可以在文件级、memory 级或 session 级携带 `appId`。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: '创建导入任务。',
            description: '把文件作为 `memory` 或 `session` 上传。handler 会排队异步处理，并立刻返回 task id。',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: '导入 memory 文件', code: importMemoryFileCode },
              { label: '导入 session 文件', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: '列出导入任务。',
            description: '返回当前 mem9 space 下可见的全部导入任务。',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: '列出导入任务', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: '读取单个导入任务。',
            description: '轮询某个 task，直到它变成 `done` 或 `failed`。',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: '读取导入任务', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: '查看在 ingest 过程中被保存下来的原始对话消息。`appId` 使用和 memory 搜索一致的不传 / 精确值 / 默认 global 三态过滤。',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: '按 session id 读取 session messages。',
            description: '为每个要查询的 session 重复传 `session_id` 参数；用 `limit_per_session` 控制每个 session 的返回上限。如果不同 appId 复用了同一个 session id，传入 `appId` 可以避免 raw session 串到其它应用。',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: '读取 session messages', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health 与兼容性',
        description: '用 `/healthz` 做存活检查。旧的 tenant-scoped 路由仍存在于 `/v1alpha1/mem9s/{tenantID}/...` 下，但大多数客户端应优先使用 `v1alpha2` + `X-API-Key`。',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: '检查服务健康状态。',
            description: '适合在 onboarding 前或排查网络可达性问题时使用。',
            responseFields: healthResponseFields,
            examples: [{ label: '健康检查', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: '如果你更需要引导式接入？',
    ctaBody: '如果你的目标是接入 OpenClaw，而不是自己写一个直接集成，请从公开的 SKILL.md 开始。之后在 Your Memory 中继续使用同一个 API key。',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  'zh-Hant': {
    meta: {
      title: 'mem9 API | API 文件',
      description: '查看如何建立 API key、讀寫記憶、上傳檔案，以及查詢 mem9 API 的 session messages。',
    },
    kicker: 'API',
    title: 'mem9 API 文件',
    intro: '使用 mem9 API 建立 space、寫入或搜尋記憶、匯入既有檔案，並查看捕捉到的 session messages。',
    summary: '日常呼叫優先使用 `v1alpha2`。`v1alpha1` 持續保留給 key provision 與 tenant-scoped 相容路徑。',
    labels: {
      headers: '請求頭',
      queryParams: '查詢參數',
      body: '請求體',
      response: '回應 Body',
      examples: '範例',
      required: '必填',
      next: '下一步',
      sidebarTitle: '本頁目錄',
      sidebarAuth: '驗證',
      sidebarQuickstart: '快速開始',
      apiSearch: '搜尋 API',
      apiSearchPlaceholder: '搜尋 path 或名稱',
      apiSearchEmpty: '沒有符合的 API。',
      testApi: '測試 API',
      testTitle: '測試 API',
      close: '關閉',
      closeApiTestModal: '關閉 API 測試彈窗',
      reset: '重設',
      run: '執行',
      baseUrl: 'Base URL',
      pathParams: '路徑參數',
      jsonBody: 'JSON 請求體',
      ready: '就緒',
      responseReady: '執行請求後在這裡查看回應。',
      emptyResponse: '空回應',
      running: '執行中...',
      runningRequest: '正在送出請求...',
      requestFailed: '請求失敗',
      pathParameter: '路徑參數。',
      saveFormInfo: '儲存表單資訊',
      apiTestCorsNotice: '後端 CORS 改動尚未上線，瀏覽器內 API 測試功能暫不可用，將於 6/10 之後開啟。',
    },
    authTitle: 'Base URL 與驗證方式',
    authCards: [
      {
        title: 'Base URL',
        body: '使用 `https://api.mem9.ai`。一般客戶端請求應發送到 `https://api.mem9.ai/v1alpha2/mem9s/...`。',
      },
      {
        title: '主要驗證 header',
        body: '把 mem9 API key 放進 `X-API-Key`。這是 `v1alpha2` 的預設驗證模式。',
      },
      {
        title: '可選 agent 身分',
        body: '當你希望寫入或匯入歸屬到特定 agent 時，再額外送出 `X-Mnemo-Agent-Id`。舊的 tenant-scoped 路由仍保留在 `v1alpha1` 下。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小 mem9.ai 流程是：先 provision 一個 key，把它 export 到 shell，然後建立並搜尋記憶。',
    quickstartSteps: [
      '透過 `POST /v1alpha1/mem9s` 建立新的 API key。',
      '把該 key export 成 `API_KEY`，並設定 `API=https://api.mem9.ai/v1alpha2/mem9s`。',
      '用 `POST /memories` 寫入一條記憶。',
      '再用 `GET /memories?q=...` 搜回來。',
    ],
    quickstartExamples: [
      { label: '建立 key', code: provisionKeyCode },
      { label: '匯出環境變數', code: exportApiEnvCode },
      { label: '寫入記憶', code: createMemoryCode },
      { label: '搜尋記憶', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: '建立後續會重複使用的 hosted mem9 存取 key。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: '建立新的 mem9 API key。',
            description: '不需要驗證，也不需要 request body。hosted 服務會回傳 `201` 與一個 `id` 欄位，這個 `id` 就是你要保存與重用的 key。',
            responseFields: provisionResponseFields,
            examples: [{ label: '建立 key', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: '在你的 mem9 space 中建立、搜尋、讀取、更新與刪除記憶。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: '建立記憶或執行 message ingest。',
            description: '直接寫入時使用 `content`；走 ingest 時使用 `messages`。同一個 request 不要同時送這兩個欄位。',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: '建立記憶', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: '列出或搜尋記憶。',
            description: '帶 `q` 時走 recall search；不帶 `q` 時更像帶過濾條件的列表 API。',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: '搜尋記憶', code: listMemoryCode },
              { label: '依 tag / source 過濾', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '依 id 讀取單筆記憶。',
            description: '從 hosted 服務中抓取一個完整的記憶物件。',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: '讀取記憶', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '更新單筆記憶。',
            description: '更新內容、tags 或 metadata。若需要版本保護，請一併送出 `If-Match`。',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: '更新記憶', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '刪除單筆記憶。',
            description: '刪除目標記憶，成功時回傳 `204 No Content`。',
            headers: hostedReadHeaders,
            examples: [{ label: '刪除記憶', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: '上傳 memory / session 檔案，並輪詢背景任務狀態。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: '建立匯入任務。',
            description: '把檔案作為 `memory` 或 `session` 上傳。handler 會排入非同步處理，並立即回傳 task id。',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: '匯入 memory 檔', code: importMemoryFileCode },
              { label: '匯入 session 檔', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: '列出匯入任務。',
            description: '回傳目前 mem9 space 內可見的所有匯入任務。',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: '列出匯入任務', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: '讀取單個匯入任務。',
            description: '輪詢某個 task，直到它變成 `done` 或 `failed`。',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: '讀取匯入任務', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: '查看在 ingest 流程中被保存下來的原始對話訊息。',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: '依 session id 讀取 session messages。',
            description: '對每個要查詢的 session 重複傳 `session_id`；用 `limit_per_session` 控制每個 session 的回傳上限。',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: '讀取 session messages', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health 與相容性',
        description: '使用 `/healthz` 進行存活檢查。舊的 tenant-scoped 路由仍存在於 `/v1alpha1/mem9s/{tenantID}/...` 下，但 hosted client 應優先使用 `v1alpha2` + `X-API-Key`。',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: '檢查服務健康狀態。',
            description: '適合在 onboarding 前或排查網路可達性問題時使用。',
            responseFields: healthResponseFields,
            examples: [{ label: '健康檢查', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: '如果你更需要引導式接入？',
    ctaBody: '如果你的目標是接入 OpenClaw，而不是自己實作直接整合，請先從公開的 SKILL.md 開始。之後在 Your Memory 繼續使用同一個 API key。',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  ja: {
    meta: {
      title: 'mem9 API | API リファレンス',
      description: 'API key の発行、memory の読み書き、ファイル import、session messages の取得方法を確認できます。',
    },
    kicker: 'API',
    title: 'mem9 API リファレンス',
    intro: 'mem9 API を使って space を発行し、memory を書き込み / 検索し、既存ファイルを import し、保存済み session messages を確認できます。',
    summary: '日常利用では `v1alpha2` を優先してください。`v1alpha1` は key の provision と tenant-scoped な互換ルート向けに残っています。',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response Body',
      examples: 'Examples',
      required: '必須',
      next: 'Next',
      sidebarTitle: 'このページの内容',
      sidebarAuth: '認証',
      sidebarQuickstart: 'クイックスタート',
      apiSearch: 'API を検索',
      apiSearchPlaceholder: 'path または名前を検索',
      apiSearchEmpty: '一致する API はありません。',
      testApi: 'API をテスト',
      testTitle: 'API をテスト',
      close: '閉じる',
      closeApiTestModal: 'API テストモーダルを閉じる',
      reset: 'リセット',
      run: '実行',
      baseUrl: 'Base URL',
      pathParams: 'パスパラメータ',
      jsonBody: 'JSON body',
      ready: '準備完了',
      responseReady: 'リクエストを実行するとレスポンスを確認できます。',
      emptyResponse: '空のレスポンス',
      running: '実行中...',
      runningRequest: 'リクエストを実行中...',
      requestFailed: 'リクエストに失敗しました',
      pathParameter: 'パスパラメータ。',
      saveFormInfo: 'フォーム情報を保存',
      apiTestCorsNotice:
        'バックエンドの CORS 変更がまだ反映されていないため、ブラウザ内 API テスト機能は一時的に利用できません。6/10 以降に有効になります。',
    },
    authTitle: 'Base URL と認証',
    authCards: [
      {
        title: 'Base URL',
        body: '`https://api.mem9.ai` を使います。通常のクライアント通信は `https://api.mem9.ai/v1alpha2/mem9s/...` に送ってください。',
      },
      {
        title: '主要な認証 header',
        body: 'mem9 API key は `X-API-Key` に送ります。これが `v1alpha2` の標準的な認証です。',
      },
      {
        title: '任意の agent identity',
        body: 'write や import を特定 agent に紐付けたい場合は `X-Mnemo-Agent-Id` も送ります。tenant-scoped な旧ルートは `v1alpha1` に残っています。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小の mem9.ai フローは、key を provision して shell に export し、その後 memory を作成して検索することです。',
    quickstartSteps: [
      '`POST /v1alpha1/mem9s` で新しい API key を作成する。',
      'その key を `API_KEY` として export し、`API=https://api.mem9.ai/v1alpha2/mem9s` を設定する。',
      '`POST /memories` で memory を書き込む。',
      '`GET /memories?q=...` で検索する。',
    ],
    quickstartExamples: [
      { label: 'Key を発行', code: provisionKeyCode },
      { label: '環境変数を export', code: exportApiEnvCode },
      { label: 'Memory を作成', code: createMemoryCode },
      { label: 'Memory を検索', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: 'hosted mem9 にアクセスするための初期 key を発行します。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: '新しい mem9 API key を発行する。',
            description: '認証も request body も不要です。service は `201` と `id` を返し、その `id` が保存して再利用する key になります。',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Key を発行', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: 'mem9 space 内の memory を作成、検索、取得、更新、削除します。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'memory を作成する、または message ingest を実行する。',
            description: '直接書き込む場合は `content`、ingest ベースの場合は `messages` を使います。同じ request で両方は送らないでください。',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: 'Memory を作成', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'memory を一覧または検索する。',
            description: '`q` がある場合は recall search、それ以外は filter 付き list API として動作します。',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'Memory を検索', code: listMemoryCode },
              { label: 'tag / source で絞り込む', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'id で 1 件の memory を取得する。',
            description: 'mem9 API から単一の memory object を取得します。',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Memory を取得', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '1 件の memory を更新する。',
            description: 'content、tags、metadata を更新できます。楽観的な version check が必要なら `If-Match` を送ってください。',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Memory を更新', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '1 件の memory を削除する。',
            description: '対象の memory を削除し、成功時は `204 No Content` を返します。',
            headers: hostedReadHeaders,
            examples: [{ label: 'Memory を削除', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: 'memory / session ファイルをアップロードし、バックグラウンド task の状態を確認します。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: 'import task を作成する。',
            description: 'ファイルを `memory` または `session` として upload します。handler は非同期処理をキューし、すぐに task id を返します。',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: 'memory file を import', code: importMemoryFileCode },
              { label: 'session file を import', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: 'import task を一覧する。',
            description: '現在の mem9 space で見えるすべての import task を返します。',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: 'Import task を一覧', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: '1 件の import task を取得する。',
            description: 'task が `done` または `failed` になるまで polling します。',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: 'Import task を取得', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: 'ingest 中に保存された raw conversation row を確認します。',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'session id 単位で session messages を取得する。',
            description: '取得したい session ごとに `session_id` を繰り返して渡します。`limit_per_session` で各 session の上限を設定します。',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: 'Session messages を読む', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health & Compatibility',
        description: '`/healthz` は liveness check 用です。旧 tenant-scoped route は `/v1alpha1/mem9s/{tenantID}/...` に残っていますが、hosted client は `v1alpha2` + `X-API-Key` を優先してください。',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: 'service health を確認する。',
            description: 'onboarding 前の確認や network reachability の切り分けに便利です。',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: 'ガイド付きの導入が必要ですか？',
    ctaBody: '直接 integration を作るのではなく OpenClaw をつなぎたいなら、まず公開 SKILL.md から始めてください。その後、同じ API key を Your Memory でも使えます。',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  ko: {
    meta: {
      title: 'mem9 API | API 레퍼런스',
      description: 'API key 발급, memory 읽기/쓰기, 파일 import, session messages 조회 방법을 확인할 수 있습니다.',
    },
    kicker: 'API',
    title: 'mem9 API 레퍼런스',
    intro: 'mem9 API 로 space 를 만들고, memory 를 쓰고 검색하고, 기존 파일을 import 하고, 저장된 session messages 를 확인할 수 있습니다.',
    summary: '일상적인 사용은 `v1alpha2` 를 우선하세요. `v1alpha1` 은 key provision 과 tenant-scoped 호환 경로를 위해 남아 있습니다.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response Body',
      examples: 'Examples',
      required: '필수',
      next: '다음',
      sidebarTitle: '이 페이지 목차',
      sidebarAuth: '인증',
      sidebarQuickstart: '빠른 시작',
      apiSearch: 'API 검색',
      apiSearchPlaceholder: 'path 또는 이름 검색',
      apiSearchEmpty: '일치하는 API가 없습니다.',
      testApi: 'API 테스트',
      testTitle: 'API 테스트',
      close: '닫기',
      closeApiTestModal: 'API 테스트 모달 닫기',
      reset: '초기화',
      run: '실행',
      baseUrl: 'Base URL',
      pathParams: '경로 파라미터',
      jsonBody: 'JSON body',
      ready: '준비됨',
      responseReady: '요청을 실행하면 응답을 확인할 수 있습니다.',
      emptyResponse: '빈 응답',
      running: '실행 중...',
      runningRequest: '요청 실행 중...',
      requestFailed: '요청 실패',
      pathParameter: '경로 파라미터.',
      saveFormInfo: '폼 정보 저장',
      apiTestCorsNotice:
        '백엔드 CORS 변경이 아직 배포되지 않아 브라우저 내 API 테스트 기능을 일시적으로 사용할 수 없습니다. 6/10 이후 활성화됩니다.',
    },
    authTitle: 'Base URL 과 인증',
    authCards: [
      {
        title: 'Base URL',
        body: '`https://api.mem9.ai` 를 사용합니다. 일반적인 클라이언트 트래픽은 `https://api.mem9.ai/v1alpha2/mem9s/...` 로 보내세요.',
      },
      {
        title: '기본 인증 header',
        body: 'mem9 API key 는 `X-API-Key` 로 보냅니다. 이것이 `v1alpha2` 의 기본 인증 방식입니다.',
      },
      {
        title: '선택적 agent identity',
        body: 'write 나 import 를 특정 agent 에 귀속시키고 싶다면 `X-Mnemo-Agent-Id` 도 함께 보내세요. 기존 tenant-scoped 경로는 `v1alpha1` 아래에 남아 있습니다.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '가장 작은 mem9.ai 흐름은 key 를 provision 하고 shell 에 export 한 뒤, memory 를 생성하고 검색하는 것입니다.',
    quickstartSteps: [
      '`POST /v1alpha1/mem9s` 로 새 API key 를 만든다.',
      '그 key 를 `API_KEY` 로 export 하고 `API=https://api.mem9.ai/v1alpha2/mem9s` 를 설정한다.',
      '`POST /memories` 로 memory 를 작성한다.',
      '`GET /memories?q=...` 로 검색한다.',
    ],
    quickstartExamples: [
      { label: 'Key 발급', code: provisionKeyCode },
      { label: '환경 변수 export', code: exportApiEnvCode },
      { label: 'Memory 생성', code: createMemoryCode },
      { label: 'Memory 검색', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: 'hosted mem9 접근에 사용할 초기 key 를 발급합니다.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: '새 mem9 API key 를 발급합니다.',
            description: '인증도 request body 도 필요 없습니다. service 는 `201` 과 `id` 를 반환하며, 이 `id` 가 저장하고 재사용할 key 입니다.',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Key 발급', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: 'mem9 space 안의 memory 를 생성, 검색, 조회, 수정, 삭제합니다.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'memory 를 생성하거나 message ingest 를 실행합니다.',
            description: '직접 쓰기에는 `content`, ingest 기반 처리에는 `messages` 를 사용합니다. 같은 request 에 둘 다 보내지 마세요.',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: 'Memory 생성', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'memory 를 목록 조회하거나 검색합니다.',
            description: '`q` 가 있으면 recall search, 없으면 filter 가 적용된 list API 처럼 동작합니다.',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'Memory 검색', code: listMemoryCode },
              { label: 'tag / source 로 필터링', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'id 로 단일 memory 를 조회합니다.',
            description: 'mem9 API 에서 하나의 memory object 를 가져옵니다.',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Memory 조회', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '단일 memory 를 수정합니다.',
            description: 'content, tags, metadata 를 수정할 수 있습니다. 낙관적 version check 가 필요하면 `If-Match` 를 함께 보내세요.',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Memory 수정', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '단일 memory 를 삭제합니다.',
            description: '대상 memory 를 삭제하고 성공 시 `204 No Content` 를 반환합니다.',
            headers: hostedReadHeaders,
            examples: [{ label: 'Memory 삭제', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: 'memory / session 파일을 업로드하고 백그라운드 task 상태를 확인합니다.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: 'import task 를 생성합니다.',
            description: '파일을 `memory` 또는 `session` 으로 업로드합니다. handler 는 비동기 처리를 큐에 넣고 즉시 task id 를 반환합니다.',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: 'memory 파일 import', code: importMemoryFileCode },
              { label: 'session 파일 import', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: 'import task 목록을 조회합니다.',
            description: '현재 mem9 space 에서 보이는 모든 import task 를 반환합니다.',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: 'Import task 목록', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: '단일 import task 를 조회합니다.',
            description: 'task 가 `done` 또는 `failed` 가 될 때까지 polling 합니다.',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: 'Import task 조회', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: 'ingest 동안 저장된 raw conversation row 를 확인합니다.',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'session id 기준으로 session messages 를 조회합니다.',
            description: '조회할 각 session 마다 `session_id` 를 반복해서 넘깁니다. `limit_per_session` 으로 각 session 의 최대 row 수를 제한합니다.',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: 'Session messages 조회', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health & Compatibility',
        description: '`/healthz` 는 liveness check 용입니다. 기존 tenant-scoped route 는 `/v1alpha1/mem9s/{tenantID}/...` 아래에 남아 있지만, hosted client 는 `v1alpha2` + `X-API-Key` 를 우선해야 합니다.',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: '서비스 health 를 확인합니다.',
            description: 'onboarding 전 확인이나 네트워크 reachability 문제를 진단할 때 유용합니다.',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: '가이드형 온보딩이 더 필요하신가요?',
    ctaBody: '직접 integration 을 만드는 것이 아니라 OpenClaw 를 연결하려는 목적이라면 공개 SKILL.md 부터 시작하세요. 이후 같은 API key 를 Your Memory 에서도 사용할 수 있습니다.',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  id: {
    meta: {
      title: 'mem9 API | Referensi API',
      description: 'Pelajari cara membuat API key, membaca dan menulis memory, mengimpor file, dan membaca session messages di mem9 API.',
    },
    kicker: 'API',
    title: 'Referensi mem9 API',
    intro: 'Gunakan mem9 API untuk membuat space, menulis atau mencari memory, mengimpor file yang sudah ada, dan melihat session messages yang tersimpan.',
    summary: 'Gunakan `v1alpha2` untuk pemakaian harian. `v1alpha1` tetap tersedia untuk provision key dan kompatibilitas tenant-scoped.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response Body',
      examples: 'Examples',
      required: 'Wajib',
      next: 'Next',
      sidebarTitle: 'Di halaman ini',
      sidebarAuth: 'Autentikasi',
      sidebarQuickstart: 'Quick Start',
      apiSearch: 'Cari API',
      apiSearchPlaceholder: 'Cari path atau nama',
      apiSearchEmpty: 'Tidak ada API yang cocok.',
      testApi: 'Uji API',
      testTitle: 'Uji API',
      close: 'Tutup',
      closeApiTestModal: 'Tutup modal uji API',
      reset: 'Reset',
      run: 'Jalankan',
      baseUrl: 'Base URL',
      pathParams: 'Parameter path',
      jsonBody: 'Body JSON',
      ready: 'Siap',
      responseReady: 'Jalankan request untuk melihat respons.',
      emptyResponse: 'respons kosong',
      running: 'Menjalankan...',
      runningRequest: 'Menjalankan request...',
      requestFailed: 'Request gagal',
      pathParameter: 'Parameter path.',
      saveFormInfo: 'Simpan info formulir',
      apiTestCorsNotice:
        'Perubahan CORS backend belum aktif, jadi fitur uji API di browser untuk sementara belum bisa digunakan. Fitur ini akan aktif setelah 6/10.',
    },
    authTitle: 'Base URL & autentikasi',
    authCards: [
      {
        title: 'Base URL',
        body: 'Gunakan `https://api.mem9.ai`. Untuk trafik client normal, kirim request ke `https://api.mem9.ai/v1alpha2/mem9s/...`.',
      },
      {
        title: 'Header autentikasi utama',
        body: 'Kirim mem9 API key Anda di `X-API-Key`. Ini adalah model auth default untuk `v1alpha2`.',
      },
      {
        title: 'Identitas agent opsional',
        body: 'Kirim `X-Mnemo-Agent-Id` jika Anda ingin write atau import diatribusikan ke agent tertentu. Rute tenant-scoped lama masih tersedia di bawah `v1alpha1`.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: 'Alur mem9.ai paling kecil adalah: provision key, export ke shell, lalu buat dan cari memory.',
    quickstartSteps: [
      'Provision API key baru dengan `POST /v1alpha1/mem9s`.',
      'Export key itu sebagai `API_KEY`, lalu set `API=https://api.mem9.ai/v1alpha2/mem9s`.',
      'Buat memory dengan `POST /memories`.',
      'Cari kembali dengan `GET /memories?q=...`.',
    ],
    quickstartExamples: [
      { label: 'Provision key', code: provisionKeyCode },
      { label: 'Export env vars', code: exportApiEnvCode },
      { label: 'Buat memory', code: createMemoryCode },
      { label: 'Cari memory', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: 'Buat key awal yang akan dipakai ulang untuk akses hosted mem9.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: 'Provision mem9 API key baru.',
            description: 'Tidak memerlukan auth maupun request body. Hosted service mengembalikan `201` dengan field `id`, dan nilai itulah key yang Anda simpan dan pakai ulang.',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Provision key', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: 'Buat, cari, baca, ubah, dan hapus memory yang tersimpan di mem9 space Anda.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'Buat memory atau jalankan message ingest.',
            description: 'Gunakan `content` untuk write langsung atau `messages` untuk ingest. Jangan kirim keduanya sekaligus dalam request yang sama.',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: 'Buat memory', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'List atau search memory.',
            description: 'Saat `q` ada, handler menjalankan recall search. Tanpa `q`, endpoint berperilaku seperti API list dengan filter.',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'Cari memory', code: listMemoryCode },
              { label: 'Filter by tag / source', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Baca satu memory berdasarkan id.',
            description: 'Ambil satu memory object dari mem9 API.',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Ambil memory', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Perbarui satu memory.',
            description: 'Perbarui content, tags, atau metadata. Kirim `If-Match` bila Anda ingin version check optimistis.',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'Perbarui memory', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Hapus satu memory.',
            description: 'Menghapus row memory terpilih dan mengembalikan `204 No Content` saat sukses.',
            headers: hostedReadHeaders,
            examples: [{ label: 'Hapus memory', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: 'Unggah file memory atau session dan polling status task latar belakangnya.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: 'Buat import task.',
            description: 'Unggah file sebagai `memory` atau `session`. Handler akan mengantrikan proses async dan segera mengembalikan task id.',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: 'Import file memory', code: importMemoryFileCode },
              { label: 'Import file session', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: 'List import task.',
            description: 'Mengembalikan semua import task yang terlihat di mem9 space saat ini.',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: 'List import task', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: 'Baca satu import task.',
            description: 'Polling satu task sampai statusnya menjadi `done` atau `failed`.',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: 'Ambil import task', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: 'Lihat row percakapan mentah yang disimpan saat ingest berjalan.',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'List session messages berdasarkan session id.',
            description: 'Ulangi `session_id` di query string untuk tiap session yang ingin diambil. Gunakan `limit_per_session` untuk membatasi jumlah row per session.',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: 'Baca session messages', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health & Compatibility',
        description: 'Gunakan `/healthz` untuk liveness check. Rute tenant-scoped lama masih ada di `/v1alpha1/mem9s/{tenantID}/...`, tetapi client hosted sebaiknya memakai `v1alpha2` + `X-API-Key`.',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: 'Cek kesehatan service.',
            description: 'Berguna sebelum onboarding atau saat mendiagnosis masalah jangkauan jaringan.',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: 'Butuh jalur yang lebih terpandu?',
    ctaBody: 'Jika Anda sedang onboarding OpenClaw dan bukan membangun integrasi langsung, mulai dari SKILL.md publik. Gunakan API key yang sama nanti di Your Memory.',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
  th: {
    meta: {
      title: 'mem9 API | เอกสาร API',
      description: 'ดูวิธีสร้าง API key อ่านและเขียน memory อัปโหลดไฟล์ และอ่าน session messages บน mem9 API',
    },
    kicker: 'API',
    title: 'เอกสาร mem9 API',
    intro: 'ใช้ mem9 API เพื่อสร้าง space เขียนหรือค้นหา memory นำเข้าไฟล์เดิม และดู session messages ที่ถูกเก็บไว้',
    summary: 'สำหรับการใช้งานประจำวันให้ใช้ `v1alpha2` เป็นหลัก ส่วน `v1alpha1` ยังมีไว้สำหรับ provision key และเส้นทาง tenant-scoped แบบเดิม',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response Body',
      examples: 'Examples',
      required: 'จำเป็น',
      next: 'ถัดไป',
      sidebarTitle: 'ในหน้านี้',
      sidebarAuth: 'การยืนยันตัวตน',
      sidebarQuickstart: 'เริ่มต้นอย่างรวดเร็ว',
      apiSearch: 'ค้นหา API',
      apiSearchPlaceholder: 'ค้นหา path หรือชื่อ',
      apiSearchEmpty: 'ไม่พบ API ที่ตรงกัน',
      testApi: 'ทดสอบ API',
      testTitle: 'ทดสอบ API',
      close: 'ปิด',
      closeApiTestModal: 'ปิดหน้าต่างทดสอบ API',
      reset: 'รีเซ็ต',
      run: 'เรียกใช้',
      baseUrl: 'Base URL',
      pathParams: 'พารามิเตอร์ path',
      jsonBody: 'JSON body',
      ready: 'พร้อม',
      responseReady: 'เรียกใช้ request เพื่อดู response',
      emptyResponse: 'response ว่าง',
      running: 'กำลังเรียกใช้...',
      runningRequest: 'กำลังส่ง request...',
      requestFailed: 'Request ล้มเหลว',
      pathParameter: 'พารามิเตอร์ path',
      saveFormInfo: 'บันทึกข้อมูลฟอร์ม',
      apiTestCorsNotice:
        'การเปลี่ยนแปลง CORS ฝั่ง backend ยังไม่เปิดใช้งาน ฟีเจอร์ทดสอบ API ใน browser จึงยังใช้ไม่ได้ชั่วคราว และจะเปิดใช้งานหลัง 6/10',
    },
    authTitle: 'Base URL และการยืนยันตัวตน',
    authCards: [
      {
        title: 'Base URL',
        body: 'ใช้ `https://api.mem9.ai` สำหรับ client ปกติให้ส่ง request ไปที่ `https://api.mem9.ai/v1alpha2/mem9s/...`',
      },
      {
        title: 'Header สำหรับ auth หลัก',
        body: 'ส่ง mem9 API key ของคุณใน `X-API-Key` นี่คือรูปแบบ auth หลักของ `v1alpha2`',
      },
      {
        title: 'Agent identity แบบเลือกได้',
        body: 'ส่ง `X-Mnemo-Agent-Id` เพิ่มเมื่อคุณต้องการให้ write หรือ import ถูกผูกกับ agent ใด agent หนึ่ง เส้นทาง tenant-scoped แบบเดิมยังอยู่ภายใต้ `v1alpha1`',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: 'ลำดับ mem9.ai ที่เล็กที่สุดคือ provision key, export เข้า shell แล้วสร้างและค้นหา memory',
    quickstartSteps: [
      'สร้าง API key ใหม่ด้วย `POST /v1alpha1/mem9s`',
      'export key นั้นเป็น `API_KEY` และตั้ง `API=https://api.mem9.ai/v1alpha2/mem9s`',
      'สร้าง memory ด้วย `POST /memories`',
      'ค้นหากลับด้วย `GET /memories?q=...`',
    ],
    quickstartExamples: [
      { label: 'สร้าง key', code: provisionKeyCode },
      { label: 'Export env vars', code: exportApiEnvCode },
      { label: 'สร้าง memory', code: createMemoryCode },
      { label: 'ค้นหา memory', code: listMemoryCode },
    ],
    endpointGroups: [
      {
        id: 'provisioning',
        title: 'Provisioning',
        description: 'สร้าง key เริ่มต้นที่คุณจะใช้ซ้ำสำหรับเข้าถึง hosted mem9',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: 'สร้าง mem9 API key ใหม่',
            description: 'ไม่ต้องใช้ auth และไม่ต้องมี request body บริการ hosted จะตอบกลับ `201` พร้อม field `id` และ `id` นั้นคือ key ที่คุณต้องเก็บไว้ใช้ต่อ',
            responseFields: provisionResponseFields,
            examples: [{ label: 'สร้าง key', code: provisionKeyCode }],
          },
        ],
      },
      keyStatusEndpointGroup,
      {
        id: 'memories',
        title: 'Memories',
        description: 'สร้าง ค้นหา อ่าน อัปเดต และลบ memory ที่เก็บอยู่ใน mem9 space ของคุณ',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'สร้าง memory หรือรัน message ingest',
            description: 'ใช้ `content` สำหรับ write โดยตรง หรือ `messages` สำหรับ ingest ห้ามส่งทั้งสองอย่างพร้อมกันใน request เดียว',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [
              { label: 'สร้าง memory', code: createMemoryCode },
              { label: 'Smart ingest', code: smartIngestCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'แสดงรายการหรือค้นหา memory',
            description: 'ถ้ามี `q` handler จะทำ recall search ถ้าไม่มี `q` endpoint จะทำงานคล้าย list API ที่มีตัวกรอง',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'ค้นหา memory', code: listMemoryCode },
              { label: 'กรองด้วย tag / source', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'อ่าน memory เดียวตาม id',
            description: 'ดึง memory object เดียวจาก mem9 API',
            headers: hostedReadHeaders,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'อ่าน memory', code: getMemoryCode }],
          },
          {
            method: 'PUT',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'อัปเดต memory เดียว',
            description: 'อัปเดต content, tags หรือ metadata และส่ง `If-Match` ด้วยหากต้องการตรวจ version แบบ optimistic',
            headers: hostedUpdateHeaders,
            bodyFields: memoryUpdateBodyFields,
            responseFields: memoryObjectResponseFields,
            examples: [{ label: 'อัปเดต memory', code: updateMemoryCode }],
          },
          {
            method: 'DELETE',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'ลบ memory เดียว',
            description: 'ลบ row ที่เลือกและคืน `204 No Content` เมื่อสำเร็จ',
            headers: hostedReadHeaders,
            examples: [{ label: 'ลบ memory', code: deleteMemoryCode }],
          },
          batchDeleteMemoryEndpoint,
        ],
      },
      spaceChainEndpointGroup,
      {
        id: 'imports',
        title: 'Imports',
        description: 'อัปโหลดไฟล์ memory หรือ session แล้วติดตามสถานะ task เบื้องหลัง',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/imports',
            summary: 'สร้าง import task',
            description: 'อัปโหลดไฟล์เป็น `memory` หรือ `session` จากนั้น handler จะคิวการประมวลผลแบบ async และคืน task id ทันที',
            headers: hostedMultipartHeaders,
            bodyFields: importBodyFields,
            responseFields: importTaskResponseFields,
            examples: [
              { label: 'นำเข้าไฟล์ memory', code: importMemoryFileCode },
              { label: 'นำเข้าไฟล์ session', code: importSessionFileCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports',
            summary: 'แสดงรายการ import task',
            description: 'คืน import task ทั้งหมดที่มองเห็นได้ใน mem9 space ปัจจุบัน',
            headers: hostedReadHeaders,
            responseFields: importTaskListResponseFields,
            examples: [{ label: 'ดูรายการ import task', code: listImportsCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/imports/{id}',
            summary: 'อ่าน import task เดียว',
            description: 'poll task เดียวจนกว่าจะเป็น `done` หรือ `failed`',
            headers: hostedReadHeaders,
            responseFields: importTaskDetailResponseFields,
            examples: [{ label: 'อ่าน import task', code: getImportCode }],
          },
        ],
      },
      {
        id: 'session-messages',
        title: 'Session Messages',
        description: 'ดู row บทสนทนาแบบดิบที่ถูกเก็บไว้ระหว่าง ingest',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'แสดง session messages ตาม session id',
            description: 'ส่ง `session_id` ซ้ำใน query string สำหรับแต่ละ session ที่ต้องการอ่าน และใช้ `limit_per_session` เพื่อจำกัดจำนวน row ต่อ session',
            headers: hostedReadHeaders,
            queryParams: sessionMessagesQueryParams,
            responseFields: sessionMessagesResponseFields,
            examples: [{ label: 'อ่าน session messages', code: sessionMessagesCode }],
          },
        ],
      },
      {
        id: 'health',
        title: 'Health & Compatibility',
        description: 'ใช้ `/healthz` สำหรับ liveness check ส่วนเส้นทาง tenant-scoped แบบเดิมยังอยู่ที่ `/v1alpha1/mem9s/{tenantID}/...` แต่ client แบบ hosted ควรใช้ `v1alpha2` + `X-API-Key`',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: 'ตรวจสถานะสุขภาพของ service',
            description: 'เหมาะสำหรับตรวจก่อน onboarding หรือใช้ไล่ปัญหาเรื่อง network reachability',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
          versionEndpoint,
        ],
      },
    ],
    ctaTitle: 'ถ้าคุณต้องการเส้นทางแบบมีตัวช่วยมากกว่า?',
    ctaBody: 'ถ้าคุณกำลัง onboarding OpenClaw มากกว่าการสร้าง integration โดยตรง ให้เริ่มจาก SKILL.md สาธารณะ แล้วใช้ API key เดียวกันต่อใน Your Memory',
    ctaLinks: [
      { label: 'SKILL.md', href: 'https://mem9.ai/SKILL.md', external: true },
      { label: 'Your Memory', href: '/your-memory/', external: true },
      { label: 'GitHub', href: 'https://github.com/mem9-ai/mem9', external: true },
    ],
  },
};

const releaseNoteSourceGroups: SiteReleaseNoteSource[][][] = [
  [
    [
      { label: 'mem9 issue #347', href: 'https://github.com/mem9-ai/mem9/issues/347' },
    ],
    [
      { label: 'mem9 feat/app-id', href: 'https://github.com/mem9-ai/mem9/tree/feat/app-id' },
      { label: 'console-fe feat/app-id', href: 'https://github.com/mem9-ai/mem9-console-fe/tree/feat/app-id' },
      { label: 'console-server feat/app-id', href: 'https://github.com/mem9-ai/mem9-console-server/tree/feat/app-id' },
    ],
    [
      { label: 'mem9 4494822', href: 'https://github.com/mem9-ai/mem9/commit/4494822' },
      { label: 'mem9 d9cc02a', href: 'https://github.com/mem9-ai/mem9/commit/d9cc02a' },
      { label: 'mem9 cbd9b16', href: 'https://github.com/mem9-ai/mem9/commit/cbd9b16' },
    ],
    [
      { label: 'console-server #72', href: 'https://github.com/mem9-ai/mem9-console-server/pull/72' },
      { label: 'console-server #64', href: 'https://github.com/mem9-ai/mem9-console-server/pull/64' },
      { label: 'console-fe #52', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/52' },
    ],
    [
      { label: 'console-fe #53', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/53' },
      { label: 'console-fe #34', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/34' },
      { label: 'console-fe #28', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/28' },
    ],
    [
      { label: 'mem9 #337', href: 'https://github.com/mem9-ai/mem9/pull/337' },
      { label: 'console-server #61', href: 'https://github.com/mem9-ai/mem9-console-server/pull/61' },
      { label: 'console-fe #56', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/56' },
    ],
    [
      { label: 'mem9 #338', href: 'https://github.com/mem9-ai/mem9/pull/338' },
      { label: 'console-fe #57', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/57' },
    ],
  ],
  [
    [
      { label: 'mem9 #335', href: 'https://github.com/mem9-ai/mem9/pull/335' },
      { label: 'mem9 #326', href: 'https://github.com/mem9-ai/mem9/pull/326' },
      { label: 'console-fe #51', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/51' },
    ],
    [
      { label: 'mem9 #327', href: 'https://github.com/mem9-ai/mem9/pull/327' },
      { label: 'mem9 #332', href: 'https://github.com/mem9-ai/mem9/pull/332' },
      { label: 'console-server #56', href: 'https://github.com/mem9-ai/mem9-console-server/pull/56' },
      { label: 'console-fe #47', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/47' },
    ],
    [
      { label: 'console-fe #49', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/49' },
    ],
    [
      { label: 'mem9 #309', href: 'https://github.com/mem9-ai/mem9/pull/309' },
      { label: 'console-server #30', href: 'https://github.com/mem9-ai/mem9-console-server/pull/30' },
      { label: 'console-server #31', href: 'https://github.com/mem9-ai/mem9-console-server/pull/31' },
      { label: 'console-server #33', href: 'https://github.com/mem9-ai/mem9-console-server/pull/33' },
      { label: 'console-fe #28', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/28' },
    ],
    [
      { label: 'console-server #32', href: 'https://github.com/mem9-ai/mem9-console-server/pull/32' },
      { label: 'console-server #35', href: 'https://github.com/mem9-ai/mem9-console-server/pull/35' },
      { label: 'console-server #37', href: 'https://github.com/mem9-ai/mem9-console-server/pull/37' },
      { label: 'console-fe #29', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/29' },
    ],
    [
      { label: 'mem9 #308', href: 'https://github.com/mem9-ai/mem9/pull/308' },
      { label: 'console-server #37', href: 'https://github.com/mem9-ai/mem9-console-server/pull/37' },
      { label: 'console-fe #29', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/29' },
    ],
    [
      { label: 'console-server #28', href: 'https://github.com/mem9-ai/mem9-console-server/pull/28' },
      { label: 'console-server #27', href: 'https://github.com/mem9-ai/mem9-console-server/pull/27' },
    ],
  ],
];

const defaultReleaseNoteVersion = 'v1.0.0';

function attachReleaseNoteSources(copy: SiteReleaseNotesPageDraft): SiteReleaseNotesPageCopy {
  return {
    ...copy,
    groups: copy.groups.map((group, groupIndex) => ({
      ...group,
      items: group.items.map((item, itemIndex) => ({
        ...item,
        version: item.version ?? defaultReleaseNoteVersion,
        sources: releaseNoteSourceGroups[groupIndex]?.[itemIndex] ?? [],
      })),
    })),
  };
}

const releaseNotesPageCopyEn = attachReleaseNoteSources({
    meta: {
      title: 'Release Notes | mem9',
      description:
        'Customer-facing mem9 release notes covering new console, API, Space Chain, billing, and memory management features.',
    },
    kicker: 'Release Notes',
    title: 'What is new in mem9',
    intro: 'Recent important updates from the mem9 authors.',
    heroImageAlt: 'mem9 release notes illustration with a memory chip and golden data streams',
    starPrompt: 'Open source is not easy. Please support us by starring mem9 on GitHub.',
    starBadgeAlt: 'GitHub stars for mem9-ai/mem9',
    starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
    starHref: 'https://github.com/mem9-ai/mem9',
    updatedLabel: 'Last updated',
    updatedValue: 'June 4, 2026',
    sourcesLabel: 'PR sources',
    sourcesFeedback: 'You are welcome to open the PRs or issues and share your feedback.',
    groups: [
    {
      period: 'June 2026',
      items: [
        {
          date: 'June 4, 2026',
          title: 'Major performance update for mem9.ai',
          summary:
            'The official mem9.ai service is receiving an important performance update. Because of early deployment choices, parts of the service and database were running across regions, which added unnecessary latency. We are migrating data in two phases to bring API latency down substantially.',
          sections: [
            {
              title: 'Rollout',
              items: [
                'Phase 1 was released at noon Beijing time on June 4 and reduced typical API latency from about 4-6 seconds on average to about 1.3 seconds.',
                'Phase 2 is expected to finish later this week and migrates metadata, with the goal of bringing average latency down to within a few hundred milliseconds.',
              ],
            },
            {
              title: 'Feedback',
              body: 'No client-side change is required. This update improves the hosted mem9.ai service path, and feedback on official service performance is welcome.',
            },
          ],
        },
        {
          date: 'June 4, 2026',
          title: 'appId isolation under one API key',
          summary:
            'A single mem9 API key can now hold multiple isolated application memory spaces with `appId`. Memories and raw sessions written with an appId stay associated with that app, so different products, agents, environments, or workflows can share the same key without mixing their day-to-day memory.',
          sections: [
            {
              title: 'How appId scopes memory',
              items: [
                'When writing memory or ingesting messages, send `appId`, for example `appId: "docs"` or `appId: "support-bot"`.',
                'When searching, omit `appId` to search across all appIds under the key, pass a non-empty appId to search one sub-space, or pass `appId=null` / `appId=` to search only default global memory.',
                'In Console, use the appId filter, appId column, and memory creation appId field to inspect or write memories for a specific application.',
              ],
            },
          ],
        },
        {
          date: 'June 4, 2026',
          title: 'API reference refresh with live API testing',
          summary:
            'The mem9 API reference has been refreshed with a clearer layout, updated endpoint content, and a built-in API test console. Developers can now read the docs and try requests from the same page instead of switching between documentation and separate tooling.',
          sections: [
            {
              title: 'What changed',
              items: [
                'The API page now has a clearer sidebar and endpoint layout.',
                'The documentation content was updated for authentication, appId isolation, memory APIs, imports, session messages, and Space Chain APIs.',
              ],
            },
            {
              title: 'Where to try it',
              body: 'Open the API page and use the API test panel to set the base URL, API key, headers, path/query/body fields, run a request, and inspect the response directly in the documentation page.',
            },
          ],
        },
        {
          date: 'June 3, 2026',
          title: 'Import an existing mem9 API key into Console',
          summary:
            'Users who already received a mem9 API key from an agent setup or API flow can now attach that key to a Console Space. The Console keeps raw key material protected, shows masked key details, and moves claimed keys into the organization quota model.',
          sections: [
            {
              title: 'Claim flow',
              items: [
                'Open the Console claim flow from the setup link, or go directly to `/console/claim`.',
                'Paste the existing key, choose an organization and project, then bind it to an empty Space or create a new Space during the flow.',
                'After binding, manage the Space from Console without exposing the raw key in normal views.',
              ],
            },
          ],
          sources: [
            { label: 'console-server #72', href: 'https://github.com/mem9-ai/mem9-console-server/pull/72' },
            { label: 'console-server #64', href: 'https://github.com/mem9-ai/mem9-console-server/pull/64' },
            { label: 'console-fe #52', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/52' },
          ],
        },
        {
          date: 'June 3, 2026',
          title: 'Embedded billing, payment methods, and invoices',
          summary:
            'The Console billing area now includes a fuller Stripe-backed billing experience: current plan, billing address, payment methods, plan change controls, coupons, cancel/resume actions, and invoice history.',
          sections: [
            {
              title: 'Where to manage it',
              items: [
                'Open Console, select the organization, then go to Billing.',
                'Use Upgrade or Change plan to enter billing details, choose a plan, and confirm payment with Stripe Elements.',
                'Review saved payment methods and invoices from the same Billing page.',
              ],
            },
          ],
          sources: [
            { label: 'console-fe #53', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/53' },
            { label: 'console-fe #34', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/34' },
            { label: 'console-fe #28', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/28' },
          ],
        },
        {
          date: 'June 1, 2026',
          title: 'Space Chain knowledge routing',
          summary:
            'Space Chains can now route extracted knowledge to the right Space Chain node based on routing policy fields. This makes a chain act more like a knowledgebase: broad ingest can land in the right team, project, or topic Space while recall still works across the chain.',
          sections: [
            {
              title: 'Routing setup',
              items: [
                'Open a Space Chain detail page and configure the knowledge extraction policy.',
                'Use the node selector and routing diagram to decide where extracted facts should be written.',
                'When creating memory, enable smart ingest to extract and route facts instead of writing only one raw memory item.',
              ],
            },
          ],
          sources: [
            { label: 'mem9 #337', href: 'https://github.com/mem9-ai/mem9/pull/337' },
            { label: 'console-server #61', href: 'https://github.com/mem9-ai/mem9-console-server/pull/61' },
            { label: 'console-fe #56', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/56' },
          ],
        },
        {
          date: 'June 1, 2026',
          title: 'Server-side memory sorting and search controls',
          summary:
            'Memory tables now sort and filter against the full server result set, not just the current page. Users can sort by content, type, tags, and updated time while combining the sort with search controls.',
          sections: [
            {
              title: 'Table controls',
              items: [
                'Open a Space or Space Chain memory workbench.',
                'Click a table header to sort ascending or descending.',
                'Use the search fields for content, type, and tags; the server applies the filter and sort before pagination.',
              ],
            },
          ],
          sources: [
            { label: 'mem9 #338', href: 'https://github.com/mem9-ai/mem9/pull/338' },
            { label: 'console-fe #57', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/57' },
          ],
        },
      ],
    },
    {
      period: 'May 2026',
      items: [
        {
          date: 'May 30, 2026',
          title: 'Faster Space Chain recall with timing visibility',
          summary:
            'Space Chain recall now parallelizes node scans and auth resolution, then keeps global reranking behavior. The Console also shows recall timing so teams can see how long test recalls take.',
          sections: [
            {
              title: 'What changed',
              body: 'Recall work is parallelized behind the scenes, while global reranking behavior stays the same.',
            },
            {
              title: 'How to validate',
              items: [
                'Open a Space Chain detail page and use the Recall test panel.',
                'Enable Force scanAll when you want to test cross-chain recall behavior.',
                'Check the elapsed time shown with the result to compare query performance.',
              ],
            },
          ],
          sources: [
            { label: 'mem9 #335', href: 'https://github.com/mem9-ai/mem9/pull/335' },
            { label: 'mem9 #326', href: 'https://github.com/mem9-ai/mem9/pull/326' },
            { label: 'console-fe #51', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/51' },
          ],
        },
        {
          date: 'May 25, 2026',
          title: 'Session memory management and batch cleanup',
          summary:
            'The memory workbench can now list session memory rows, filter by All, Insight, Pinned, or Session, select rows, change page size, and delete selected memories in bulk. The API also supports session-row deletion and a request-level switch to avoid saving raw session rows when only extracted facts are needed.',
          sections: [
            {
              title: 'Console cleanup',
              items: [
                'Open a Space memory workbench and choose the memory type filter.',
                'Select one or more rows, then delete selected memories from the toolbar.',
              ],
            },
            {
              title: 'API option',
              body: 'For API ingest flows, set `disableSessionSave` when you want fact extraction without preserving raw session messages.',
            },
          ],
          sources: [
            { label: 'mem9 #327', href: 'https://github.com/mem9-ai/mem9/pull/327' },
            { label: 'mem9 #332', href: 'https://github.com/mem9-ai/mem9/pull/332' },
            { label: 'console-server #56', href: 'https://github.com/mem9-ai/mem9-console-server/pull/56' },
            { label: 'console-fe #47', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/47' },
          ],
        },
        {
          date: 'May 26, 2026',
          title: 'Console localization for seven languages',
          summary:
            'The Console now supports English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Indonesian, and Thai across the shell, auth pages, Spaces, Memories, Settings, Project, and Space Chain flows.',
          sections: [
            {
              title: 'Language switcher',
              items: [
                'Open the language menu in the Console header or auth page.',
                'Choose a language; the selection is saved locally and updates the document language.',
              ],
            },
          ],
          sources: [
            { label: 'console-fe #49', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/49' },
          ],
        },
        {
          date: 'May 19, 2026',
          title: 'Billing and usage dashboards',
          summary:
            'Organizations can review billing plan state, entitlements, request usage summaries, daily rollups, and detailed usage events. The runtime now has quota gates and durable metering so commercial usage can be tracked without changing self-hosted behavior.',
          sections: [
            {
              title: 'Where to view it',
              items: [
                'Open Console and select an organization.',
                'Go to Billing to review plan and entitlement state.',
                'Go to Usage to inspect memory recall and memory write request totals over a selected date range.',
              ],
            },
          ],
          sources: [
            { label: 'mem9 #309', href: 'https://github.com/mem9-ai/mem9/pull/309' },
            { label: 'console-server #30', href: 'https://github.com/mem9-ai/mem9-console-server/pull/30' },
            { label: 'console-server #31', href: 'https://github.com/mem9-ai/mem9-console-server/pull/31' },
            { label: 'console-server #33', href: 'https://github.com/mem9-ai/mem9-console-server/pull/33' },
            { label: 'console-fe #28', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/28' },
          ],
        },
        {
          date: 'May 19, 2026',
          title: 'Space memory explorer and runtime tools',
          summary:
            'Spaces now have a memory workbench with summary metrics, imports, memory list/detail reads, create/edit/delete controls, and a shared recall test panel. Raw API keys stay server-side while Console proxies the authorized memory operations.',
          sections: [
            {
              title: 'Workspace tools',
              items: [
                'Open a Space detail page in Console.',
                'Use the Memories tab to browse, create, edit, or delete memories.',
                'Use the Recall test panel to test what the Space would retrieve for a query.',
              ],
            },
          ],
          sources: [
            { label: 'console-server #32', href: 'https://github.com/mem9-ai/mem9-console-server/pull/32' },
            { label: 'console-server #35', href: 'https://github.com/mem9-ai/mem9-console-server/pull/35' },
            { label: 'console-server #37', href: 'https://github.com/mem9-ai/mem9-console-server/pull/37' },
            { label: 'console-fe #29', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/29' },
          ],
        },
        {
          date: 'May 15, 2026',
          title: 'Space Chain runtime support',
          summary:
            'Space Chains are now available at runtime, with ordered recall and write behavior, chain key authentication, and provenance in chain responses. This lets a single chain key retrieve from multiple Spaces in a controlled order.',
          sections: [
            {
              title: 'Runtime setup',
              items: [
                'Create or open a Space Chain in Console.',
                'Add Space nodes in the order you want recall to search them.',
                'Create a chain key binding, then use that key with `scanAll=true` when you want recall across the chain.',
              ],
            },
          ],
          sources: [
            { label: 'mem9 #308', href: 'https://github.com/mem9-ai/mem9/pull/308' },
            { label: 'console-server #37', href: 'https://github.com/mem9-ai/mem9-console-server/pull/37' },
            { label: 'console-fe #29', href: 'https://github.com/mem9-ai/mem9-console-fe/pull/29' },
          ],
        },
        {
          date: 'May 14, 2026',
          title: 'Safer Space API key management and organization roles',
          summary:
            'Space API keys are stored in an encrypted catalog with stable masked display values, explicit reveal workflows, and active binding checks. Organization roles now distinguish owner, admin, and member permissions for resource and key management.',
          sections: [
            {
              title: 'Permissions',
              items: [
                'Owners and admins can create, bind, and reveal Space keys from the Space key management flow.',
                'Members can continue reading allowed resources without receiving mutation permissions.',
                'Use masked key values in normal views; reveal a key only when you need to copy it into a client.',
              ],
            },
          ],
          sources: [
            { label: 'console-server #28', href: 'https://github.com/mem9-ai/mem9-console-server/pull/28' },
            { label: 'console-server #27', href: 'https://github.com/mem9-ai/mem9-console-server/pull/27' },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyZh = attachReleaseNoteSources({
  meta: {
    title: '发布说明 | mem9',
    description: 'mem9 面向客户的发布说明，覆盖 Console、API、Space Chain、计费和记忆管理的新功能。',
  },
  kicker: '发布说明',
  title: 'mem9 最近更新了什么',
  intro: 'mem9 作者们最近发布的重要更新。',
  heroImageAlt: 'mem9 发布说明插图，展示记忆芯片和金色数据流',
  starPrompt: '开源项目不容易，请大家给我们Star来支持我们。',
  starBadgeAlt: 'mem9-ai/mem9 的 GitHub Stars',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: '最后更新',
  updatedValue: '2026 年 6 月 4 日',
  sourcesLabel: 'PR 来源',
  sourcesFeedback: '欢迎进入PR、issue提交您的反馈。',
  groups: [
    {
      period: '2026 年 6 月',
      items: [
        {
          date: '2026 年 6 月 4 日',
          title: 'mem9.ai 官方服务迎来重要性能更新',
          summary:
            'mem9.ai 官方服务正在进行一次重要的性能优化。由于早期部署时服务和数据库存在跨区访问，API 请求产生了额外延迟。我们正在分两个阶段迁移数据，以显著降低官方托管服务的 API 延迟。',
          sections: [
            {
              title: '发布节奏',
              items: [
                '第一阶段已在北京时间 6 月 4 日中午发布，将普遍 API 延迟从平均约 4-6 秒降低到约 1.3 秒。',
                '第二阶段预计在本周完成元数据迁移，目标是把平均延迟进一步降低到几百毫秒以内。',
              ],
            },
            {
              title: '反馈',
              body: '这次更新不需要客户端改动，会直接优化 mem9.ai 官方服务链路。欢迎大家继续反馈 mem9 官方服务的性能体验。',
            },
          ],
        },
        {
          date: '2026 年 6 月 4 日',
          title: '同一个 API key 下的 appId 隔离',
          summary:
            '同一个 mem9 API key 现在可以通过 `appId` 承载多个相互隔离的应用记忆空间。写入时带 appId 的 memory 和 raw session 会归属到对应应用，适合把不同产品、Agent、环境或工作流放在同一把 key 下，同时避免日常记忆互相混在一起。',
          sections: [
            {
              title: 'appId 如何隔离记忆',
              items: [
                '写入 memory 或 ingest messages 时传入 `appId`，例如 `appId: "docs"` 或 `appId: "support-bot"`。',
                '搜索时，不传 `appId` 表示跨该 key 下的全部 appId 搜索；传非空 appId 表示只查一个子空间；传 `appId=null` 或 `appId=` 表示只查默认/global 记忆。',
                '在 Console 中，可以用 appId 过滤器、appId 列和创建 memory 时的 appId 字段，查看或写入某个应用的记忆。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 4 日',
          title: 'API 文档更新，并支持站内直接测试 API',
          summary:
            'mem9 API 文档完成了一次重要更新：页面布局更清晰，endpoint 内容补充得更完整，并新增了内置 API 测试控制台。开发者现在可以在同一个页面阅读文档并直接发起请求，不必在文档和外部调试工具之间来回切换。',
          sections: [
            {
              title: '更新内容',
              items: [
                'API 页面更新了侧边栏和 endpoint 信息结构，阅读路径更清晰。',
                '文档内容补充了鉴权、appId 隔离、memory API、imports、session messages 和 Space Chain API。',
              ],
            },
            {
              title: '在哪里体验',
              body: '从站点导航打开 API 页面，在 API test 面板里设置 base URL、API key、headers、path/query/body 字段，运行请求，并直接在文档页查看响应。',
            },
          ],
        },
        {
          date: '2026 年 6 月 3 日',
          title: '把已有 mem9 API key 导入 Console',
          summary:
            '已经通过 Agent 安装或 API 流程拿到 mem9 API key 的用户，现在可以把 key 绑定到 Console 的 Space。Console 会保护原始 key，只展示脱敏信息，并把已认领的 key 纳入组织配额模型。',
          sections: [
            {
              title: '认领流程',
              items: [
                '从安装流程里的认领链接进入 Console，或直接打开 `/console/claim`。',
                '粘贴已有 key，选择组织和项目，然后绑定到一个空 Space，或在流程中创建新 Space。',
                '绑定后即可在 Console 管理这个 Space，普通页面不会暴露原始 key。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 3 日',
          title: '内嵌计费、支付方式和发票',
          summary:
            'Console 的 Billing 区域现在提供更完整的 Stripe 计费体验，包括当前套餐、账单地址、支付方式、套餐变更、优惠码、取消/恢复订阅和发票历史。',
          sections: [
            {
              title: '在哪里管理',
              items: [
                '打开 Console，选择组织，然后进入 Billing。',
                '点击 Upgrade 或 Change plan，填写账单信息、选择套餐，并通过 Stripe Elements 完成支付确认。',
                '在同一个 Billing 页面查看已保存的支付方式和发票。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 1 日',
          title: 'Space Chain 知识路由',
          summary:
            'Space Chain 现在可以根据路由策略把提取出的知识写入正确的链节点。这样一条链可以像知识库一样工作：宽泛输入会落到对应团队、项目或主题 Space，同时仍可跨链召回。',
          sections: [
            {
              title: '路由配置',
              items: [
                '打开 Space Chain 详情页，配置 knowledge extraction policy。',
                '通过节点选择器和路由图决定提取出的事实应该写到哪里。',
                '创建 memory 时启用 smart ingest，让系统提取并路由事实，而不是只写入一条原始 memory。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 1 日',
          title: '服务端记忆排序和搜索控件',
          summary:
            'Memory 表格现在会基于服务端完整结果集排序和过滤，而不是只重排当前页。用户可以按内容、类型、标签和更新时间排序，并结合搜索条件使用。',
          sections: [
            {
              title: '表格控件',
              items: [
                '打开 Space 或 Space Chain 的 memory workbench。',
                '点击表头切换升序或降序排序。',
                '使用内容、类型和标签搜索框；服务端会先过滤和排序，再分页返回。',
              ],
            },
          ],
        },
      ],
    },
    {
      period: '2026 年 5 月',
      items: [
        {
          date: '2026 年 5 月 30 日',
          title: '更快的 Space Chain 召回和耗时展示',
          summary:
            'Space Chain 召回现在会并行扫描节点并并行解析鉴权节点，同时保留全局 rerank 行为。Console 也会展示召回耗时，方便团队观察测试查询的速度。',
          sections: [
            {
              title: '变更内容',
              body: '召回链路在后台并行化处理，同时保留全局 rerank 行为。',
            },
            {
              title: '如何验证',
              items: [
                '打开 Space Chain 详情页，使用 Recall test 面板。',
                '需要测试跨链召回时启用 Force scanAll。',
                '查看结果旁边的耗时，用来比较查询性能。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 25 日',
          title: 'Session memory 管理和批量清理',
          summary:
            'Memory workbench 现在可以列出 session memory，按 All、Insight、Pinned、Session 过滤，选择行、调整页大小，并批量删除选中的 memories。API 也支持删除 session 行，并支持只提取事实、不保存原始 session 的请求级开关。',
          sections: [
            {
              title: 'Console 清理',
              items: [
                '打开 Space memory workbench，选择 memory 类型过滤器。',
                '选择一行或多行，然后从工具栏删除选中的 memories。',
              ],
            },
            {
              title: 'API 选项',
              body: 'API ingest 时，如果只需要事实提取、不想保存原始会话消息，可设置 `disableSessionSave`。',
            },
          ],
        },
        {
          date: '2026 年 5 月 26 日',
          title: 'Console 支持七种语言',
          summary:
            'Console 现在支持英语、简体中文、繁体中文、日语、韩语、印尼语和泰语，覆盖 shell、登录页、Spaces、Memories、Settings、Project 和 Space Chain 流程。',
          sections: [
            {
              title: '语言切换',
              items: [
                '在 Console header 或登录页打开语言菜单。',
                '选择语言；选择会保存在本地，并更新页面语言属性。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 19 日',
          title: '计费和用量看板',
          summary:
            '组织现在可以查看计费套餐状态、权益、请求用量汇总、每日 rollup 和详细用量事件。runtime 已支持配额闸门和持久 metering，用于商业用量跟踪，同时不改变自托管行为。',
          sections: [
            {
              title: '在哪里查看',
              items: [
                '打开 Console 并选择组织。',
                '进入 Billing 查看套餐和权益状态。',
                '进入 Usage，按日期范围查看 memory recall 和 memory write 请求总量。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 19 日',
          title: 'Space memory 浏览器和运行时工具',
          summary:
            'Space 现在有 memory workbench，支持汇总指标、imports、memory 列表/详情、创建/编辑/删除，以及共享 Recall test 面板。原始 API key 保持在服务端，Console 会代理已授权的 memory 操作。',
          sections: [
            {
              title: '工作台能力',
              items: [
                '在 Console 打开 Space 详情页。',
                '使用 Memories tab 浏览、创建、编辑或删除 memories。',
                '使用 Recall test 面板测试这个 Space 对查询会召回什么。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 15 日',
          title: 'Space Chain 运行时支持',
          summary:
            'Space Chain 现在可在运行时使用，支持有序召回和写入、chain key 鉴权，以及链响应中的来源信息。一个 chain key 可以按受控顺序从多个 Space 召回。',
          sections: [
            {
              title: '运行时配置',
              items: [
                '在 Console 创建或打开 Space Chain。',
                '按照希望召回搜索的顺序添加 Space 节点。',
                '创建 chain key binding；需要跨链召回时，用这个 key 并设置 `scanAll=true`。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 14 日',
          title: '更安全的 Space API key 管理和组织角色',
          summary:
            'Space API key 会存储在加密目录中，普通页面展示稳定的脱敏值，并提供显式 reveal 流程和 active binding 检查。组织角色现在区分 owner、admin 和 member 权限。',
          sections: [
            {
              title: '权限变化',
              items: [
                'Owner 和 admin 可以在 Space key 管理流程中创建、绑定和 reveal key。',
                'Member 可以继续读取允许访问的资源，但没有变更权限。',
                '普通页面使用脱敏 key；只有需要复制到客户端时才 reveal。',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyZhHant = attachReleaseNoteSources({
  meta: {
    title: '發布說明 | mem9',
    description: 'mem9 面向客戶的發布說明，涵蓋 Console、API、Space Chain、計費和記憶管理的新功能。',
  },
  kicker: '發布說明',
  title: 'mem9 最近更新了什麼',
  intro: 'mem9 作者們最近發布的重要更新。',
  heroImageAlt: 'mem9 發布說明插圖，展示記憶晶片和金色資料流',
  starPrompt: '開源專案不容易，請大家給我們Star來支持我們。',
  starBadgeAlt: 'mem9-ai/mem9 的 GitHub Stars',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: '最後更新',
  updatedValue: '2026 年 6 月 4 日',
  sourcesLabel: 'PR 來源',
  sourcesFeedback: '歡迎進入PR、issue提交您的回饋。',
  groups: [
    {
      period: '2026 年 6 月',
      items: [
        {
          date: '2026 年 6 月 4 日',
          title: 'mem9.ai 官方服務迎來重要效能更新',
          summary:
            'mem9.ai 官方服務正在進行重要效能優化。由於早期部署時服務和資料庫存在跨區存取，API 請求產生了額外延遲。我們正在分兩個階段遷移資料，以大幅降低官方託管服務的 API 延遲。',
          sections: [
            {
              title: '發布節奏',
              items: [
                '第一階段已在北京時間 6 月 4 日中午發布，將普遍 API 延遲從平均約 4-6 秒降低到約 1.3 秒。',
                '第二階段預計在本週完成中繼資料遷移，目標是把平均延遲進一步降低到幾百毫秒以內。',
              ],
            },
            {
              title: '回饋',
              body: '這次更新不需要客戶端改動，會直接優化 mem9.ai 官方服務鏈路。歡迎大家繼續回饋 mem9 官方服務的效能體驗。',
            },
          ],
        },
        {
          date: '2026 年 6 月 4 日',
          title: '同一把 API key 下的 appId 隔離',
          summary:
            '同一把 mem9 API key 現在可以透過 `appId` 承載多個彼此隔離的應用記憶空間。寫入時帶 appId 的 memory 和 raw session 會歸屬到對應應用，適合把不同產品、Agent、環境或工作流程放在同一把 key 下，同時避免日常記憶互相混在一起。',
          sections: [
            {
              title: 'appId 如何隔離記憶',
              items: [
                '寫入 memory 或 ingest messages 時傳入 `appId`，例如 `appId: "docs"` 或 `appId: "support-bot"`。',
                '搜尋時，不傳 `appId` 表示跨該 key 下的全部 appId 搜尋；傳非空 appId 表示只查一個子空間；傳 `appId=null` 或 `appId=` 表示只查預設/global 記憶。',
                '在 Console 中，可以用 appId 篩選器、appId 欄位和建立 memory 時的 appId 欄位，查看或寫入某個應用的記憶。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 4 日',
          title: 'API 文件更新，並支援站內直接測試 API',
          summary:
            'mem9 API 文件完成重要更新：頁面版面更清楚，endpoint 內容補充得更完整，並新增內建 API 測試控制台。開發者現在可以在同一個頁面閱讀文件並直接發起請求，不必在文件和外部除錯工具之間來回切換。',
          sections: [
            {
              title: '更新內容',
              items: [
                'API 頁面更新了側邊欄和 endpoint 資訊結構，閱讀路徑更清晰。',
                '文件內容補充了鑑權、appId 隔離、memory API、imports、session messages 和 Space Chain API。',
              ],
            },
            {
              title: '在哪裡體驗',
              body: '從站點導覽開啟 API 頁面，在 API test 面板裡設定 base URL、API key、headers、path/query/body 欄位，執行請求，並直接在文件頁查看回應。',
            },
          ],
        },
        {
          date: '2026 年 6 月 3 日',
          title: '把既有 mem9 API key 匯入 Console',
          summary:
            '已經透過 Agent 安裝或 API 流程拿到 mem9 API key 的使用者，現在可以把 key 綁定到 Console 的 Space。Console 會保護原始 key，只顯示脫敏資訊，並把已認領的 key 納入組織配額模型。',
          sections: [
            {
              title: '認領流程',
              items: [
                '從安裝流程裡的認領連結進入 Console，或直接開啟 `/console/claim`。',
                '貼上既有 key，選擇組織和專案，然後綁定到一個空 Space，或在流程中建立新 Space。',
                '綁定後即可在 Console 管理這個 Space，普通頁面不會暴露原始 key。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 3 日',
          title: '內嵌計費、付款方式和發票',
          summary:
            'Console 的 Billing 區域現在提供更完整的 Stripe 計費體驗，包括目前方案、帳單地址、付款方式、方案變更、優惠碼、取消/恢復訂閱和發票歷史。',
          sections: [
            {
              title: '在哪裡管理',
              items: [
                '開啟 Console，選擇組織，然後進入 Billing。',
                '點擊 Upgrade 或 Change plan，填寫帳單資訊、選擇方案，並透過 Stripe Elements 完成付款確認。',
                '在同一個 Billing 頁面查看已儲存的付款方式和發票。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 1 日',
          title: 'Space Chain 知識路由',
          summary:
            'Space Chain 現在可以根據路由策略把提取出的知識寫入正確的鏈節點。這樣一條鏈可以像知識庫一樣工作：寬泛輸入會落到對應團隊、專案或主題 Space，同時仍可跨鏈召回。',
          sections: [
            {
              title: '路由設定',
              items: [
                '開啟 Space Chain 詳情頁，設定 knowledge extraction policy。',
                '透過節點選擇器和路由圖決定提取出的事實應該寫到哪裡。',
                '建立 memory 時啟用 smart ingest，讓系統提取並路由事實，而不是只寫入一條原始 memory。',
              ],
            },
          ],
        },
        {
          date: '2026 年 6 月 1 日',
          title: '服務端記憶排序和搜尋控制',
          summary:
            'Memory 表格現在會基於服務端完整結果集排序和篩選，而不是只重排目前頁面。使用者可以按內容、類型、標籤和更新時間排序，並結合搜尋條件使用。',
          sections: [
            {
              title: '表格控制',
              items: [
                '開啟 Space 或 Space Chain 的 memory workbench。',
                '點擊表頭切換升序或降序排序。',
                '使用內容、類型和標籤搜尋框；服務端會先篩選和排序，再分頁返回。',
              ],
            },
          ],
        },
      ],
    },
    {
      period: '2026 年 5 月',
      items: [
        {
          date: '2026 年 5 月 30 日',
          title: '更快的 Space Chain 召回和耗時展示',
          summary:
            'Space Chain 召回現在會並行掃描節點並並行解析鑑權節點，同時保留全域 rerank 行為。Console 也會展示召回耗時，方便團隊觀察測試查詢速度。',
          sections: [
            {
              title: '變更內容',
              body: '召回鏈路在後台並行化處理，同時保留全域 rerank 行為。',
            },
            {
              title: '如何驗證',
              items: [
                '開啟 Space Chain 詳情頁，使用 Recall test 面板。',
                '需要測試跨鏈召回時啟用 Force scanAll。',
                '查看結果旁邊的耗時，用來比較查詢效能。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 25 日',
          title: 'Session memory 管理和批量清理',
          summary:
            'Memory workbench 現在可以列出 session memory，按 All、Insight、Pinned、Session 篩選，選擇行、調整頁大小，並批量刪除選中的 memories。API 也支援刪除 session 行，並支援只提取事實、不保存原始 session 的請求級開關。',
          sections: [
            {
              title: 'Console 清理',
              items: [
                '開啟 Space memory workbench，選擇 memory 類型篩選器。',
                '選擇一行或多行，然後從工具列刪除選中的 memories。',
              ],
            },
            {
              title: 'API 選項',
              body: 'API ingest 時，如果只需要事實提取、不想保存原始會話訊息，可設定 `disableSessionSave`。',
            },
          ],
        },
        {
          date: '2026 年 5 月 26 日',
          title: 'Console 支援七種語言',
          summary:
            'Console 現在支援英語、簡體中文、繁體中文、日語、韓語、印尼語和泰語，覆蓋 shell、登入頁、Spaces、Memories、Settings、Project 和 Space Chain 流程。',
          sections: [
            {
              title: '語言切換',
              items: [
                '在 Console header 或登入頁開啟語言選單。',
                '選擇語言；選擇會保存在本地，並更新頁面語言屬性。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 19 日',
          title: '計費和用量看板',
          summary:
            '組織現在可以查看計費方案狀態、權益、請求用量彙總、每日 rollup 和詳細用量事件。runtime 已支援配額閘門和持久 metering，用於商業用量追蹤，同時不改變自託管行為。',
          sections: [
            {
              title: '在哪裡查看',
              items: [
                '開啟 Console 並選擇組織。',
                '進入 Billing 查看方案和權益狀態。',
                '進入 Usage，按日期範圍查看 memory recall 和 memory write 請求總量。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 19 日',
          title: 'Space memory 瀏覽器和執行時工具',
          summary:
            'Space 現在有 memory workbench，支援彙總指標、imports、memory 列表/詳情、建立/編輯/刪除，以及共用 Recall test 面板。原始 API key 保持在服務端，Console 會代理已授權的 memory 操作。',
          sections: [
            {
              title: '工作台能力',
              items: [
                '在 Console 開啟 Space 詳情頁。',
                '使用 Memories tab 瀏覽、建立、編輯或刪除 memories。',
                '使用 Recall test 面板測試這個 Space 對查詢會召回什麼。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 15 日',
          title: 'Space Chain 執行時支援',
          summary:
            'Space Chain 現在可在執行時使用，支援有序召回和寫入、chain key 鑑權，以及鏈回應中的來源資訊。一個 chain key 可以按受控順序從多個 Space 召回。',
          sections: [
            {
              title: '執行時設定',
              items: [
                '在 Console 建立或開啟 Space Chain。',
                '按照希望召回搜尋的順序新增 Space 節點。',
                '建立 chain key binding；需要跨鏈召回時，用這個 key 並設定 `scanAll=true`。',
              ],
            },
          ],
        },
        {
          date: '2026 年 5 月 14 日',
          title: '更安全的 Space API key 管理和組織角色',
          summary:
            'Space API key 會儲存在加密目錄中，普通頁面展示穩定的脫敏值，並提供明確 reveal 流程和 active binding 檢查。組織角色現在區分 owner、admin 和 member 權限。',
          sections: [
            {
              title: '權限變化',
              items: [
                'Owner 和 admin 可以在 Space key 管理流程中建立、綁定和 reveal key。',
                'Member 可以繼續讀取允許存取的資源，但沒有變更權限。',
                '普通頁面使用脫敏 key；只有需要複製到客戶端時才 reveal。',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyJa = attachReleaseNoteSources({
  meta: {
    title: 'リリースノート | mem9',
    description: 'Console、API、Space Chain、課金、メモリ管理に関する mem9 の顧客向けリリースノートです。',
  },
  kicker: 'リリースノート',
  title: 'mem9 の最新アップデート',
  intro: 'mem9 作者による最近の重要アップデートです。',
  heroImageAlt: 'メモリーチップと金色のデータストリームを描いた mem9 リリースノートのイラスト',
  starPrompt: 'オープンソースの継続は簡単ではありません。GitHub で mem9 に Star を付けて応援してください。',
  starBadgeAlt: 'mem9-ai/mem9 の GitHub Stars',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: '最終更新',
  updatedValue: '2026年6月4日',
  sourcesLabel: 'PR ソース',
  sourcesFeedback: 'PR や issue を開いて、ぜひフィードバックをお寄せください。',
  groups: [
    {
      period: '2026年6月',
      items: [
        {
          date: '2026年6月4日',
          title: 'mem9.ai 公式サービスの重要なパフォーマンス更新',
          summary:
            'mem9.ai 公式サービスで重要なパフォーマンス改善を進めています。初期デプロイ時の構成により、一部のサービスとデータベースがリージョンをまたいで動作していたため、API リクエストに余分な遅延が発生していました。データ移行を 2 段階で進め、公式ホストサービスの API レイテンシを大きく下げます。',
          sections: [
            {
              title: 'ロールアウト',
              items: [
                '第 1 段階は北京時間 6 月 4 日正午にリリースされ、一般的な API レイテンシは平均約 4-6 秒から約 1.3 秒に下がりました。',
                '第 2 段階ではメタデータを移行し、今週中の完了を予定しています。平均レイテンシを数百ミリ秒以内に下げることを目標にしています。',
              ],
            },
            {
              title: 'フィードバック',
              body: 'クライアント側の変更は不要です。この更新は mem9.ai 公式サービスの経路を直接改善します。公式サービスのパフォーマンスに関するフィードバックを歓迎します。',
            },
          ],
        },
        {
          date: '2026年6月4日',
          title: '1 つの API key で appId ごとの分離',
          summary:
            '1 つの mem9 API key で、`appId` によって複数の分離されたアプリケーションメモリ空間を扱えるようになりました。appId 付きで書き込まれた memory と raw session は対応するアプリに紐づくため、異なるプロダクト、Agent、環境、ワークフローを同じ key で扱いながら日常的なメモリの混在を避けられます。',
          sections: [
            {
              title: 'appId によるメモリ分離',
              items: [
                'memory の書き込みや ingest messages では `appId` を送ります。例: `appId: "docs"` または `appId: "support-bot"`。',
                '検索時は、`appId` を省略すると key 配下の全 appId を横断検索します。空でない appId を渡すと 1 つのサブ空間のみ、`appId=null` または `appId=` を渡すとデフォルト/global メモリのみを検索します。',
                'Console では appId フィルター、appId 列、memory 作成時の appId フィールドを使って、特定アプリのメモリを確認または書き込みできます。',
              ],
            },
          ],
        },
        {
          date: '2026年6月4日',
          title: 'API ドキュメント刷新とページ内 API テスト',
          summary:
            'mem9 API リファレンスを刷新しました。レイアウトを整理し、endpoint の内容を更新し、組み込みの API テストコンソールを追加しています。開発者はドキュメントと別ツールを行き来せず、同じページで読みながらリクエストを試せます。',
          sections: [
            {
              title: '変更点',
              items: [
                'API ページのサイドバーと endpoint レイアウトが読みやすくなりました。',
                '認証、appId 分離、memory API、imports、session messages、Space Chain API の内容を更新しました。',
              ],
            },
            {
              title: '試す場所',
              body: 'サイトナビゲーションから API ページを開き、API test パネルで base URL、API key、headers、path/query/body フィールドを設定してリクエストを実行し、レスポンスをその場で確認できます。',
            },
          ],
        },
        {
          date: '2026年6月3日',
          title: '既存の mem9 API key を Console にインポート',
          summary:
            'Agent セットアップや API フローで既に mem9 API key を受け取っているユーザーは、その key を Console の Space に紐づけられるようになりました。Console は生の key を保護し、マスク済み情報のみを表示し、認領済み key を組織のクォータモデルに移行します。',
          sections: [
            {
              title: '認領フロー',
              items: [
                'セットアップ手順の認領リンクから Console を開くか、直接 `/console/claim` にアクセスします。',
                '既存 key を貼り付け、組織とプロジェクトを選び、空の Space に紐づけるかフロー内で新しい Space を作成します。',
                '紐づけ後は Console から Space を管理できます。通常画面では生の key は表示されません。',
              ],
            },
          ],
        },
        {
          date: '2026年6月3日',
          title: '組み込み課金、支払い方法、請求書',
          summary:
            'Console の Billing エリアに、Stripe ベースのより完全な課金体験が入りました。現在のプラン、請求先住所、支払い方法、プラン変更、クーポン、キャンセル/再開、請求書履歴を扱えます。',
          sections: [
            {
              title: '管理場所',
              items: [
                'Console を開き、組織を選択して Billing に移動します。',
                'Upgrade または Change plan から請求情報を入力し、プランを選び、Stripe Elements で支払いを確定します。',
                '同じ Billing ページで保存済みの支払い方法と請求書を確認できます。',
              ],
            },
          ],
        },
        {
          date: '2026年6月1日',
          title: 'Space Chain の知識ルーティング',
          summary:
            'Space Chain は、ルーティングポリシーのフィールドに基づいて抽出された知識を正しいチェーンノードへ書き込めるようになりました。広い入力を適切なチーム、プロジェクト、トピックの Space に配置しつつ、チェーン全体で recall できます。',
          sections: [
            {
              title: 'ルーティング設定',
              items: [
                'Space Chain 詳細ページを開き、knowledge extraction policy を設定します。',
                'ノードセレクターとルーティング図で、抽出された事実を書き込む場所を決めます。',
                'memory 作成時に smart ingest を有効にすると、単一の raw memory だけでなく事実を抽出してルーティングできます。',
              ],
            },
          ],
        },
        {
          date: '2026年6月1日',
          title: 'サーバー側メモリ並び替えと検索コントロール',
          summary:
            'Memory テーブルは現在ページだけでなく、サーバー側の完全な結果セットに対して並び替えとフィルターを適用します。内容、種類、タグ、更新日時で並び替えながら検索条件と組み合わせられます。',
          sections: [
            {
              title: 'テーブル操作',
              items: [
                'Space または Space Chain の memory workbench を開きます。',
                'テーブルヘッダーをクリックして昇順または降順に切り替えます。',
                '内容、種類、タグの検索欄を使います。サーバーはページネーション前にフィルターと並び替えを適用します。',
              ],
            },
          ],
        },
      ],
    },
    {
      period: '2026年5月',
      items: [
        {
          date: '2026年5月30日',
          title: 'タイミング表示付きの高速 Space Chain recall',
          summary:
            'Space Chain recall はノードスキャンと認証解決を並列化し、グローバル rerank の動作を保ったまま高速化しました。Console では recall の所要時間も表示され、テストクエリの速度を確認できます。',
          sections: [
            {
              title: '変更点',
              body: 'recall 処理はバックグラウンドで並列化され、グローバル rerank の動作は維持されます。',
            },
            {
              title: '確認方法',
              items: [
                'Space Chain 詳細ページを開き、Recall test パネルを使います。',
                'チェーン横断の recall をテストしたい場合は Force scanAll を有効にします。',
                '結果に表示される経過時間を見てクエリ性能を比較できます。',
              ],
            },
          ],
        },
        {
          date: '2026年5月25日',
          title: 'Session memory 管理と一括クリーンアップ',
          summary:
            'memory workbench で session memory 行を一覧表示し、All、Insight、Pinned、Session でフィルターし、行選択、ページサイズ変更、選択した memories の一括削除ができるようになりました。API でも session 行の削除と、抽出事実だけが必要な場合に raw session を保存しないリクエスト単位のスイッチをサポートします。',
          sections: [
            {
              title: 'Console での整理',
              items: [
                'Space memory workbench を開き、memory type フィルターを選択します。',
                '1 行または複数行を選び、ツールバーから選択した memories を削除します。',
              ],
            },
            {
              title: 'API オプション',
              body: 'API ingest フローでは、raw session message を保存せず事実抽出だけを行いたい場合に `disableSessionSave` を設定します。',
            },
          ],
        },
        {
          date: '2026年5月26日',
          title: 'Console が 7 言語に対応',
          summary:
            'Console は英語、簡体字中国語、繁体字中国語、日本語、韓国語、インドネシア語、タイ語に対応しました。shell、認証ページ、Spaces、Memories、Settings、Project、Space Chain フローをカバーします。',
          sections: [
            {
              title: '言語切り替え',
              items: [
                'Console ヘッダーまたは認証ページで言語メニューを開きます。',
                '言語を選択します。選択はローカルに保存され、ドキュメント言語も更新されます。',
              ],
            },
          ],
        },
        {
          date: '2026年5月19日',
          title: '課金と利用状況ダッシュボード',
          summary:
            '組織は課金プラン状態、権限、リクエスト利用状況のサマリー、日次 rollup、詳細な利用イベントを確認できます。runtime にはクォータゲートと永続 metering が入り、セルフホスト挙動を変えずに商用利用を追跡できます。',
          sections: [
            {
              title: '確認場所',
              items: [
                'Console を開き、組織を選択します。',
                'Billing でプランと権限状態を確認します。',
                'Usage で日付範囲を選び、memory recall と memory write のリクエスト合計を確認します。',
              ],
            },
          ],
        },
        {
          date: '2026年5月19日',
          title: 'Space memory explorer と runtime ツール',
          summary:
            'Spaces に memory workbench が追加され、サマリーメトリクス、imports、memory 一覧/詳細、作成/編集/削除、共有 Recall test パネルを利用できます。生の API key はサーバー側に保持され、Console が認可済み memory 操作をプロキシします。',
          sections: [
            {
              title: 'ワークベンチ機能',
              items: [
                'Console で Space 詳細ページを開きます。',
                'Memories tab で memories を閲覧、作成、編集、削除します。',
                'Recall test パネルで、その Space がクエリに対して何を取得するかをテストします。',
              ],
            },
          ],
        },
        {
          date: '2026年5月15日',
          title: 'Space Chain runtime 対応',
          summary:
            'Space Chains は runtime で利用可能になり、順序付き recall と書き込み、chain key 認証、チェーンレスポンス内の provenance をサポートします。1 つの chain key で複数 Space から制御された順序で recall できます。',
          sections: [
            {
              title: 'runtime 設定',
              items: [
                'Console で Space Chain を作成または開きます。',
                'recall に検索させたい順序で Space ノードを追加します。',
                'chain key binding を作成し、チェーン横断 recall が必要な場合はその key と `scanAll=true` を使います。',
              ],
            },
          ],
        },
        {
          date: '2026年5月14日',
          title: 'より安全な Space API key 管理と組織ロール',
          summary:
            'Space API keys は暗号化されたカタログに保存され、安定したマスク表示、明示的な reveal フロー、active binding チェックを備えます。組織ロールは owner、admin、member の権限を区別します。',
          sections: [
            {
              title: '権限',
              items: [
                'Owner と admin は Space key 管理フローで key の作成、紐づけ、reveal ができます。',
                'Member は許可されたリソースの読み取りを続けられますが、変更権限はありません。',
                '通常画面ではマスク済み key を使い、クライアントにコピーする必要がある場合だけ reveal します。',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyKo = attachReleaseNoteSources({
  meta: {
    title: '릴리스 노트 | mem9',
    description: 'Console, API, Space Chain, 결제, 메모리 관리의 새로운 기능을 다루는 mem9 고객용 릴리스 노트입니다.',
  },
  kicker: '릴리스 노트',
  title: 'mem9의 최신 업데이트',
  intro: 'mem9 작성자들이 최근 출시한 주요 업데이트입니다.',
  heroImageAlt: '메모리 칩과 금색 데이터 스트림을 보여 주는 mem9 릴리스 노트 일러스트',
  starPrompt: '오픈소스 프로젝트를 지속하는 일은 쉽지 않습니다. GitHub에서 mem9에 Star를 눌러 응원해 주세요.',
  starBadgeAlt: 'mem9-ai/mem9 GitHub Stars',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: '마지막 업데이트',
  updatedValue: '2026년 6월 4일',
  sourcesLabel: 'PR 출처',
  sourcesFeedback: 'PR 또는 issue에 들어가 피드백을 남겨 주세요.',
  groups: [
    {
      period: '2026년 6월',
      items: [
        {
          date: '2026년 6월 4일',
          title: 'mem9.ai 공식 서비스의 주요 성능 업데이트',
          summary:
            'mem9.ai 공식 서비스에 중요한 성능 개선을 적용하고 있습니다. 초기 배포 구성 때문에 일부 서비스와 데이터베이스가 서로 다른 리전에 있어 API 요청에 불필요한 지연이 있었습니다. 데이터를 두 단계로 이전해 공식 호스팅 서비스의 API 지연 시간을 크게 낮춥니다.',
          sections: [
            {
              title: '출시 일정',
              items: [
                '1단계는 베이징 시간 6월 4일 정오에 배포되었고, 일반적인 API 지연 시간이 평균 약 4-6초에서 약 1.3초로 줄었습니다.',
                '2단계는 이번 주 안에 메타데이터 이전을 완료할 예정이며, 평균 지연 시간을 수백 밀리초 이내로 낮추는 것이 목표입니다.',
              ],
            },
            {
              title: '피드백',
              body: '클라이언트 측 변경은 필요하지 않습니다. 이 업데이트는 mem9.ai 공식 서비스 경로를 직접 개선하며, 공식 서비스 성능에 대한 피드백을 환영합니다.',
            },
          ],
        },
        {
          date: '2026년 6월 4일',
          title: '하나의 API key 안에서 appId 격리',
          summary:
            '하나의 mem9 API key가 `appId`로 여러 개의 격리된 애플리케이션 메모리 공간을 담을 수 있습니다. appId와 함께 기록된 memory와 raw session은 해당 앱에 연결되므로, 서로 다른 제품, Agent, 환경, 워크플로를 같은 key로 사용하면서 일상 메모리가 섞이지 않게 할 수 있습니다.',
          sections: [
            {
              title: 'appId가 메모리를 나누는 방식',
              items: [
                'memory를 쓰거나 ingest messages를 보낼 때 `appId`를 함께 보냅니다. 예: `appId: "docs"` 또는 `appId: "support-bot"`.',
                '검색할 때 `appId`를 생략하면 해당 key 아래의 모든 appId를 검색합니다. 비어 있지 않은 appId를 전달하면 한 하위 공간만 검색하고, `appId=null` 또는 `appId=`는 기본/global 메모리만 검색합니다.',
                'Console에서는 appId 필터, appId 열, memory 생성 시 appId 필드를 사용해 특정 애플리케이션의 메모리를 확인하거나 쓸 수 있습니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 6월 4일',
          title: 'API 문서 개편 및 문서 안에서 API 테스트',
          summary:
            'mem9 API 레퍼런스가 더 명확한 레이아웃, 업데이트된 endpoint 설명, 내장 API 테스트 콘솔로 개편되었습니다. 개발자는 문서와 별도 도구를 오가지 않고 같은 페이지에서 문서를 읽고 요청을 시험할 수 있습니다.',
          sections: [
            {
              title: '변경 내용',
              items: [
                'API 페이지의 사이드바와 endpoint 레이아웃이 더 명확해졌습니다.',
                '인증, appId 격리, memory API, imports, session messages, Space Chain API 문서가 업데이트되었습니다.',
              ],
            },
            {
              title: '테스트 위치',
              body: '사이트 내비게이션에서 API 페이지를 열고 API test 패널에서 base URL, API key, headers, path/query/body 필드를 설정한 뒤 요청을 실행하고 응답을 바로 확인할 수 있습니다.',
            },
          ],
        },
        {
          date: '2026년 6월 3일',
          title: '기존 mem9 API key를 Console로 가져오기',
          summary:
            'Agent 설치나 API 흐름에서 이미 mem9 API key를 받은 사용자는 이제 그 key를 Console의 Space에 연결할 수 있습니다. Console은 원본 key를 보호하고 마스킹된 정보만 보여 주며, claim된 key를 조직 quota 모델로 이동합니다.',
          sections: [
            {
              title: 'Claim 흐름',
              items: [
                '설치 흐름의 claim 링크로 Console에 들어가거나 `/console/claim`을 직접 엽니다.',
                '기존 key를 붙여넣고 조직과 프로젝트를 선택한 뒤 빈 Space에 연결하거나 흐름 안에서 새 Space를 만듭니다.',
                '연결 후에는 원본 key를 일반 화면에 노출하지 않고 Console에서 Space를 관리할 수 있습니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 6월 3일',
          title: '내장 결제, 결제 수단, 인보이스',
          summary:
            'Console의 Billing 영역에 Stripe 기반 결제 경험이 더 완성도 있게 들어갔습니다. 현재 플랜, 청구 주소, 결제 수단, 플랜 변경, 쿠폰, 구독 취소/재개, 인보이스 기록을 다룰 수 있습니다.',
          sections: [
            {
              title: '관리 위치',
              items: [
                'Console을 열고 조직을 선택한 다음 Billing으로 이동합니다.',
                'Upgrade 또는 Change plan에서 청구 정보를 입력하고 플랜을 선택한 뒤 Stripe Elements로 결제를 확인합니다.',
                '같은 Billing 페이지에서 저장된 결제 수단과 인보이스를 확인합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 6월 1일',
          title: 'Space Chain 지식 라우팅',
          summary:
            'Space Chain은 이제 라우팅 정책 필드에 따라 추출된 지식을 올바른 Space Chain 노드에 쓸 수 있습니다. 넓은 범위의 입력을 적절한 팀, 프로젝트, 주제 Space에 저장하면서도 체인 전체 recall은 유지됩니다.',
          sections: [
            {
              title: '라우팅 설정',
              items: [
                'Space Chain 상세 페이지를 열고 knowledge extraction policy를 설정합니다.',
                '노드 선택기와 라우팅 다이어그램을 사용해 추출된 사실을 어디에 쓸지 결정합니다.',
                'memory를 만들 때 smart ingest를 켜면 하나의 raw memory만 쓰는 대신 사실을 추출하고 라우팅합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 6월 1일',
          title: '서버 측 메모리 정렬과 검색 컨트롤',
          summary:
            'Memory 테이블은 이제 현재 페이지만이 아니라 서버의 전체 결과 집합에 대해 정렬과 필터를 적용합니다. 사용자는 내용, 유형, 태그, 업데이트 시간으로 정렬하고 검색 조건과 함께 사용할 수 있습니다.',
          sections: [
            {
              title: '테이블 컨트롤',
              items: [
                'Space 또는 Space Chain memory workbench를 엽니다.',
                '테이블 헤더를 클릭해 오름차순 또는 내림차순으로 정렬합니다.',
                '내용, 유형, 태그 검색 필드를 사용하면 서버가 페이지네이션 전에 필터와 정렬을 적용합니다.',
              ],
            },
          ],
        },
      ],
    },
    {
      period: '2026년 5월',
      items: [
        {
          date: '2026년 5월 30일',
          title: '시간 표시가 포함된 더 빠른 Space Chain recall',
          summary:
            'Space Chain recall은 노드 스캔과 인증 해석을 병렬화하면서 글로벌 rerank 동작을 유지합니다. Console은 recall 소요 시간도 보여 주므로 팀이 테스트 쿼리 속도를 확인할 수 있습니다.',
          sections: [
            {
              title: '변경 내용',
              body: 'recall 작업은 백그라운드에서 병렬화되며 글로벌 rerank 동작은 그대로 유지됩니다.',
            },
            {
              title: '검증 방법',
              items: [
                'Space Chain 상세 페이지를 열고 Recall test 패널을 사용합니다.',
                '체인 전체 recall 동작을 테스트하려면 Force scanAll을 켭니다.',
                '결과에 표시되는 경과 시간을 확인해 쿼리 성능을 비교합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 5월 25일',
          title: 'Session memory 관리와 일괄 정리',
          summary:
            'memory workbench에서 session memory 행을 나열하고 All, Insight, Pinned, Session으로 필터링하며, 행 선택, 페이지 크기 변경, 선택한 memories 일괄 삭제를 할 수 있습니다. API도 session 행 삭제와, 추출된 사실만 필요할 때 raw session 행을 저장하지 않는 요청 단위 스위치를 지원합니다.',
          sections: [
            {
              title: 'Console 정리',
              items: [
                'Space memory workbench를 열고 memory type 필터를 선택합니다.',
                '하나 이상의 행을 선택한 다음 툴바에서 선택한 memories를 삭제합니다.',
              ],
            },
            {
              title: 'API 옵션',
              body: 'API ingest 흐름에서는 원본 session messages를 보존하지 않고 사실 추출만 원할 때 `disableSessionSave`를 설정합니다.',
            },
          ],
        },
        {
          date: '2026년 5월 26일',
          title: 'Console의 7개 언어 지원',
          summary:
            'Console은 영어, 중국어 간체, 중국어 번체, 일본어, 한국어, 인도네시아어, 태국어를 지원합니다. shell, 인증 페이지, Spaces, Memories, Settings, Project, Space Chain 흐름을 포함합니다.',
          sections: [
            {
              title: '언어 전환',
              items: [
                'Console 헤더 또는 인증 페이지에서 언어 메뉴를 엽니다.',
                '언어를 선택합니다. 선택은 로컬에 저장되고 문서 언어도 업데이트됩니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 5월 19일',
          title: '결제와 사용량 대시보드',
          summary:
            '조직은 결제 플랜 상태, 권한, 요청 사용량 요약, 일별 rollup, 상세 사용 이벤트를 확인할 수 있습니다. runtime에는 quota gate와 지속 metering이 추가되어 self-hosted 동작을 바꾸지 않고 상업적 사용량을 추적할 수 있습니다.',
          sections: [
            {
              title: '확인 위치',
              items: [
                'Console을 열고 조직을 선택합니다.',
                'Billing에서 플랜과 entitlement 상태를 확인합니다.',
                'Usage에서 선택한 날짜 범위의 memory recall 및 memory write 요청 합계를 확인합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 5월 19일',
          title: 'Space memory explorer와 runtime 도구',
          summary:
            'Spaces에는 summary metrics, imports, memory 목록/상세 조회, 생성/수정/삭제, 공유 Recall test 패널을 갖춘 memory workbench가 생겼습니다. 원본 API key는 서버 측에 유지되고 Console이 승인된 memory 작업을 프록시합니다.',
          sections: [
            {
              title: '워크벤치 기능',
              items: [
                'Console에서 Space 상세 페이지를 엽니다.',
                'Memories tab에서 memories를 탐색, 생성, 수정, 삭제합니다.',
                'Recall test 패널로 해당 Space가 쿼리에 대해 무엇을 검색하는지 테스트합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 5월 15일',
          title: 'Space Chain runtime 지원',
          summary:
            'Space Chains는 이제 runtime에서 사용할 수 있으며, 순서 있는 recall과 write, chain key 인증, chain 응답의 provenance를 지원합니다. 하나의 chain key로 여러 Space에서 제어된 순서로 recall할 수 있습니다.',
          sections: [
            {
              title: 'runtime 설정',
              items: [
                'Console에서 Space Chain을 만들거나 엽니다.',
                'recall이 검색할 순서대로 Space 노드를 추가합니다.',
                'chain key binding을 만들고 체인 전체 recall이 필요하면 해당 key와 `scanAll=true`를 사용합니다.',
              ],
            },
          ],
        },
        {
          date: '2026년 5월 14일',
          title: '더 안전한 Space API key 관리와 조직 역할',
          summary:
            'Space API keys는 암호화된 카탈로그에 저장되며 안정적인 마스킹 표시, 명시적인 reveal 흐름, active binding 검사를 제공합니다. 조직 역할은 owner, admin, member 권한을 구분합니다.',
          sections: [
            {
              title: '권한',
              items: [
                'Owner와 admin은 Space key 관리 흐름에서 key를 만들고 연결하고 reveal할 수 있습니다.',
                'Member는 허용된 리소스를 계속 읽을 수 있지만 변경 권한은 없습니다.',
                '일반 화면에서는 마스킹된 key를 사용하고, 클라이언트에 복사해야 할 때만 reveal합니다.',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyId = attachReleaseNoteSources({
  meta: {
    title: 'Catatan Rilis | mem9',
    description: 'Catatan rilis mem9 untuk pelanggan, mencakup Console, API, Space Chain, billing, dan manajemen memori.',
  },
  kicker: 'Catatan Rilis',
  title: 'Apa yang baru di mem9',
  intro: 'Pembaruan penting terbaru dari para pembuat mem9.',
  heroImageAlt: 'Ilustrasi catatan rilis mem9 dengan chip memori dan aliran data emas',
  starPrompt: 'Proyek open-source tidak mudah dijalankan. Dukung kami dengan memberi Star untuk mem9 di GitHub.',
  starBadgeAlt: 'GitHub stars untuk mem9-ai/mem9',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: 'Terakhir diperbarui',
  updatedValue: '4 Juni 2026',
  sourcesLabel: 'Sumber PR',
  sourcesFeedback: 'Silakan buka PR atau issue dan kirimkan masukan Anda.',
  groups: [
    {
      period: 'Juni 2026',
      items: [
        {
          date: '4 Juni 2026',
          title: 'Pembaruan performa besar untuk mem9.ai',
          summary:
            'Layanan resmi mem9.ai sedang menerima pembaruan performa penting. Karena pilihan deployment awal, sebagian layanan dan database berjalan lintas region sehingga menambah latency yang tidak perlu. Kami memigrasikan data dalam dua fase untuk menurunkan latency API layanan hosted secara signifikan.',
          sections: [
            {
              title: 'Rilis bertahap',
              items: [
                'Fase 1 dirilis pada siang hari waktu Beijing tanggal 4 Juni dan menurunkan latency API umum dari rata-rata sekitar 4-6 detik menjadi sekitar 1,3 detik.',
                'Fase 2 ditargetkan selesai minggu ini untuk memigrasikan metadata, dengan target menurunkan latency rata-rata ke kisaran beberapa ratus milidetik.',
              ],
            },
            {
              title: 'Masukan',
              body: 'Tidak ada perubahan sisi klien yang diperlukan. Pembaruan ini langsung memperbaiki jalur layanan hosted mem9.ai, dan masukan tentang performa layanan resmi sangat kami harapkan.',
            },
          ],
        },
        {
          date: '4 Juni 2026',
          title: 'Isolasi appId dalam satu API key',
          summary:
            'Satu mem9 API key sekarang dapat memuat beberapa ruang memori aplikasi yang terisolasi dengan `appId`. Memory dan raw session yang ditulis dengan appId akan tetap terhubung ke aplikasi tersebut, sehingga produk, Agent, environment, atau workflow berbeda dapat berbagi key yang sama tanpa mencampur memori harian.',
          sections: [
            {
              title: 'Cara appId memisahkan memori',
              items: [
                'Saat menulis memory atau ingest messages, kirim `appId`, misalnya `appId: "docs"` atau `appId: "support-bot"`.',
                'Saat mencari, kosongkan `appId` untuk mencari semua appId di bawah key tersebut, kirim appId non-kosong untuk mencari satu sub-ruang, atau kirim `appId=null` / `appId=` untuk mencari hanya memori default/global.',
                'Di Console, gunakan filter appId, kolom appId, dan field appId saat membuat memory untuk melihat atau menulis memori milik aplikasi tertentu.',
              ],
            },
          ],
        },
        {
          date: '4 Juni 2026',
          title: 'Penyegaran API reference dengan uji API langsung',
          summary:
            'API reference mem9 diperbarui dengan layout yang lebih jelas, konten endpoint yang diperbarui, dan konsol uji API bawaan. Developer kini dapat membaca dokumentasi dan mencoba request di halaman yang sama tanpa berpindah ke tooling terpisah.',
          sections: [
            {
              title: 'Yang berubah',
              items: [
                'Halaman API kini memiliki sidebar dan layout endpoint yang lebih jelas.',
                'Konten dokumentasi diperbarui untuk authentication, appId isolation, memory APIs, imports, session messages, dan Space Chain APIs.',
              ],
            },
            {
              title: 'Tempat mencoba',
              body: 'Buka halaman API dari navigasi situs, lalu gunakan panel API test untuk mengatur base URL, API key, headers, field path/query/body, menjalankan request, dan melihat response langsung di halaman dokumentasi.',
            },
          ],
        },
        {
          date: '3 Juni 2026',
          title: 'Impor mem9 API key yang sudah ada ke Console',
          summary:
            'Pengguna yang sudah menerima mem9 API key dari setup Agent atau flow API kini dapat mengaitkan key tersebut ke Space di Console. Console melindungi key mentah, hanya menampilkan detail yang disamarkan, dan memindahkan key yang sudah diklaim ke model quota organisasi.',
          sections: [
            {
              title: 'Flow klaim',
              items: [
                'Buka flow klaim Console dari link setup, atau langsung buka `/console/claim`.',
                'Tempel key yang sudah ada, pilih organisasi dan proyek, lalu kaitkan ke Space kosong atau buat Space baru di dalam flow.',
                'Setelah dikaitkan, kelola Space dari Console tanpa menampilkan key mentah di tampilan biasa.',
              ],
            },
          ],
        },
        {
          date: '3 Juni 2026',
          title: 'Billing, metode pembayaran, dan invoice tertanam',
          summary:
            'Area Billing di Console kini memiliki pengalaman billing berbasis Stripe yang lebih lengkap: plan saat ini, alamat billing, metode pembayaran, kontrol perubahan plan, kupon, aksi cancel/resume, dan riwayat invoice.',
          sections: [
            {
              title: 'Tempat mengelola',
              items: [
                'Buka Console, pilih organisasi, lalu masuk ke Billing.',
                'Gunakan Upgrade atau Change plan untuk memasukkan detail billing, memilih plan, dan mengonfirmasi pembayaran dengan Stripe Elements.',
                'Tinjau metode pembayaran tersimpan dan invoice dari halaman Billing yang sama.',
              ],
            },
          ],
        },
        {
          date: '1 Juni 2026',
          title: 'Routing knowledge di Space Chain',
          summary:
            'Space Chain kini dapat merutekan knowledge yang diekstrak ke node Space Chain yang tepat berdasarkan field routing policy. Chain bisa bertindak lebih seperti knowledgebase: ingest yang luas masuk ke Space tim, proyek, atau topik yang benar, sementara recall tetap bisa berjalan lintas chain.',
          sections: [
            {
              title: 'Pengaturan routing',
              items: [
                'Buka halaman detail Space Chain dan konfigurasi knowledge extraction policy.',
                'Gunakan node selector dan diagram routing untuk menentukan lokasi penulisan fakta yang diekstrak.',
                'Saat membuat memory, aktifkan smart ingest agar sistem mengekstrak dan merutekan fakta, bukan hanya menulis satu item raw memory.',
              ],
            },
          ],
        },
        {
          date: '1 Juni 2026',
          title: 'Sorting memori sisi server dan kontrol pencarian',
          summary:
            'Tabel Memory sekarang melakukan sort dan filter terhadap seluruh hasil di server, bukan hanya halaman saat ini. Pengguna dapat sort berdasarkan content, type, tags, dan updated time sambil menggabungkannya dengan kontrol pencarian.',
          sections: [
            {
              title: 'Kontrol tabel',
              items: [
                'Buka memory workbench untuk Space atau Space Chain.',
                'Klik header tabel untuk mengurutkan naik atau turun.',
                'Gunakan field pencarian untuk content, type, dan tags; server menerapkan filter dan sort sebelum pagination.',
              ],
            },
          ],
        },
      ],
    },
    {
      period: 'Mei 2026',
      items: [
        {
          date: '30 Mei 2026',
          title: 'Recall Space Chain lebih cepat dengan visibilitas waktu',
          summary:
            'Recall Space Chain kini memparalelkan pemindaian node dan penyelesaian auth, sambil mempertahankan perilaku reranking global. Console juga menampilkan timing recall agar tim dapat melihat durasi test recall.',
          sections: [
            {
              title: 'Yang berubah',
              body: 'Pekerjaan recall diparalelkan di belakang layar, sementara perilaku reranking global tetap sama.',
            },
            {
              title: 'Cara memvalidasi',
              items: [
                'Buka halaman detail Space Chain dan gunakan panel Recall test.',
                'Aktifkan Force scanAll jika ingin menguji perilaku recall lintas chain.',
                'Periksa waktu yang ditampilkan bersama hasil untuk membandingkan performa query.',
              ],
            },
          ],
        },
        {
          date: '25 Mei 2026',
          title: 'Manajemen session memory dan pembersihan batch',
          summary:
            'Memory workbench kini dapat menampilkan row session memory, memfilter All, Insight, Pinned, atau Session, memilih row, mengubah page size, dan menghapus memories terpilih secara batch. API juga mendukung penghapusan session row dan switch per request untuk tidak menyimpan raw session saat hanya fakta hasil ekstraksi yang dibutuhkan.',
          sections: [
            {
              title: 'Pembersihan di Console',
              items: [
                'Buka Space memory workbench dan pilih filter memory type.',
                'Pilih satu atau beberapa row, lalu hapus memories terpilih dari toolbar.',
              ],
            },
            {
              title: 'Opsi API',
              body: 'Untuk flow API ingest, set `disableSessionSave` saat Anda ingin ekstraksi fakta tanpa menyimpan raw session messages.',
            },
          ],
        },
        {
          date: '26 Mei 2026',
          title: 'Console mendukung tujuh bahasa',
          summary:
            'Console kini mendukung bahasa Inggris, Chinese Simplified, Chinese Traditional, Jepang, Korea, Indonesia, dan Thai di shell, halaman auth, Spaces, Memories, Settings, Project, dan flow Space Chain.',
          sections: [
            {
              title: 'Pengalih bahasa',
              items: [
                'Buka menu bahasa di header Console atau halaman auth.',
                'Pilih bahasa; pilihan disimpan secara lokal dan memperbarui bahasa dokumen.',
              ],
            },
          ],
        },
        {
          date: '19 Mei 2026',
          title: 'Dashboard billing dan usage',
          summary:
            'Organisasi dapat meninjau status plan billing, entitlements, ringkasan usage request, daily rollups, dan event usage terperinci. Runtime kini memiliki quota gate dan metering durable sehingga usage komersial dapat dilacak tanpa mengubah perilaku self-hosted.',
          sections: [
            {
              title: 'Tempat melihat',
              items: [
                'Buka Console dan pilih organisasi.',
                'Masuk ke Billing untuk meninjau status plan dan entitlement.',
                'Masuk ke Usage untuk memeriksa total request memory recall dan memory write pada rentang tanggal yang dipilih.',
              ],
            },
          ],
        },
        {
          date: '19 Mei 2026',
          title: 'Space memory explorer dan runtime tools',
          summary:
            'Spaces kini memiliki memory workbench dengan summary metrics, imports, daftar/detail memory, kontrol create/edit/delete, dan panel Recall test bersama. Raw API key tetap berada di server sementara Console mem-proxy operasi memory yang sudah diotorisasi.',
          sections: [
            {
              title: 'Alat workbench',
              items: [
                'Buka halaman detail Space di Console.',
                'Gunakan tab Memories untuk menelusuri, membuat, mengedit, atau menghapus memories.',
                'Gunakan panel Recall test untuk menguji apa yang akan diambil Space untuk sebuah query.',
              ],
            },
          ],
        },
        {
          date: '15 Mei 2026',
          title: 'Dukungan runtime Space Chain',
          summary:
            'Space Chains kini tersedia di runtime, dengan perilaku recall dan write berurutan, autentikasi chain key, dan provenance di response chain. Satu chain key dapat mengambil dari beberapa Space dalam urutan yang terkendali.',
          sections: [
            {
              title: 'Pengaturan runtime',
              items: [
                'Buat atau buka Space Chain di Console.',
                'Tambahkan node Space dalam urutan yang Anda inginkan untuk pencarian recall.',
                'Buat chain key binding, lalu gunakan key tersebut dengan `scanAll=true` saat Anda ingin recall lintas chain.',
              ],
            },
          ],
        },
        {
          date: '14 Mei 2026',
          title: 'Manajemen Space API key dan role organisasi yang lebih aman',
          summary:
            'Space API keys disimpan dalam katalog terenkripsi dengan nilai tampilan yang stabil dan tersamarkan, workflow reveal eksplisit, dan active binding checks. Role organisasi kini membedakan permission owner, admin, dan member untuk manajemen resource dan key.',
          sections: [
            {
              title: 'Izin',
              items: [
                'Owner dan admin dapat membuat, bind, dan reveal Space keys dari flow manajemen Space key.',
                'Member dapat tetap membaca resource yang diizinkan tanpa menerima permission mutasi.',
                'Gunakan nilai key yang disamarkan di tampilan biasa; reveal key hanya saat perlu menyalinnya ke client.',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyTh = attachReleaseNoteSources({
  meta: {
    title: 'บันทึกการเผยแพร่ | mem9',
    description: 'บันทึกการเผยแพร่ของ mem9 สำหรับลูกค้า ครอบคลุม Console, API, Space Chain, billing และการจัดการ memory',
  },
  kicker: 'บันทึกการเผยแพร่',
  title: 'มีอะไรใหม่ใน mem9',
  intro: 'อัปเดตสำคัญล่าสุดจากผู้สร้าง mem9',
  heroImageAlt: 'ภาพประกอบบันทึกการเผยแพร่ mem9 พร้อมชิปหน่วยความจำและสตรีมข้อมูลสีทอง',
  starPrompt: 'การทำโปรเจกต์ open-source ไม่ง่าย โปรดช่วยสนับสนุนเราด้วยการกด Star ให้ mem9 บน GitHub',
  starBadgeAlt: 'GitHub stars สำหรับ mem9-ai/mem9',
  starBadgeSrc: 'https://img.shields.io/github/stars/mem9-ai/mem9?style=social',
  starHref: 'https://github.com/mem9-ai/mem9',
  updatedLabel: 'อัปเดตล่าสุด',
  updatedValue: '4 มิถุนายน 2026',
  sourcesLabel: 'แหล่งที่มา PR',
  sourcesFeedback: 'ยินดีให้คุณเข้าไปที่ PR หรือ issue แล้วส่งความคิดเห็นมาให้เรา',
  groups: [
    {
      period: 'มิถุนายน 2026',
      items: [
        {
          date: '4 มิถุนายน 2026',
          title: 'การอัปเดตประสิทธิภาพครั้งสำคัญสำหรับ mem9.ai',
          summary:
            'บริการทางการของ mem9.ai กำลังได้รับการปรับปรุงประสิทธิภาพครั้งสำคัญ เนื่องจากการ deploy ช่วงแรกทำให้บางส่วนของ service และ database อยู่คนละ region จึงเกิด latency ที่ไม่จำเป็น เรากำลังย้ายข้อมูลเป็น 2 เฟสเพื่อลด API latency ของ hosted service อย่างชัดเจน',
          sections: [
            {
              title: 'แผนการเผยแพร่',
              items: [
                'เฟส 1 เผยแพร่ตอนเที่ยงตามเวลา Beijing วันที่ 4 มิถุนายน และลด API latency ทั่วไปจากเฉลี่ยประมาณ 4-6 วินาที เหลือประมาณ 1.3 วินาที',
                'เฟส 2 คาดว่าจะเสร็จภายในสัปดาห์นี้ โดยจะย้าย metadata และมีเป้าหมายให้ latency เฉลี่ยลดลงมาอยู่ในระดับไม่กี่ร้อยมิลลิวินาที',
              ],
            },
            {
              title: 'ข้อเสนอแนะ',
              body: 'ไม่ต้องแก้ไขฝั่ง client การอัปเดตนี้ปรับปรุงเส้นทางของ hosted mem9.ai service โดยตรง เรายินดีรับความคิดเห็นเกี่ยวกับประสิทธิภาพของบริการทางการ',
            },
          ],
        },
        {
          date: '4 มิถุนายน 2026',
          title: 'แยก appId ภายใต้ API key เดียว',
          summary:
            'ตอนนี้ mem9 API key เดียวสามารถมีพื้นที่ memory ของหลายแอปที่แยกกันด้วย `appId` ได้ Memory และ raw session ที่เขียนพร้อม appId จะผูกกับแอปนั้น จึงเหมาะกับการใช้ key เดียวกับหลาย product, Agent, environment หรือ workflow โดยไม่ให้ memory ประจำวันปะปนกัน',
          sections: [
            {
              title: 'appId แยก memory อย่างไร',
              items: [
                'เมื่อเขียน memory หรือ ingest messages ให้ส่ง `appId` เช่น `appId: "docs"` หรือ `appId: "support-bot"`',
                'ตอน search ถ้าไม่ส่ง `appId` จะค้นหาข้ามทุก appId ภายใต้ key นั้น ถ้าส่ง appId ที่ไม่ว่างจะค้นหาเฉพาะ sub-space นั้น และถ้าส่ง `appId=null` หรือ `appId=` จะค้นหาเฉพาะ default/global memory',
                'ใน Console ใช้ appId filter, appId column และ field appId ตอนสร้าง memory เพื่อดูหรือเขียน memory สำหรับแอปเฉพาะ',
              ],
            },
          ],
        },
        {
          date: '4 มิถุนายน 2026',
          title: 'เอกสารอ้างอิง API ใหม่พร้อมทดสอบ API ในหน้าเอกสาร',
          summary:
            'mem9 API reference ได้รับการปรับปรุง layout ให้ชัดเจนขึ้น อัปเดตเนื้อหา endpoint และเพิ่ม API test console ในตัว Developer จึงอ่านเอกสารและลอง request ได้ในหน้าเดียว ไม่ต้องสลับไปใช้เครื่องมือแยกต่างหาก',
          sections: [
            {
              title: 'สิ่งที่เปลี่ยน',
              items: [
                'หน้า API มี sidebar และ layout endpoint ที่ชัดเจนขึ้น',
                'อัปเดตเนื้อหาสำหรับ authentication, appId isolation, memory APIs, imports, session messages และ Space Chain APIs',
              ],
            },
            {
              title: 'ลองได้ที่ไหน',
              body: 'เปิดหน้า API จาก navigation ของ site แล้วใช้ API test panel ตั้งค่า base URL, API key, headers, field path/query/body, run request และดู response ได้ในหน้าเอกสารโดยตรง',
            },
          ],
        },
        {
          date: '3 มิถุนายน 2026',
          title: 'นำ mem9 API key ที่มีอยู่เข้า Console',
          summary:
            'ผู้ใช้ที่ได้รับ mem9 API key จากการติดตั้ง Agent หรือ flow API แล้ว ตอนนี้สามารถผูก key นั้นกับ Space ใน Console ได้ Console จะปกป้อง raw key แสดงเฉพาะข้อมูลที่ mask แล้ว และย้าย claimed key เข้า model quota ขององค์กร',
          sections: [
            {
              title: 'ขั้นตอนการรับสิทธิ์',
              items: [
                'เปิด Console claim flow จากลิงก์ใน setup หรือเปิด `/console/claim` โดยตรง',
                'วาง key ที่มีอยู่ เลือก organization และ project แล้วผูกกับ Space ว่าง หรือสร้าง Space ใหม่ใน flow',
                'หลัง bind แล้วสามารถจัดการ Space จาก Console ได้โดยไม่เปิดเผย raw key ในหน้าทั่วไป',
              ],
            },
          ],
        },
        {
          date: '3 มิถุนายน 2026',
          title: 'Billing, payment methods และ invoices ในตัว',
          summary:
            'พื้นที่ Billing ใน Console มีประสบการณ์ billing ที่ครบขึ้นบน Stripe: plan ปัจจุบัน billing address, payment methods, การเปลี่ยน plan, coupons, cancel/resume และประวัติ invoice',
          sections: [
            {
              title: 'จัดการที่ไหน',
              items: [
                'เปิด Console เลือก organization แล้วไปที่ Billing',
                'ใช้ Upgrade หรือ Change plan เพื่อกรอก billing details เลือก plan และยืนยัน payment ด้วย Stripe Elements',
                'ตรวจ payment methods ที่บันทึกไว้และ invoices ได้จากหน้า Billing เดียวกัน',
              ],
            },
          ],
        },
        {
          date: '1 มิถุนายน 2026',
          title: 'Knowledge routing ใน Space Chain',
          summary:
            'Space Chain สามารถ route knowledge ที่ extract แล้วไปยัง node ที่ถูกต้องตาม routing policy fields ได้ ทำให้ chain ทำงานเหมือน knowledgebase มากขึ้น: ingest กว้าง ๆ จะลง Space ของทีม โปรเจกต์ หรือหัวข้อที่เหมาะสม ขณะที่ recall ยังค้นข้าม chain ได้',
          sections: [
            {
              title: 'ตั้งค่า routing',
              items: [
                'เปิดหน้า detail ของ Space Chain แล้วตั้งค่า knowledge extraction policy',
                'ใช้ node selector และ routing diagram เพื่อกำหนดว่าข้อเท็จจริงที่ extract แล้วควรถูกเขียนไปที่ไหน',
                'ตอนสร้าง memory ให้เปิด smart ingest เพื่อ extract และ route facts แทนการเขียน raw memory item เพียงรายการเดียว',
              ],
            },
          ],
        },
        {
          date: '1 มิถุนายน 2026',
          title: 'การจัดเรียง memory และ search controls ฝั่ง server',
          summary:
            'ตาราง Memory ตอนนี้ sort และ filter กับ result set ทั้งหมดบน server ไม่ใช่แค่หน้าปัจจุบัน ผู้ใช้สามารถ sort ตาม content, type, tags และ updated time พร้อมใช้ร่วมกับ search controls ได้',
          sections: [
            {
              title: 'ตัวควบคุมตาราง',
              items: [
                'เปิด memory workbench ของ Space หรือ Space Chain',
                'คลิก header ของตารางเพื่อ sort ascending หรือ descending',
                'ใช้ search fields สำหรับ content, type และ tags โดย server จะ filter และ sort ก่อน pagination',
              ],
            },
          ],
        },
      ],
    },
    {
      period: 'พฤษภาคม 2026',
      items: [
        {
          date: '30 พฤษภาคม 2026',
          title: 'Space Chain recall เร็วขึ้นพร้อมการแสดงเวลา',
          summary:
            'Space Chain recall ตอนนี้ parallelize การ scan node และ auth resolution พร้อมคง global reranking behavior ไว้ Console ยังแสดง recall timing เพื่อให้ทีมเห็นว่า test recall ใช้เวลานานแค่ไหน',
          sections: [
            {
              title: 'สิ่งที่เปลี่ยน',
              body: 'งาน recall ถูก parallelize อยู่เบื้องหลัง โดยยังคง global reranking behavior เดิม',
            },
            {
              title: 'วิธีตรวจสอบ',
              items: [
                'เปิดหน้า detail ของ Space Chain แล้วใช้ Recall test panel',
                'เปิด Force scanAll เมื่ออยากทดสอบพฤติกรรม cross-chain recall',
                'ดู elapsed time ที่แสดงพร้อม result เพื่อเปรียบเทียบ query performance',
              ],
            },
          ],
        },
        {
          date: '25 พฤษภาคม 2026',
          title: 'จัดการ session memory และ batch cleanup',
          summary:
            'memory workbench สามารถ list session memory rows, filter ตาม All, Insight, Pinned หรือ Session, เลือก rows, เปลี่ยน page size และลบ memories ที่เลือกแบบ batch ได้ API ยังรองรับการลบ session-row และ request-level switch เพื่อไม่บันทึก raw session rows เมื่อจำเป็นต้องใช้แค่ facts ที่ extract แล้ว',
          sections: [
            {
              title: 'การล้างข้อมูลใน Console',
              items: [
                'เปิด Space memory workbench แล้วเลือก memory type filter',
                'เลือกหนึ่งหรือหลาย rows แล้วลบ memories ที่เลือกจาก toolbar',
              ],
            },
            {
              title: 'ตัวเลือก API',
              body: 'สำหรับ API ingest flows ให้ตั้ง `disableSessionSave` เมื่ออยาก extract facts โดยไม่เก็บ raw session messages',
            },
          ],
        },
        {
          date: '26 พฤษภาคม 2026',
          title: 'Console รองรับเจ็ดภาษา',
          summary:
            'Console รองรับ English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Indonesian และ Thai ครอบคลุม shell, auth pages, Spaces, Memories, Settings, Project และ Space Chain flows',
          sections: [
            {
              title: 'ตัวเลือกภาษา',
              items: [
                'เปิด language menu ใน Console header หรือ auth page',
                'เลือกภาษา ระบบจะบันทึกไว้ในเครื่องและอัปเดต document language',
              ],
            },
          ],
        },
        {
          date: '19 พฤษภาคม 2026',
          title: 'Billing และ usage dashboards',
          summary:
            'องค์กรสามารถดู billing plan state, entitlements, request usage summaries, daily rollups และ detailed usage events ได้ Runtime มี quota gates และ durable metering เพื่อ track commercial usage โดยไม่เปลี่ยน self-hosted behavior',
          sections: [
            {
              title: 'ดูได้ที่ไหน',
              items: [
                'เปิด Console แล้วเลือก organization',
                'ไปที่ Billing เพื่อดู plan และ entitlement state',
                'ไปที่ Usage เพื่อตรวจยอด memory recall และ memory write request ในช่วงวันที่ที่เลือก',
              ],
            },
          ],
        },
        {
          date: '19 พฤษภาคม 2026',
          title: 'Space memory explorer และ runtime tools',
          summary:
            'Spaces มี memory workbench พร้อม summary metrics, imports, memory list/detail, create/edit/delete controls และ shared Recall test panel Raw API keys ยังอยู่ฝั่ง server ขณะที่ Console proxy memory operations ที่ authorize แล้ว',
          sections: [
            {
              title: 'เครื่องมือ workbench',
              items: [
                'เปิดหน้า detail ของ Space ใน Console',
                'ใช้ Memories tab เพื่อ browse, create, edit หรือ delete memories',
                'ใช้ Recall test panel เพื่อทดสอบว่า Space จะ retrieve อะไรสำหรับ query หนึ่ง',
              ],
            },
          ],
        },
        {
          date: '15 พฤษภาคม 2026',
          title: 'รองรับ Space Chain runtime',
          summary:
            'Space Chains ใช้งานใน runtime ได้แล้ว พร้อม ordered recall/write behavior, chain key authentication และ provenance ใน chain responses ทำให้ chain key เดียว retrieve จากหลาย Space ตามลำดับที่ควบคุมได้',
          sections: [
            {
              title: 'การตั้งค่า runtime',
              items: [
                'สร้างหรือเปิด Space Chain ใน Console',
                'เพิ่ม Space nodes ตามลำดับที่อยากให้ recall ค้นหา',
                'สร้าง chain key binding แล้วใช้ key นั้นพร้อม `scanAll=true` เมื่อต้องการ recall ข้าม chain',
              ],
            },
          ],
        },
        {
          date: '14 พฤษภาคม 2026',
          title: 'จัดการ Space API key และ organization roles ให้ปลอดภัยขึ้น',
          summary:
            'Space API keys ถูกเก็บใน encrypted catalog พร้อม masked display values ที่เสถียร, explicit reveal workflows และ active binding checks Organization roles แยก owner, admin และ member permissions สำหรับ resource และ key management',
          sections: [
            {
              title: 'สิทธิ์',
              items: [
                'Owner และ admin สามารถ create, bind และ reveal Space keys จาก Space key management flow',
                'Member ยังอ่าน resources ที่ได้รับอนุญาตได้ แต่ไม่มี mutation permissions',
                'ใช้ masked key values ในมุมมองทั่วไป และ reveal key เฉพาะตอนต้อง copy ไปยัง client',
              ],
            },
          ],
        },
      ],
    },
  ],
});

const releaseNotesPageCopyByLocale: Record<SiteLocale, SiteReleaseNotesPageCopy> = {
  en: releaseNotesPageCopyEn,
  zh: releaseNotesPageCopyZh,
  'zh-Hant': releaseNotesPageCopyZhHant,
  ja: releaseNotesPageCopyJa,
  ko: releaseNotesPageCopyKo,
  id: releaseNotesPageCopyId,
  th: releaseNotesPageCopyTh,
};

const apiSharedTextTranslations: Partial<Record<SiteLocale, Record<string, string>>> = {
  zh: {
    'mem9 API key for your space.': '你的 mem9 space API key。',
    'Optional agent identity header for attribution.': '可选的 agent 身份 header，用于归因。',
    'Set to `application/json` for JSON request bodies.': '发送 JSON 请求体时设为 `application/json`。',
    'Optional version guard for optimistic updates.': '可选的版本保护，用于乐观更新。',
    'Your HTTP client sends this as `multipart/form-data`.': '由你的 HTTP 客户端以 `multipart/form-data` 发送。',
    'Active Space Chain API key for this chain.': '这条 Space Chain 当前可用的 API key。',
    'Plain memory content for direct writes. Required when `messages` is absent.': '直接写入的纯文本记忆内容。未提供 `messages` 时必填。',
    'Conversation messages for ingest-based writes. Required when `content` is absent.': '用于 ingest 写入的对话消息。未提供 `content` 时必填。',
    'Optional application isolation id, max 100 characters. Omitted, null, empty, or whitespace values write to the default/global appId; non-empty values are trimmed and stored exactly.': '可选的应用隔离 id，最多 100 个字符。省略、null、空字符串或纯空白会写入默认/global appId；非空值会 trim 后原样保存。',
    'Only accepted with `content` writes. Use `insight` or `pinned`; defaults to `insight`.': '仅在 `content` 写入时可用。使用 `insight` 或 `pinned`；默认是 `insight`。',
    'Optional agent id to store with the write.': '可选的 agent id，会随本次写入保存。',
    'Optional session id for ingest or attribution.': '可选的 session id，用于 ingest 或归因。',
    'Optional string tags stored on the memory.': '可选的字符串标签，会保存到记忆上。',
    'Optional JSON metadata payload.': '可选的 JSON metadata 载荷。',
    'Ingest mode such as `smart` or `raw` when using `messages`.': '使用 `messages` 时的 ingest 模式，例如 `smart` 或 `raw`。',
    'When true, wait for completion before returning.': '为 true 时等待处理完成后再返回。',
    'Message ingest only. When true, skip raw session persistence and only extract/reconcile facts.': '仅用于 message ingest。为 true 时跳过原始 session 持久化，只提取/合并 facts。',
    'Search query. Omit to list memories by filters.': '搜索查询。省略时按过滤条件列出 memories。',
    'Optional search behavior. Use `keyword` for direct content substring matching in list UIs; omit it for the default recall-style search.': '可选搜索行为。列表 UI 中使用 `keyword` 做 content 子串匹配；省略时使用默认 recall 风格搜索。',
    'Comma-separated tag filter.': '逗号分隔的 tag 过滤器。',
    'Filter by stored source value.': '按已保存的 source 值过滤。',
    'Filter by lifecycle state such as `active` or `archived`.': '按生命周期状态过滤，例如 `active` 或 `archived`。',
    'Filter by `insight`, `pinned`, or `session`.': '按 `insight`、`pinned` 或 `session` 过滤。',
    'Filter by agent id.': '按 agent id 过滤。',
    'Filter by session id.': '按 session id 过滤。',
    'Optional appId filter. Omit to search all appIds, pass a value for exact isolation, or use `appId=null` / `appId=` for default/global.': '可选 appId 过滤器。省略表示搜索全部 appId，传值表示精确隔离，使用 `appId=null` / `appId=` 表示默认/global。',
    'Page size. The handler caps large values.': '分页大小。服务端会限制过大的值。',
    'Offset for pagination.': '分页 offset。',
    'Sort field used when listing memories, such as `updated_at`.': '列出 memories 时使用的排序字段，例如 `updated_at`。',
    'Sort direction, `asc` or `desc`.': '排序方向，`asc` 或 `desc`。',
    'Space Chain keys only. When true, recall searches every node and globally reranks the merged facts.': '仅 Space Chain key 可用。为 true 时 recall 会搜索所有节点，并对合并后的 facts 做全局 rerank。',
    'Updated memory content.': '更新后的记忆内容。',
    'Updated tag array.': '更新后的 tag 数组。',
    'Updated JSON metadata payload.': '更新后的 JSON metadata 载荷。',
    'Array of memory ids to delete.': '要删除的 memory id 数组。',
    'Uploaded file payload.': '上传的文件载荷。',
    'Use `memory` or `session`.': '使用 `memory` 或 `session`。',
    'Optional agent id for attribution.': '可选的 agent id，用于归因。',
    'Required when uploading `session` files.': '上传 `session` 文件时必填。',
    'Optional top-level appId inside JSON memory/session files.': 'JSON memory/session 文件中的可选顶层 appId。',
    'Optional per-memory appId override inside JSON memory files.': 'JSON memory 文件中每条 memory 可选的 appId 覆盖值。',
    'Optional per-session appId override inside JSON session files.': 'JSON session 文件中每个 session 可选的 appId 覆盖值。',
    'Repeat this query param for each session to fetch.': '每个要获取的 session 都重复传入这个查询参数。',
    'Optional per-session row limit.': '可选的每个 session 行数限制。',
    'The newly provisioned mem9 API key / space identifier.': '新创建的 mem9 API key / space 标识符。',
    'Health status string. Hosted service returns `ok`.': '健康状态字符串。托管服务返回 `ok`。',
    'Go runtime version used by the server.': '服务端使用的 Go runtime 版本。',
    'Server start timestamp.': '服务启动时间戳。',
    '`active` when the key can be used, otherwise `inactive`.': 'key 可用时为 `active`，否则为 `inactive`。',
    'Array of memory objects for the current page.': '当前页的 memory object 数组。',
    'Total matched rows before pagination.': '分页前匹配的总行数。',
    'Applied page size.': '实际应用的分页大小。',
    'Applied page offset.': '实际应用的分页 offset。',
    'Memory id.': 'Memory id。',
    'Stored memory content.': '已保存的 memory 内容。',
    'Memory type such as `insight`, `pinned`, or `session`.': 'Memory 类型，例如 `insight`、`pinned` 或 `session`。',
    'Application isolation id. Empty string means default/global.': '应用隔离 id。空字符串表示默认/global。',
    'Stored source value when present.': '存在时表示已保存的 source 值。',
    'String tag array when present.': '存在时表示字符串 tag 数组。',
    'Raw JSON metadata when present.': '存在时表示原始 JSON metadata。',
    'Agent id associated with the memory when present.': '存在时表示与该 memory 关联的 agent id。',
    'Session id associated with the memory when present.': '存在时表示与该 memory 关联的 session id。',
    'Agent or actor that last updated the memory when present.': '存在时表示最后更新该 memory 的 agent 或 actor。',
    'Replacement memory id when this memory has been superseded.': '当该 memory 被替代时，指向替代 memory id。',
    'Lifecycle state.': '生命周期状态。',
    'Current integer version.': '当前整数版本。',
    'Creation timestamp.': '创建时间戳。',
    'Last update timestamp.': '最后更新时间戳。',
    'Search relevance score when returned by search endpoints.': '搜索 endpoint 返回时的相关性分数。',
    'Recall confidence score when returned by recall-style search.': 'recall 风格搜索返回时的置信度分数。',
    'Human-readable recency string populated for query-time search results.': '查询时搜索结果中的人类可读时间新近程度。',
    'Handler result such as `ok` or `accepted`.': 'Handler 结果，例如 `ok` 或 `accepted`。',
    'Task id for polling.': '用于轮询的 task id。',
    'Initial task status such as `pending`.': '初始 task 状态，例如 `pending`。',
    'Aggregate task status for the tenant.': 'tenant 下的聚合 task 状态。',
    'Array of import task summaries.': 'import task 摘要数组。',
    'Task id.': 'Task id。',
    'Uploaded file name.': '上传文件名。',
    'Task status.': 'Task 状态。',
    'Total chunk count.': '总 chunk 数。',
    'Completed chunk count.': '已完成 chunk 数。',
    'Error message when the task fails.': 'task 失败时的错误消息。',
    'Array of captured session message rows.': '捕获到的 session message 行数组。',
    'Session message row id.': 'Session message 行 id。',
    'Session id for the row.': '该行的 session id。',
    'Agent id for the row when present.': '存在时表示该行的 agent id。',
    'Application isolation id for each raw session row.': '每条 raw session 行的应用隔离 id。',
    'Sequence number within the session.': 'session 内的序号。',
    'Message role such as `user` or `assistant`.': '消息角色，例如 `user` 或 `assistant`。',
    'Message content.': '消息内容。',
    'Content type for the captured message.': '捕获消息的 content type。',
    'Captured tags for the row.': '该行捕获到的 tags。',
    'Lifecycle state for the row.': '该行的生命周期状态。',
    'Applied per-session limit.': '实际应用的每 session 限制。',
    'Validate whether a Space key or Space Chain key is currently usable before making runtime calls.': '在发起 runtime 调用前，验证 Space key 或 Space Chain key 当前是否可用。',
    'Check API key status.': '检查 API key 状态。',
    'Send either a normal mem9 Space key or a Space Chain key in `X-API-Key`. The response is `active` or `inactive`; unknown keys return `404`.': '在 `X-API-Key` 中发送普通 mem9 Space key 或 Space Chain key。响应为 `active` 或 `inactive`；未知 key 返回 `404`。',
    'Space API key or Space Chain API key.': 'Space API key 或 Space Chain API key。',
    'Check Space key': '检查 Space key',
    'Check Space Chain key': '检查 Space Chain key',
    'Delete multiple memories.': '批量删除 memories。',
    'Deletes the provided memory ids in one request. When authenticated with a Space Chain key, the handler resolves each id to the node that owns it.': '在一个请求中删除给定的 memory ids。使用 Space Chain key 认证时，handler 会将每个 id 解析到拥有它的节点。',
    'Batch delete memories': '批量删除 memories',
    'Space Chains': 'Space Chains',
    'Create and manage ordered chains of Spaces. Runtime memory endpoints accept a Space Chain key and search the chain in node order, or all nodes when `scanAll=true`.': '创建和管理有序 Space 链。Runtime memory endpoint 可接受 Space Chain key，并按节点顺序搜索 chain；`scanAll=true` 时搜索所有节点。',
    'Create a Space Chain.': '创建 Space Chain。',
    'Creates a Space Chain and returns its first plaintext chain key once. Store `chain_api_key` securely; later list responses only expose masked or bound key records.': '创建 Space Chain，并且只返回一次首个明文 chain key。请安全保存 `chain_api_key`；后续列表响应只会暴露脱敏或绑定记录。',
    'Create Space Chain': '创建 Space Chain',
    'Export Space Chain env vars': '导出 Space Chain 环境变量',
    'Read the Space Chain for a key.': '读取某个 key 对应的 Space Chain。',
    'Looks up the active Space Chain associated with the `X-API-Key` chain key.': '查找与 `X-API-Key` chain key 关联的 active Space Chain。',
    'Get by key': '按 key 获取',
    'Read one Space Chain.': '读取单个 Space Chain。',
    'Returns chain metadata, nodes, and bindings for a chain key authorized to manage this Space Chain.': '返回该管理 key 有权管理的 Space Chain metadata、nodes 和 bindings。',
    'Get Space Chain': '获取 Space Chain',
    'Update Space Chain details.': '更新 Space Chain 详情。',
    'Updates the display name and description for a Space Chain.': '更新 Space Chain 的显示名称和描述。',
    'Update Space Chain': '更新 Space Chain',
    'Delete a Space Chain.': '删除 Space Chain。',
    'Soft-deletes the Space Chain. A successful delete returns `204 No Content`.': '软删除 Space Chain。删除成功时返回 `204 No Content`。',
    'Delete Space Chain': '删除 Space Chain',
    'List Space Chain nodes.': '列出 Space Chain 节点。',
    'Returns the ordered node list. Node positions are zero-based and define sequential recall order.': '返回有序节点列表。节点 position 从 0 开始，并定义顺序 recall 的访问顺序。',
    'List nodes': '列出节点',
    'Replace Space Chain nodes.': '替换 Space Chain 节点。',
    'Replaces the entire ordered node list. Each node must reference a normal Space key / tenant id, not another Space Chain key.': '替换整个有序节点列表。每个节点必须引用普通 Space key / tenant id，不能引用另一个 Space Chain key。',
    'Replace nodes': '替换节点',
    'List Space Chain key bindings.': '列出 Space Chain key bindings。',
    'Returns all key bindings visible to the management key for this Space Chain.': '返回该 Space Chain 管理 key 可见的全部 key bindings。',
    'List bindings': '列出 bindings',
    'Create a Space Chain key binding.': '创建 Space Chain key binding。',
    'Creates another chain key. Omit `chain_api_key` to let mem9 generate a key.': '创建另一个 chain key。省略 `chain_api_key` 时由 mem9 生成 key。',
    'Create binding': '创建 binding',
    'Disable a Space Chain key binding.': '禁用 Space Chain key binding。',
    'Disables an active binding. The API rejects disabling the last active key for a chain.': '禁用一个 active binding。API 会拒绝禁用某条 chain 的最后一个 active key。',
    'Disable binding': '禁用 binding',
    'Recall across a Space Chain.': '跨 Space Chain recall。',
    'Use the normal memory search endpoint with a Space Chain key. By default recall visits nodes in order and stops early on high confidence; pass `scanAll=true` to search every node and globally rerank.': '使用普通 memory search endpoint，但传入 Space Chain key。默认 recall 会按顺序访问节点，并在高置信结果处提前停止；传 `scanAll=true` 时搜索所有节点并全局 rerank。',
    'Recall with scanAll': '使用 scanAll recall',
    'Check server version metadata.': '检查 server 版本 metadata。',
    'Returns runtime metadata that is useful for support and deployment verification.': '返回对支持和部署验证有用的 runtime metadata。',
    'Version check': '版本检查',
  },
};

export function localizeApiSharedText(locale: SiteLocale, text: string): string {
  if (locale === 'en') {
    return text;
  }

  return apiSharedTextTranslations[locale]?.[text] ?? text;
}

function localizeApiFields(locale: SiteLocale, fields: SiteApiFieldCopy[] | undefined): SiteApiFieldCopy[] | undefined {
  return fields?.map((field) => ({
    ...field,
    description: localizeApiSharedText(locale, field.description),
  }));
}

function localizeApiEndpoint(locale: SiteLocale, endpoint: SiteApiEndpointCopy): SiteApiEndpointCopy {
  return {
    ...endpoint,
    summary: localizeApiSharedText(locale, endpoint.summary),
    description: endpoint.description ? localizeApiSharedText(locale, endpoint.description) : undefined,
    notes: endpoint.notes?.map((note) => localizeApiSharedText(locale, note)),
    headers: localizeApiFields(locale, endpoint.headers),
    queryParams: localizeApiFields(locale, endpoint.queryParams),
    bodyFields: localizeApiFields(locale, endpoint.bodyFields),
    responseFields: localizeApiFields(locale, endpoint.responseFields),
    examples: endpoint.examples?.map((example) => ({
      ...example,
      label: localizeApiSharedText(locale, example.label),
    })),
  };
}

export function localizeApiPageCopy(locale: SiteLocale, copy: SiteApiPageCopy): SiteApiPageCopy {
  return {
    ...copy,
    endpointGroups: copy.endpointGroups.map((group) => ({
      ...group,
      title: localizeApiSharedText(locale, group.title),
      description: localizeApiSharedText(locale, group.description),
      endpoints: group.endpoints.map((endpoint) => localizeApiEndpoint(locale, endpoint)),
    })),
  };
}

export const siteCopy: Record<SiteLocale, SiteDictionary> = {
  en: {
    meta: {
      title: 'mem9 - Persistent Memory for AI Agents',
      description:
        'mem9.ai gives OpenClaw, Hermes Agent, Dify, Claude Code, OpenCode, Codex, and custom tools shared persistent memory with hybrid recall and a visual dashboard.',
    },
    nav: {
      home: 'Home',
      features: 'Features',
      platforms: 'Platforms',
      benchmark: 'Benchmark',
      openclaw: 'OpenClaw',
      yourMemory: 'Your Memory',
      yourMemoryDescription: 'Visual memory management',
      webConsole: 'Web Console',
      webConsoleDescription: 'Manage your spaces, space chains, usage, and orders.',
      login: 'Log in',
      billing: 'Pricing',
      security: 'Security',
      faq: 'FAQ',
      github: 'GitHub',
      xcom: 'X.com',
      docs: 'Docs',
      mem9Docs: 'mem9 Docs',
      consoleDocs: 'mem9 Console Docs',
      api: 'API',
      apiReferences: 'API References',
      releaseNotes: 'Release Notes',
      contact: 'Contact Us',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for AI agents',
      subtitle:
        'Your agents forget everything between sessions. mem9 gives the agents you use one shared memory layer with hybrid recall and a visual dashboard.',
      guideSelector: {
        label: 'Works with your agent stack',
        items: guideSelectorItems,
      },
      onboardingLabel: 'Install for OpenClaw',
      onboardingBadge: 'Paste in OpenClaw',
      onboardingHint:
        'OpenClaw will automatically install mem9 and provision an <strong>API key</strong> for you.',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'Read https://mem9.ai/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw',
      onboardingCommandBeta:
        'Read https://mem9.ai/beta/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw',
      betaFeature: {
        title: 'Context Engine Support',
        description:
          'Now with support for the latest Context Engine, mem9 helps your agent remember what matters and bring in only the right memory for each task, so users repeat less, responses stay more accurate, and prompts stay lean.',
      },
      highlights: [
        {
          title: 'Persistent across sessions',
          description:
            'Cloud memory survives resets, restarts, long-running projects, and machine switches.',
        },
        {
          title: 'Shared across agents',
          description:
            'One memory space can serve any agent or API client through the same key.',
        },
        {
          title: 'Visible in a dashboard',
          description:
            'Review, analyze, import, and export memory from the hosted mem9.ai interface.',
        },
      ],
    },
    trust: {
      title: 'Security & Privacy',
      body:
        'mem9 is built for production use on enterprise-grade cloud infrastructure, with encryption in transit and at rest, access controls, auditability, and clear data handling boundaries.',
      supporting: 'Learn more in our security overview and white paper.',
      overviewLabel: 'Security Overview',
      whitePaperLabel: 'Security White Paper',
    },
    features: {
      kicker: 'Features',
      title: 'Persistent memory, zero plumbing',
      description:
        'Stop duct-taping databases, vector stores, and sync scripts together. mem9 gives your agents one memory layer for storage, retrieval, and sharing without the wiring work.',
      items: [
        {
          icon: '01',
          title: 'Instant persistent storage',
          description:
            'Spin up a durable memory backend in seconds. No schema design, no control plane, no ops. Your agent writes and mem9 persists.',
        },
        {
          icon: '02',
          title: 'Hybrid search, zero config',
          description:
            'Keyword search works out of the box. Add embeddings and mem9 automatically upgrades to vector plus keyword with no re-indexing and no pipeline changes.',
        },
        {
          icon: '03',
          title: 'Memory that follows your agent',
          description:
            "Close the tab. Restart the machine. Switch devices. Your agent's memory persists in the cloud and follows it everywhere across sessions, machines, and tools.",
        },
        {
          icon: '04',
          title: 'Open source, self-hostable',
          description:
            "Apache-2.0 Go server, TypeScript plugins, and bash hooks. Run it on our cloud or bring it home. Your agent's memory, your infrastructure.",
        },
      ],
    },
    platforms: {
      kicker: 'Platforms',
      title: 'Shared memory, every agent stack',
      description:
        'Give every agent runtime and workflow platform in your stack the same durable, searchable memory space.',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Memory plugin',
          detail:
            'Paste the install command at the top of this page into OpenClaw and it sets up automatically.',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: 'Memory provider',
          detail:
            'Install the standalone Hermes memory provider plugin and activate it in Hermes Agent.',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'Hooks and skills',
          detail:
            'Use the Claude Code plugin package to persist and recall memory through mem9 hooks.',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            'Load the mem9 OpenCode integration from your OpenCode config and share the same mem9 API.',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: 'Managed hooks',
          detail:
            'Use the Codex plugin to install managed hooks and project overrides backed by mem9.',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'Agent and workflow platform',
          detail:
            'Add mem9 tools to Dify Agent apps and Workflow apps, with one shared space or per-node API keys.',
          guideId: 'dify',
        },
        {
          name: 'Your Memory',
          desc: 'Official mem9.ai app',
          detail:
            'Visualize, manage, analyze, import, and export your memories from the official mem9.ai interface.',
          badge: 'Beta',
        },
      ],
      ctaLabel: 'Try Your Memory',
      guideCtaLabel: 'Read guide',
      note:
        'Custom HTTP clients can also read and write through the mem9 API layer and share the same memory space.',
    },
    benchmark: {
      kicker: 'Benchmark',
      title: 'LoCoMo Benchmark Results',
      description: 'Evaluating long-conversation memory quality across multi-hop reasoning, single-hop recall, temporal reasoning, open-domain QA, and adversarial robustness.',
      model: 'qwen3.5-plus',
      modelLabel: 'Model',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'F1 Score',
      llmLabel: 'LLM Score',
      erLabel: 'Evidence Recall',
      categoryLabel: 'Category',
      categories: [
        { name: 'Multi-hop Reasoning', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: 'Single-hop Recall', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: 'Temporal Reasoning', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: 'Open-domain QA', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: 'Adversarial', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark: Long-Conversation Memory evaluation framework',
    },
    faq: faqCopyByLocale.en,
    apiPage: apiPageByLocale.en,
    releaseNotesPage: releaseNotesPageCopyByLocale.en,
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'Learn how mem9 approaches data handling, encryption, access controls, and operational boundaries.',
      },
      kicker: 'Security',
      title: 'Security & Privacy',
      intro:
        'mem9 is designed to give users the benefits of persistent cloud memory with clear operational boundaries and strong security foundations.',
      bridgeBody:
        'Memory is often the first state problem in an agent system. When your workflow expands into files, artifacts, and retrieval, drive9 becomes the next layer.',
      bridgeCtaLabel: 'Explore drive9 \u2192',
      dataTitle: 'How mem9 handles data',
      dataBody:
        'mem9 stores memory data to help agents preserve useful context across sessions, devices, and workflows. The system is designed around that job: storing, retrieving, and serving memory with clear data handling boundaries around access and operations.',
      protectionsTitle: 'Core security protections',
      protections: [
        {
          title: 'Encryption in transit and at rest',
          description:
            'Memory data is protected while moving across the network and while stored.',
        },
        {
          title: 'Access controls',
          description:
            'Production access is controlled and limited to the systems and operators that need it.',
        },
        {
          title: 'Auditability and operational visibility',
          description:
            'Key actions are observable so operations can be tracked and reviewed.',
        },
        {
          title: 'Isolated data handling boundaries',
          description:
            'Memory processing is scoped to clear service boundaries to reduce unnecessary exposure.',
        },
        {
          title: 'Production-grade cloud infrastructure',
          description:
            'The underlying platform is built for durability, reliability, and steady operations.',
        },
      ],
      foundationTitle: 'Production-grade cloud infrastructure / Trust foundation',
      foundationBody:
        'The underlying platform is built for durability, reliability, and steady operations. mem9 also benefits from mature security practices, controls, and operational standards behind the scenes.',
      learnMoreTitle: 'Learn more',
      learnMoreBody: 'Read the security overview and white paper for additional detail.',
    },
    billing: {
      meta: {
        title: 'Pricing | mem9',
        description: 'mem9 pricing plans. Start free, scale as you grow.',
      },
      kicker: 'Pricing',
      title: 'Simple, transparent pricing',
      description: 'Start free. Scale when you need to.',
      featureLabels: [
        'End users',
        'Add requests',
        'Retrieval requests',
        'Support',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            'Unlimited',
            '13,000 / month',
            '1,300 / month',
            'Community',
          ],
          ctaLabel: 'Get Started',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / mo',
          features: [
            'Unlimited',
            '65,000 / month',
            '6,500 / month',
            'Email',
          ],
          ctaLabel: 'Buy Now',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / mo',
          features: [
            'Unlimited',
            '650,000 / month',
            '65,000 / month',
            'Priority',
          ],
          ctaLabel: 'Buy Now',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: 'Custom',
          period: '',
          features: [
            'Unlimited',
            'Unlimited',
            'Unlimited',
            'Dedicated support & Custom SLA',
          ],
          ctaLabel: 'Contact Us',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: 'Stay tuned! It is completely free for now. If you reach a paid tier, we will give you enough credits. Feel free to use it!',
      contactMessage:
        'Email us for enterprise pricing, security reviews, and dedicated support.',
      contactCopyLabel: 'Copy Email',
      contactCopiedMessage: 'Email address copied.',
      contactCopyFailedMessage: 'Copy failed. Please use the email address below.',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: 'OK',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'Contributing',
      security: 'Security',
      contact: 'Contact Us',
      poweredByLabel: 'Powered by TiDB Cloud',
      copyright: 'mem9.ai. Unlimited memory infrastructure for AI agents.',
    },
    aria: {
      home: 'mem9 home',
      mainMenu: 'Open main menu',
      changeLanguage: 'Change language',
      changeTheme: 'Change theme',
      themeModeLight: 'Theme mode: Light',
      themeModeDark: 'Theme mode: Dark',
      themeModeSystem: 'Theme mode: Follow system',
      copyOnboarding: 'Copy onboarding instructions',
    },
    themeOptions: {
      light: 'Light',
      dark: 'Dark',
      system: 'Follow system',
    },
    copyFeedback: {
      copied: 'Onboarding instructions copied.',
      copyFailed: 'Copy failed. Please copy the command manually.',
    },
    localeNames,
  },
  zh: {
    meta: {
      title: 'mem9 - 面向 AI Agents 的持久记忆',
      description:
        'mem9.ai 为 OpenClaw、Hermes Agent、Dify、Claude Code、OpenCode、Codex 和自定义工具提供共享持久记忆、混合召回和可视化管理界面。',
    },
    nav: {
      home: '首页',
      features: '能力',
      platforms: '平台',
      benchmark: '基准测试',
      openclaw: 'OpenClaw',
      yourMemory: '你的记忆',
      yourMemoryDescription: '可视化记忆管理',
      webConsole: 'Web Console',
      webConsoleDescription: '管理您的空间、空间链、用量和订单。',
      login: '登录',
      billing: '定价',
      security: '安全',
      faq: '常见问题',
      github: 'GitHub',
      xcom: 'X.com',
      docs: '文档',
      mem9Docs: 'mem9 文档',
      consoleDocs: 'mem9 Console 文档',
      api: 'API',
      apiReferences: 'API 参考',
      releaseNotes: '发布说明',
      contact: '联系我们',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '无限记忆',
      titleAccent: 'for AI agents',
      subtitle:
        '你的 Agent 会在会话之间丢失上下文。mem9 为你使用的 Agent 提供同一层共享记忆，支持混合召回和可视化管理。',
      guideSelector: {
        label: '支持你的 Agent 栈',
        items: guideSelectorItems,
      },
      onboardingLabel: '为 OpenClaw 安装',
      onboardingBadge: '粘贴到 OpenClaw',
      onboardingHint:
        'OpenClaw 会自动为你安装 mem9 并申请 <strong>API Key</strong>。',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        '阅读 https://mem9.ai/SKILL.md ，按照说明为 OpenClaw 安装并配置 mem9',
      onboardingCommandBeta:
        '阅读 https://mem9.ai/beta/SKILL.md ，按照说明为 OpenClaw 安装并配置 mem9',
      betaFeature: {
        title: 'Context Engine 支持',
        description:
          '现在已支持最新的 Context Engine，mem9 能帮助你的 Agent 记住真正重要的内容，并在每个任务里只带入合适的记忆。',
      },
      highlights: [
        {
          title: '跨会话持久保存',
          description: '云端记忆可跨越重置、重启、长期项目和设备切换持续保留。',
        },
        {
          title: '跨 Agent 共享',
          description: '同一个记忆空间可以通过同一把 Key 服务任意 Agent 与 API 客户端。',
        },
        {
          title: '可视化管理',
          description: '在 mem9.ai 官方界面中审查、分析、导入和导出记忆。',
        },
      ],
    },
    trust: {
      title: '安全与隐私',
      body:
        'mem9 面向生产使用，构建在企业级云基础设施之上，提供传输中与静态加密、访问控制、可审计性，以及清晰的数据处理边界。',
      supporting: '可在安全概览和白皮书中了解更多。',
      overviewLabel: '安全概览',
      whitePaperLabel: '安全白皮书',
    },
    features: {
      kicker: '能力',
      title: '持久记忆，无需自己拼管线',
      description:
        '别再把数据库、向量库和同步脚本硬缝在一起。mem9 为你的 Agent 提供统一记忆层，一次解决存储、检索和共享。',
      items: [
        {
          icon: '01',
          title: '即时持久化存储',
          description:
            '几秒内就能启动耐久记忆后端。无需设计 schema，无需控制面，无需运维。你的 Agent 负责写入，mem9 负责持久化。',
        },
        {
          icon: '02',
          title: '混合搜索，零配置',
          description:
            '关键词搜索开箱即用。补上 embeddings 后，mem9 会自动升级为向量加关键词混合检索，无需重建索引，也无需改动流水线。',
        },
        {
          icon: '03',
          title: '记忆跟着 Agent 走',
          description:
            '关掉标签页、重启机器、切换设备都没问题。你的 Agent 记忆持续存在于云端，跨会话、跨机器、跨工具一路跟随。',
        },
        {
          icon: '04',
          title: '开源且可自托管',
          description:
            '提供 Apache-2.0 的 Go 服务端、TypeScript 插件和 bash hooks。你可以使用我们的云，也可以完全带回自己的基础设施。',
        },
      ],
    },
    platforms: {
      kicker: '平台',
      title: '共享记忆，覆盖每个 Agent 栈',
      description:
        '让你的 Agent 栈里的运行时和工作流平台共享同一个持久、可搜索的记忆空间。',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Memory plugin',
          detail: '把页面顶部的安装命令粘贴给 OpenClaw，它会自动完成接入。',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: 'Memory provider',
          detail: '安装独立的 Hermes memory provider 插件，并在 Hermes Agent 中启用。',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'Hooks and skills',
          detail: '使用 Claude Code 插件，通过 mem9 hooks 持久化和召回记忆。',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail: '从 OpenCode 配置加载 mem9 集成，并共享同一套 mem9 API。',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: 'Managed hooks',
          detail: '使用 Codex 插件安装托管 hooks 和项目级覆盖配置，后端由 mem9 支撑。',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'Agent 与工作流平台',
          detail:
            '为 Dify Agent 应用和 Workflow 应用加入 mem9 工具，支持一个共享空间或节点级 API Key。',
          guideId: 'dify',
        },
        {
          name: '你的记忆',
          desc: 'mem9.ai 官方应用',
          detail:
            '通过 mem9.ai 官方界面可视化管理、分析，并导入导出你的 memories。',
          badge: 'Beta',
        },
      ],
      ctaLabel: '试试你的记忆',
      guideCtaLabel: '阅读指南',
      note:
        '自定义 HTTP 客户端也可以通过 mem9 API 层读写，并共享同一个记忆空间。',
    },
    benchmark: {
      kicker: '基准测试',
      title: 'LoCoMo 基准测试结果',
      description: '评估长对话记忆质量，涵盖多跳推理、单跳召回、时序推理、开放域问答及对抗鲁棒性。',
      model: 'qwen3.5-plus',
      modelLabel: '模型',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'F1 分数',
      llmLabel: 'LLM 分数',
      erLabel: '证据召回率',
      categoryLabel: '类别',
      categories: [
        { name: '多跳推理', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: '单跳召回', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: '时序推理', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: '开放域问答', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: '对抗测试', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark：长对话记忆评估框架',
    },
    faq: faqCopyByLocale.zh,
    apiPage: apiPageByLocale.zh,
    releaseNotesPage: releaseNotesPageCopyByLocale.zh,
    securityPage: {
      meta: {
        title: '安全与隐私 | mem9',
        description:
          '了解 mem9 如何处理数据，以及在加密、访问控制和操作边界上的做法。',
      },
      kicker: '安全',
      title: '安全与隐私',
      intro:
        'mem9 的设计目标，是在提供持久云记忆能力的同时，保持清晰的操作边界和稳固的安全基础。',
      bridgeBody:
        '记忆通常是 Agent 系统中的第一个状态难题。当你的工作流扩展到文件、产物和检索时，drive9 会成为下一层。',
      bridgeCtaLabel: '探索 drive9 \u2192',
      dataTitle: 'mem9 如何处理数据',
      dataBody:
        'mem9 会存储记忆数据，帮助 Agent 在跨会话、跨设备和跨工作流时保留有用上下文。相关数据流被限定在产品的核心职责内，即存储、检索和提供记忆，并围绕访问与运维设有清晰的数据处理边界。',
      protectionsTitle: '核心安全保护',
      protections: [
        {
          title: '传输中与静态加密',
          description: '数据在传输过程中与静态存储时都会受到保护。',
        },
        {
          title: '访问控制',
          description: '对生产系统和数据访问进行控制并限制。',
        },
        {
          title: '可审计性与运营可见性',
          description: '关键操作具备可见性，便于追踪和审查。',
        },
        {
          title: '隔离的数据处理边界',
          description: '记忆处理围绕明确的服务边界设计，减少不必要的暴露面。',
        },
        {
          title: '生产级云基础设施',
          description: '底层基础设施面向可靠性、持久性和稳定运营构建。',
        },
      ],
      foundationTitle: '生产级云基础设施 / 信任基础',
      foundationBody:
        '底层基础设施面向可靠性、持久性和稳定运营构建。与此同时，mem9 也受益于幕后成熟的安全实践、控制措施和运营标准。',
      learnMoreTitle: '了解更多',
      learnMoreBody: '更多细节可查看安全概览和白皮书。',
    },
    billing: {
      meta: {
        title: '定价 | mem9',
        description: 'mem9 定价方案。免费起步，按需扩展。',
      },
      kicker: '定价',
      title: '简单透明的定价',
      description: '免费起步，按需扩展。',
      featureLabels: [
        '终端用户',
        '添加请求',
        '检索请求',
        '支持',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '不限',
            '13,000 / 月',
            '1,300 / 月',
            '社区',
          ],
          ctaLabel: '开始使用',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '不限',
            '65,000 / 月',
            '6,500 / 月',
            '邮件',
          ],
          ctaLabel: '立即购买',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '不限',
            '650,000 / 月',
            '65,000 / 月',
            '优先',
          ],
          ctaLabel: '立即购买',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: '自定义',
          period: '',
          features: [
            '不限',
            '不限',
            '不限',
            '专属支持 & 自定义 SLA',
          ],
          ctaLabel: '联系我们',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: '敬请期待，现在完全免费，如果您已经到了收费的tier，我们也会给您足够的Credits，请放心使用！',
      contactMessage: '如需企业定价、安全审查或专属支持，请发送邮件联系我们。',
      contactCopyLabel: '复制邮箱',
      contactCopiedMessage: '邮箱地址已复制。',
      contactCopyFailedMessage: '复制失败，请使用下方邮箱地址。',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: '确定',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '参与贡献',
      security: '安全',
      contact: '联系我们',
      poweredByLabel: '由 TiDB Cloud 提供支持',
      copyright: 'mem9.ai。为 AI Agents 提供无限记忆基础设施。',
    },
    aria: {
      home: 'mem9 首页',
      mainMenu: '打开主菜单',
      changeLanguage: '切换语言',
      changeTheme: '切换主题',
      themeModeLight: '主题模式：浅色',
      themeModeDark: '主题模式：深色',
      themeModeSystem: '主题模式：跟随系统',
      copyOnboarding: '复制接入说明',
    },
    themeOptions: {
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
    },
    copyFeedback: {
      copied: '已复制接入说明。',
      copyFailed: '复制失败，请手动复制命令。',
    },
    localeNames,
  },
  'zh-Hant': {
    meta: {
      title: 'mem9 - 面向 OpenClaw 的無限記憶基礎設施',
      description:
        'mem9.ai 為 OpenClaw 提供無限記憶基礎設施，支援持久召回、混合搜尋，以及面向 Dify、Claude Code、OpenCode、OpenClaw 和自訂工具的多 Agent 上下文共享。',
    },
    nav: {
      home: '首頁',
      features: '能力',
      platforms: '平台',
      benchmark: '基準測試',
      openclaw: 'OpenClaw',
      yourMemory: '你的記憶',
      yourMemoryDescription: '可視化記憶管理',
      webConsole: 'Web Console',
      webConsoleDescription: '管理您的空間、空間鏈、用量和訂單。',
      login: '登入',
      billing: '定價',
      security: '安全',
      faq: '常見問題',
      github: 'GitHub',
      xcom: 'X.com',
      docs: '文檔',
      mem9Docs: 'mem9 文檔',
      consoleDocs: 'mem9 Console 文檔',
      api: 'API',
      apiReferences: 'API 參考',
      releaseNotes: '發布說明',
      contact: '聯絡我們',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '無限記憶',
      titleAccent: 'for AI agents',
      subtitle:
        '你的 Agent 會在會話之間遺忘所有內容。mem9 為你使用的 Agent 提供同一層共享記憶，支援混合召回和可視化管理。',
      guideSelector: {
        label: '支援你的 Agent 堆疊',
        items: guideSelectorItems,
      },
      onboardingLabel: '為 OpenClaw 安裝',
      onboardingBadge: '貼上到 OpenClaw',
      onboardingHint:
        'OpenClaw 會自動為你安裝 mem9 並申請 <strong>API Key</strong>。',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        '閱讀 https://mem9.ai/SKILL.md，按照說明為 OpenClaw 安裝並配置 mem9',
      onboardingCommandBeta:
        '閱讀 https://mem9.ai/beta/SKILL.md，按照說明為 OpenClaw 安裝並配置 mem9',
      betaFeature: {
        title: 'Context Engine 支援',
        description:
          '現在已支援最新的 Context Engine，mem9 能幫助你的 Agent 記住真正重要的內容，並在每個任務中只帶入最合適的記憶。這樣使用者不必反覆重複資訊，回覆會更準確，提示詞也能保持精簡。最終效果是 Agent 體驗更快、更聚焦，同時降低 token 消耗與不必要的成本。',
      },
      highlights: [
        {
          title: '不再遺忘',
          description: '雲端持久記憶可跨越重設、重啟和裝置切換持續保留。',
        },
        {
          title: '安全備份',
          description: '你的 Agent 記憶存放在耐久雲端儲存中，而不是脆弱的本地檔案。',
        },
        {
          title: '無縫接入',
          description: '從一條指令開始，再逐步遷移既有記憶，不會打斷現有工作流。',
        },
      ],
    },
    trust: {
      title: '安全與隱私',
      body:
        'mem9 面向正式環境使用，建立在企業級雲端基礎設施之上，提供傳輸中與靜態加密、存取控制、可稽核性，以及清楚的資料處理邊界。',
      supporting: '可在安全概覽與白皮書中了解更多。',
      overviewLabel: '安全概覽',
      whitePaperLabel: '安全白皮書',
    },
    features: {
      kicker: '能力',
      title: '持久記憶，無需自己拼管線',
      description:
        '別再把資料庫、向量庫和同步腳本硬湊在一起。mem9 為你的 Agent 提供統一記憶層，一次解決儲存、檢索和共享。',
      items: [
        {
          icon: '01',
          title: '即時持久化儲存',
          description:
            '幾秒內就能啟動耐久記憶後端。無需設計 schema，無需控制面，無需運維。你的 Agent 負責寫入，mem9 負責持久化。',
        },
        {
          icon: '02',
          title: '混合搜尋，零配置',
          description:
            '關鍵詞搜尋開箱即用。補上 embeddings 後，mem9 會自動升級為向量加關鍵詞混合檢索，無需重建索引，也無需改動流水線。',
        },
        {
          icon: '03',
          title: '記憶跟著 Agent 走',
          description:
            '關掉分頁、重啟機器、切換裝置都沒問題。你的 Agent 記憶持續存在於雲端，跨會話、跨機器、跨工具一路跟隨。',
        },
        {
          icon: '04',
          title: '開源且可自託管',
          description:
            '提供 Apache-2.0 的 Go 服務端、TypeScript 外掛和 bash hooks。你可以使用我們的雲，也可以完全帶回自己的基礎設施。',
        },
      ],
    },
    platforms: {
      kicker: '平台',
      title: '共享記憶，覆蓋每個 Agent 堆疊',
      description:
        'mem9 為你的 Agent 執行環境與工作流平台提供共享且持久的記憶層，始終可搜尋、可同步、可長期保存。',
      items: [
        {
          name: 'OpenClaw',
          desc: '記憶外掛',
          detail:
            '把頁面頂部的安裝命令貼給 OpenClaw，它會自動完成接入。',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: '記憶提供者',
          detail:
            '安裝獨立的 Hermes memory provider 外掛，並在 Hermes Agent 中啟用。',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'Hooks 與技能',
          detail:
            '使用 Claude Code 外掛，透過 mem9 hooks 持久化並召回記憶。',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            '從 OpenCode 設定載入 mem9 整合，並共享同一套 mem9 API。',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: '託管 hooks',
          detail:
            '使用 Codex 外掛安裝託管 hooks 和專案級覆寫設定，後端由 mem9 支撐。',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'Agent 與工作流平台',
          detail:
            '為 Dify Agent 應用與 Workflow 應用加入 mem9 工具，支援一個共享空間或節點級 API Key。',
          guideId: 'dify',
        },
        {
          name: '你的記憶',
          desc: 'mem9.ai 官方應用',
          detail:
            '透過 mem9.ai 官方介面，以視覺化方式管理、分析，並匯入匯出你的 memories。',
          badge: 'Beta',
        },
      ],
      ctaLabel: '試試你的記憶',
      guideCtaLabel: '閱讀指南',
      note:
        '自訂 HTTP 客戶端也可以透過 mem9 API 層讀寫，並共享同一個記憶空間。',
    },
    benchmark: {
      kicker: '基準測試',
      title: 'LoCoMo 基準測試結果',
      description: '評估長對話記憶品質，涵蓋多跳推理、單跳召回、時序推理、開放域問答及對抗穩健性。',
      model: 'qwen3.5-plus',
      modelLabel: '模型',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'F1 分數',
      llmLabel: 'LLM 分數',
      erLabel: '證據召回率',
      categoryLabel: '類別',
      categories: [
        { name: '多跳推理', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: '單跳召回', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: '時序推理', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: '開放域問答', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: '對抗測試', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark：長對話記憶評估框架',
    },
    faq: faqCopyByLocale['zh-Hant'],
    apiPage: apiPageByLocale['zh-Hant'],
    releaseNotesPage: releaseNotesPageCopyByLocale['zh-Hant'],
    securityPage: {
      meta: {
        title: '安全與隱私 | mem9',
        description:
          '了解 mem9 如何處理資料，以及在加密、存取控制與操作邊界上的做法。',
      },
      kicker: '安全',
      title: '安全與隱私',
      intro:
        'mem9 的設計目標，是在提供持久雲端記憶能力的同時，維持清楚的操作邊界與穩固的安全基礎。',
      bridgeBody:
        '記憶通常是 Agent 系統中的第一個狀態難題。當你的工作流擴展到檔案、產物和檢索時，drive9 會成為下一層。',
      bridgeCtaLabel: '探索 drive9 \u2192',
      dataTitle: 'mem9 如何處理資料',
      dataBody:
        'mem9 會儲存記憶資料，幫助 Agent 在跨會話、跨裝置與跨工作流程時保留有用上下文。相關資料流被限定在產品的核心職責內，也就是儲存、檢索與提供記憶，並圍繞存取與營運設有清楚的資料處理邊界。',
      protectionsTitle: '核心安全保護',
      protections: [
        {
          title: '傳輸中與靜態加密',
          description: '資料在傳輸過程與靜態儲存時都會受到保護。',
        },
        {
          title: '存取控制',
          description: '對正式環境系統與資料的存取會受到控制與限制。',
        },
        {
          title: '可稽核性與營運可見性',
          description: '關鍵操作具備可見性，方便追蹤與審查。',
        },
        {
          title: '隔離的資料處理邊界',
          description: '記憶處理圍繞明確的服務邊界設計，減少不必要的暴露面。',
        },
        {
          title: '正式環境等級雲端基礎設施',
          description: '底層平台以耐久性、可靠性與穩定營運為前提打造。',
        },
      ],
      foundationTitle: '正式環境等級雲端基礎設施 / 信任基礎',
      foundationBody:
        '底層平台以耐久性、可靠性與穩定營運為前提打造。同時，mem9 也受益於幕後成熟的安全實務、控制措施與營運標準。',
      learnMoreTitle: '了解更多',
      learnMoreBody: '更多細節可查看安全概覽與白皮書。',
    },
    billing: {
      meta: {
        title: '定價 | mem9',
        description: 'mem9 定價方案。免費起步，按需擴展。',
      },
      kicker: '定價',
      title: '簡單透明的定價',
      description: '免費起步，按需擴展。',
      featureLabels: [
        '終端使用者',
        '新增請求',
        '檢索請求',
        '支援',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '不限',
            '13,000 / 月',
            '1,300 / 月',
            '社群',
          ],
          ctaLabel: '開始使用',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '不限',
            '65,000 / 月',
            '6,500 / 月',
            '電郵',
          ],
          ctaLabel: '立即購買',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '不限',
            '650,000 / 月',
            '65,000 / 月',
            '優先',
          ],
          ctaLabel: '立即購買',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: '自訂',
          period: '',
          features: [
            '不限',
            '不限',
            '不限',
            '專屬支援 & 自訂 SLA',
          ],
          ctaLabel: '聯絡我們',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: '敬請期待，現在完全免費，如果您已經到了收費的方案，我們也會給您足夠的 Credits，請放心使用！',
      contactMessage: '如需企業定價、安全審查或專屬支援，請發送郵件與我們聯絡。',
      contactCopyLabel: '複製信箱',
      contactCopiedMessage: '信箱地址已複製。',
      contactCopyFailedMessage: '複製失敗，請使用下方信箱地址。',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: '確定',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '參與貢獻',
      security: '安全',
      contact: '聯絡我們',
      poweredByLabel: '由 TiDB Cloud 提供支援',
      copyright: 'mem9.ai。為 AI Agents 提供無限記憶基礎設施。',
    },
    aria: {
      home: 'mem9 首頁',
      mainMenu: '開啟主選單',
      changeLanguage: '切換語言',
      changeTheme: '切換主題',
      themeModeLight: '主題模式：淺色',
      themeModeDark: '主題模式：深色',
      themeModeSystem: '主題模式：跟隨系統',
      copyOnboarding: '複製接入說明',
    },
    themeOptions: {
      light: '淺色',
      dark: '深色',
      system: '跟隨系統',
    },
    copyFeedback: {
      copied: '已複製接入說明。',
      copyFailed: '複製失敗，請手動複製命令。',
    },
    localeNames,
  },
  ja: {
    meta: {
      title: 'mem9 - OpenClaw 向け無制限メモリ基盤',
      description:
        'mem9.ai は OpenClaw 向けの無制限メモリ基盤です。永続リコール、ハイブリッド検索、そして Dify、Claude Code、OpenCode、OpenClaw、独自ツール向けのマルチエージェント文脈共有を提供します。',
    },
    nav: {
      home: 'ホーム',
      features: '機能',
      platforms: '対応環境',
      benchmark: 'ベンチマーク',
      openclaw: 'OpenClaw',
      yourMemory: 'あなたの記憶',
      yourMemoryDescription: 'ビジュアルなメモリ管理',
      webConsole: 'Web Console',
      webConsoleDescription: 'スペース、スペースチェーン、使用量、注文を管理します。',
      login: 'ログイン',
      billing: '料金',
      security: 'セキュリティ',
      faq: 'よくある質問',
      github: 'GitHub',
      xcom: 'X.com',
      docs: 'ドキュメント',
      mem9Docs: 'mem9 ドキュメント',
      consoleDocs: 'mem9 Console ドキュメント',
      api: 'API',
      apiReferences: 'API リファレンス',
      releaseNotes: 'リリースノート',
      contact: 'お問い合わせ',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for AI agents',
      subtitle:
        'エージェントはセッションが変わるたびにすべてを忘れます。mem9 は、ハイブリッド検索とビジュアルダッシュボードを備えた共有メモリレイヤーを、利用中のエージェントに提供します。',
      guideSelector: {
        label: 'エージェントスタックに対応',
        items: guideSelectorItems,
      },
      onboardingLabel: 'OpenClaw にインストール',
      onboardingBadge: 'OpenClaw に貼り付け',
      onboardingHint:
        'OpenClaw が自動的に mem9 をインストールし、<strong>API Key</strong> を発行します。',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'https://mem9.ai/SKILL.md を読み、手順に沿って OpenClaw 向けに mem9 をインストールして設定してください',
      onboardingCommandBeta:
        'https://mem9.ai/beta/SKILL.md を読み、手順に沿って OpenClaw 向けに mem9 をインストールして設定してください',
      betaFeature: {
        title: 'Context Engine サポート',
        description:
          '最新の Context Engine に対応したことで、mem9 はエージェントが本当に重要なことを覚え、各タスクに必要な記憶だけを適切に取り込めるようにします。これにより、ユーザーが同じ説明を繰り返す場面が減り、応答の精度が上がり、プロンプトも無駄なく保てます。その結果、より速く、より焦点の合ったエージェント体験を、低いトークン消費と無駄なコスト削減とともに実現できます。',
      },
      highlights: [
        {
          title: 'もう忘れない',
          description:
            'クラウド永続メモリが、リセットや再起動、マシン切り替えをまたいで残り続けます。',
        },
        {
          title: '安全にバックアップ',
          description:
            'エージェントの記憶は壊れやすいローカルファイルではなく、耐久性の高いクラウドストレージに保存されます。',
        },
        {
          title: '導入はスムーズ',
          description:
            'ひとつの指示から始めて、既存メモリもあとから取り込めるので、今のフローを壊しません。',
        },
      ],
    },
    trust: {
      title: 'セキュリティとプライバシー',
      body:
        'mem9 は本番利用を前提に、エンタープライズグレードのクラウド基盤上で構築されています。通信時と保存時の暗号化、アクセス制御、監査性、そして明確なデータ取り扱い境界を備えています。',
      supporting: '詳しくはセキュリティ概要とホワイトペーパーをご覧ください。',
      overviewLabel: 'セキュリティ概要',
      whitePaperLabel: 'セキュリティホワイトペーパー',
    },
    features: {
      kicker: '機能',
      title: '永続メモリを、配線作業なしで',
      description:
        'データベース、ベクトルストア、同期スクリプトを無理に継ぎ合わせる必要はありません。mem9 は保存、検索、共有をひとつのメモリレイヤーでまとめます。',
      items: [
        {
          icon: '01',
          title: '即座に永続ストレージ',
          description:
            '数秒で耐久性のあるメモリバックエンドを立ち上げられます。スキーマ設計も、コントロールプレーンも、運用も不要です。書き込めば mem9 が保持します。',
        },
        {
          icon: '02',
          title: 'ハイブリッド検索をゼロ設定で',
          description:
            'キーワード検索は最初から使えます。embeddings を追加すると、mem9 が自動でベクトルとキーワードのハイブリッド検索へ拡張し、再インデックスやパイプライン変更は不要です。',
        },
        {
          icon: '03',
          title: 'エージェントと一緒に動く記憶',
          description:
            'タブを閉じても、マシンを再起動しても、デバイスを変えても大丈夫です。エージェントの記憶はクラウドに残り、セッション、マシン、ツールをまたいで追従します。',
        },
        {
          icon: '04',
          title: 'オープンソースでセルフホスト可能',
          description:
            'Apache-2.0 の Go サーバー、TypeScript プラグイン、bash hooks を提供します。私たちのクラウドでも、自前の基盤でも動かせます。',
        },
      ],
    },
    platforms: {
      kicker: '対応環境',
      title: '共有メモリを、すべてのエージェントスタックへ',
      description:
        'mem9 はエージェントランタイムとワークフロープラットフォームに、永続的で検索可能、常に同期された共有メモリを提供します。',
      items: [
        {
          name: 'OpenClaw',
          desc: 'メモリプラグイン',
          detail:
            'ページ上部のインストールコマンドを OpenClaw に貼り付けるだけで自動的にセットアップされます。',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: 'メモリプロバイダー',
          detail:
            'スタンドアロンの Hermes memory provider プラグインをインストールし、Hermes Agent で有効化します。',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'Hooks とスキル',
          detail:
            'Claude Code プラグインパッケージを使い、mem9 hooks 経由でメモリを保存してリコールします。',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            'OpenCode 設定から mem9 OpenCode 連携を読み込み、同じ mem9 API を共有します。',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: '管理フック',
          detail:
            'Codex プラグインで mem9 を基盤とする管理 hooks とプロジェクト上書き設定を導入します。',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'エージェントとワークフローのプラットフォーム',
          detail:
            'Dify の Agent アプリと Workflow アプリに mem9 ツールを追加し、共有スペースまたはノード別 API キーで使えます。',
          guideId: 'dify',
        },
        {
          name: 'あなたの記憶',
          desc: 'mem9.ai 公式アプリ',
          detail:
            'mem9.ai の公式 UI から、あなたの memories を可視化して管理し、分析し、インポートとエクスポートを行えます。',
          badge: 'Beta',
        },
      ],
      ctaLabel: 'あなたの記憶を試す',
      guideCtaLabel: 'ガイドを読む',
      note:
        'カスタム HTTP クライアントも mem9 API レイヤーを通じて読み書きでき、同じメモリ空間を共有できます。',
    },
    benchmark: {
      kicker: 'ベンチマーク',
      title: 'LoCoMo ベンチマーク結果',
      description: 'マルチホップ推論、シングルホップ想起、時系列推論、オープンドメインQA、敵対的堅牢性にわたる長文会話メモリ品質の評価。',
      model: 'qwen3.5-plus',
      modelLabel: 'モデル',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'F1 スコア',
      llmLabel: 'LLM スコア',
      erLabel: '証拠再現率',
      categoryLabel: 'カテゴリ',
      categories: [
        { name: 'マルチホップ推論', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: 'シングルホップ想起', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: '時系列推論', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: 'オープンドメインQA', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: '敵対的テスト', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark：長文会話メモリ評価フレームワーク',
    },
    faq: faqCopyByLocale.ja,
    apiPage: apiPageByLocale.ja,
    releaseNotesPage: releaseNotesPageCopyByLocale.ja,
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'mem9 のデータ取り扱い、暗号化、アクセス制御、運用境界への考え方を紹介します。',
      },
      kicker: 'セキュリティ',
      title: 'セキュリティとプライバシー',
      intro:
        'mem9 は、永続クラウドメモリの利点を提供しながら、明確な運用境界と強固なセキュリティ基盤を保つよう設計されています。',
      bridgeBody:
        'メモリはエージェントシステムにおいて最初に直面する状態管理の課題になりがちです。ワークフローがファイル、アーティファクト、検索へと広がるとき、drive9 が次のレイヤーになります。',
      bridgeCtaLabel: 'drive9 を見る \u2192',
      dataTitle: 'mem9 のデータ取り扱い',
      dataBody:
        'mem9 は、エージェントがセッション、デバイス、ワークフローをまたいで有用な文脈を保てるようにメモリデータを保存します。データフローはその役割に絞られており、保存、検索、提供という機能の周囲に明確なデータ取り扱い境界を設けています。',
      protectionsTitle: '主要なセキュリティ保護',
      protections: [
        {
          title: '通信時と保存時の暗号化',
          description: 'メモリデータは通信中も保存中も保護されます。',
        },
        {
          title: 'アクセス制御',
          description: '本番環境へのアクセスは必要なシステムと運用者に限定されます。',
        },
        {
          title: '監査性と運用可視性',
          description: '主要な操作は追跡・確認できるよう可視化されています。',
        },
        {
          title: '分離されたデータ取り扱い境界',
          description: 'メモリ処理は明確なサービス境界に沿って設計され、不要な露出を抑えます。',
        },
        {
          title: '本番グレードのクラウド基盤',
          description: '基盤となるプラットフォームは耐久性、信頼性、安定運用を前提に構成されています。',
        },
      ],
      foundationTitle: '本番グレードのクラウド基盤 / 信頼の基盤',
      foundationBody:
        '基盤となるプラットフォームは耐久性、信頼性、安定運用を前提に構成されています。あわせて、mem9 は裏側で成熟したセキュリティ実務、統制、運用標準の恩恵を受けています。',
      learnMoreTitle: 'さらに詳しく',
      learnMoreBody: '詳しい内容はセキュリティ概要とホワイトペーパーをご覧ください。',
    },
    billing: {
      meta: {
        title: '料金 | mem9',
        description: 'mem9 の料金プラン。無料で始めて、必要に応じてスケール。',
      },
      kicker: '料金',
      title: 'シンプルで透明な料金体系',
      description: '無料で始めて、必要に応じてスケール。',
      featureLabels: [
        'エンドユーザー',
        '追加リクエスト',
        '検索リクエスト',
        'サポート',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '無制限',
            '13,000 / 月',
            '1,300 / 月',
            'コミュニティ',
          ],
          ctaLabel: '始める',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '無制限',
            '65,000 / 月',
            '6,500 / 月',
            'メール',
          ],
          ctaLabel: '購入する',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '無制限',
            '650,000 / 月',
            '65,000 / 月',
            '優先',
          ],
          ctaLabel: '購入する',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: 'カスタム',
          period: '',
          features: [
            '無制限',
            '無制限',
            '無制限',
            '専任サポート & カスタム SLA',
          ],
          ctaLabel: 'お問い合わせ',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: 'もうすぐ公開です！現在は完全無料です。有料プランに達した場合も、十分なクレジットを提供しますので、安心してご利用ください！',
      contactMessage:
        'エンタープライズ向け料金、セキュリティレビュー、専任サポートのご相談はメールでご連絡ください。',
      contactCopyLabel: 'メールアドレスをコピー',
      contactCopiedMessage: 'メールアドレスをコピーしました。',
      contactCopyFailedMessage:
        'コピーに失敗しました。下記のメールアドレスをご利用ください。',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: 'OK',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'コントリビュート',
      security: 'セキュリティ',
      contact: 'お問い合わせ',
      poweredByLabel: 'TiDB Cloud で稼働',
      copyright: 'mem9.ai。AI エージェント向けの無制限メモリ基盤。',
    },
    aria: {
      home: 'mem9 ホーム',
      mainMenu: 'メインメニューを開く',
      changeLanguage: '言語を切り替える',
      changeTheme: 'テーマを切り替える',
      themeModeLight: 'テーマモード: ライト',
      themeModeDark: 'テーマモード: ダーク',
      themeModeSystem: 'テーマモード: システムに従う',
      copyOnboarding: '導入手順をコピー',
    },
    themeOptions: {
      light: 'ライト',
      dark: 'ダーク',
      system: 'システムに従う',
    },
    copyFeedback: {
      copied: '導入手順をコピーしました。',
      copyFailed: 'コピーに失敗しました。手動でコピーしてください。',
    },
    localeNames,
  },
  ko: {
    meta: {
      title: 'mem9 - OpenClaw를 위한 무제한 메모리 인프라',
      description:
        'mem9.ai는 OpenClaw를 위한 무제한 메모리 인프라입니다. 지속 리콜, 하이브리드 검색, 그리고 Dify, Claude Code, OpenCode, OpenClaw 및 커스텀 도구를 위한 멀티 에이전트 컨텍스트 공유를 제공합니다.',
    },
    nav: {
      home: '홈',
      features: '기능',
      platforms: '플랫폼',
      benchmark: '벤치마크',
      openclaw: 'OpenClaw',
      yourMemory: '당신의 기억',
      yourMemoryDescription: '시각적 메모리 관리',
      webConsole: 'Web Console',
      webConsoleDescription: '스페이스, 스페이스 체인, 사용량, 주문을 관리합니다.',
      login: '로그인',
      billing: '요금',
      security: '보안',
      faq: '자주 묻는 질문',
      github: 'GitHub',
      xcom: 'X.com',
      docs: '문서',
      mem9Docs: 'mem9 문서',
      consoleDocs: 'mem9 Console 문서',
      api: 'API',
      apiReferences: 'API 레퍼런스',
      releaseNotes: '릴리스 노트',
      contact: '문의하기',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '무제한 메모리',
      titleAccent: 'for AI agents',
      subtitle:
        '에이전트는 세션이 바뀔 때마다 모든 것을 잊습니다. mem9는 사용 중인 에이전트에 하이브리드 리콜과 시각적 대시보드를 갖춘 공유 메모리 레이어를 제공합니다.',
      guideSelector: {
        label: '에이전트 스택과 연동',
        items: guideSelectorItems,
      },
      onboardingLabel: 'OpenClaw에 설치',
      onboardingBadge: 'OpenClaw에 붙여넣기',
      onboardingHint:
        'OpenClaw가 자동으로 mem9를 설치하고 <strong>API Key</strong>를 발급합니다.',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'https://mem9.ai/SKILL.md 를 읽고 안내에 따라 OpenClaw용 mem9를 설치하고 설정하세요',
      onboardingCommandBeta:
        'https://mem9.ai/beta/SKILL.md 를 읽고 안내에 따라 OpenClaw용 mem9를 설치하고 설정하세요',
      betaFeature: {
        title: 'Context Engine 지원',
        description:
          '이제 최신 Context Engine을 지원하면서, mem9는 에이전트가 정말 중요한 내용을 기억하고 각 작업마다 꼭 맞는 메모리만 가져오도록 도와줍니다. 그 결과 사용자는 같은 내용을 덜 반복하게 되고, 응답은 더 정확해지며, 프롬프트는 더 간결하게 유지됩니다. 결국 더 빠르고 더 집중된 에이전트 경험을, 더 낮은 토큰 사용량과 불필요한 비용 감소와 함께 얻을 수 있습니다.',
      },
      highlights: [
        {
          title: '다시는 잊지 않습니다',
          description: '클라우드 영속 메모리가 리셋, 재시작, 기기 전환 이후에도 계속 남습니다.',
        },
        {
          title: '안전하게 백업됩니다',
          description: '에이전트 메모리는 취약한 로컬 파일이 아니라 내구성 있는 클라우드 스토리지에 저장됩니다.',
        },
        {
          title: '도입이 자연스럽습니다',
          description: '한 줄 지시로 시작하고, 기존 메모리도 흐름을 깨지 않고 옮길 수 있습니다.',
        },
      ],
    },
    trust: {
      title: '보안 및 개인정보 보호',
      body:
        'mem9는 프로덕션 사용을 위해 엔터프라이즈급 클라우드 인프라 위에 구축되었으며, 전송 중 및 저장 시 암호화, 접근 제어, 감사 가능성, 그리고 명확한 데이터 처리 경계를 갖추고 있습니다.',
      supporting: '보안 개요와 백서에서 더 자세히 확인할 수 있습니다.',
      overviewLabel: '보안 개요',
      whitePaperLabel: '보안 백서',
    },
    features: {
      kicker: '기능',
      title: '배선 작업 없는 영속 메모리',
      description:
        '데이터베이스, 벡터 스토어, 동기화 스크립트를 억지로 이어 붙이지 마세요. mem9는 저장, 검색, 공유를 하나의 메모리 레이어로 제공합니다.',
      items: [
        {
          icon: '01',
          title: '즉시 영속 스토리지',
          description:
            '몇 초 만에 내구성 있는 메모리 백엔드를 띄울 수 있습니다. 스키마 설계도, 제어 평면도, 운영도 필요 없습니다. 에이전트가 쓰면 mem9가 유지합니다.',
        },
        {
          icon: '02',
          title: '하이브리드 검색, 제로 설정',
          description:
            '키워드 검색은 바로 동작합니다. embeddings를 추가하면 mem9가 자동으로 벡터와 키워드 하이브리드 검색으로 확장하며, 재색인이나 파이프라인 변경이 필요 없습니다.',
        },
        {
          icon: '03',
          title: '에이전트를 따라가는 메모리',
          description:
            '탭을 닫고, 기기를 재시작하고, 다른 장치로 옮겨도 괜찮습니다. 에이전트 메모리는 클라우드에 남아 세션, 장치, 도구를 넘어서 따라옵니다.',
        },
        {
          icon: '04',
          title: '오픈소스, 셀프호스팅 가능',
          description:
            'Apache-2.0 Go 서버, TypeScript 플러그인, bash hooks를 제공합니다. 우리 클라우드에서도, 직접 운영하는 인프라에서도 실행할 수 있습니다.',
        },
      ],
    },
    platforms: {
      kicker: '플랫폼',
      title: '공유 메모리, 모든 에이전트 스택에',
      description:
        'mem9는 에이전트 런타임과 워크플로 플랫폼에 공유되고 지속적이며, 검색 가능하고 항상 동기화된 메모리를 제공합니다.',
      items: [
        {
          name: 'OpenClaw',
          desc: '메모리 플러그인',
          detail:
            '페이지 상단의 설치 명령어를 OpenClaw에 붙여넣으면 자동으로 설정됩니다.',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: '메모리 제공자',
          detail:
            '독립형 Hermes memory provider 플러그인을 설치하고 Hermes Agent에서 활성화합니다.',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: '후크와 스킬',
          detail:
            'Claude Code 플러그인 패키지로 mem9 후크를 통해 메모리를 저장하고 리콜합니다.',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            'OpenCode 설정에서 mem9 OpenCode 통합을 로드하고 같은 mem9 API를 공유합니다.',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: '관리형 후크',
          detail:
            'Codex 플러그인으로 mem9 기반의 관리형 후크와 프로젝트 재정의 설정을 설치합니다.',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: '에이전트 및 워크플로 플랫폼',
          detail:
            'Dify Agent 앱과 Workflow 앱에 mem9 도구를 추가하고 공유 공간 또는 노드별 API 키로 사용할 수 있습니다.',
          guideId: 'dify',
        },
        {
          name: '당신의 기억',
          desc: 'mem9.ai 공식 앱',
          detail:
            'mem9.ai 공식 인터페이스에서 당신의 memories 를 시각화해 관리하고, 분석하고, 가져오고 내보낼 수 있습니다.',
          badge: 'Beta',
        },
      ],
      ctaLabel: '당신의 기억 사용해보기',
      guideCtaLabel: '가이드 읽기',
      note:
        '커스텀 HTTP 클라이언트도 mem9 API 레이어를 통해 읽고 쓸 수 있으며 같은 메모리 공간을 공유합니다.',
    },
    benchmark: {
      kicker: '벤치마크',
      title: 'LoCoMo 벤치마크 결과',
      description: '멀티홉 추론, 싱글홉 리콜, 시간적 추론, 오픈도메인 QA, 적대적 견고성에 걸쳐 장문 대화 메모리 품질을 평가합니다.',
      model: 'qwen3.5-plus',
      modelLabel: '모델',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'F1 점수',
      llmLabel: 'LLM 점수',
      erLabel: '증거 재현율',
      categoryLabel: '카테고리',
      categories: [
        { name: '멀티홉 추론', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: '싱글홉 리콜', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: '시간적 추론', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: '오픈도메인 QA', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: '적대적 테스트', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark: 장문 대화 메모리 평가 프레임워크',
    },
    faq: faqCopyByLocale.ko,
    apiPage: apiPageByLocale.ko,
    releaseNotesPage: releaseNotesPageCopyByLocale.ko,
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'mem9의 데이터 처리, 암호화, 접근 제어, 운영 경계에 대한 접근 방식을 소개합니다.',
      },
      kicker: '보안',
      title: '보안 및 개인정보 보호',
      intro:
        'mem9는 지속형 클라우드 메모리의 이점을 제공하면서도 명확한 운영 경계와 강한 보안 기반을 유지하도록 설계되었습니다.',
      bridgeBody:
        '메모리는 에이전트 시스템에서 가장 먼저 마주하는 상태 문제입니다. 워크플로가 파일, 아티팩트, 검색까지 확장되면 drive9이 다음 레이어가 됩니다.',
      bridgeCtaLabel: 'drive9 살펴보기 \u2192',
      dataTitle: 'mem9의 데이터 처리 방식',
      dataBody:
        'mem9는 에이전트가 세션, 장치, 워크플로 전반에서 유용한 컨텍스트를 유지할 수 있도록 메모리 데이터를 저장합니다. 데이터 흐름은 이 역할에 맞춰 제한되며, 저장, 검색, 제공이라는 기능 주변에 명확한 데이터 처리 경계를 둡니다.',
      protectionsTitle: '핵심 보안 보호',
      protections: [
        {
          title: '전송 중 및 저장 시 암호화',
          description: '메모리 데이터는 네트워크 이동 중에도 저장 중에도 보호됩니다.',
        },
        {
          title: '접근 제어',
          description: '프로덕션 시스템과 데이터 접근은 필요한 시스템과 운영자로 제한됩니다.',
        },
        {
          title: '감사 가능성과 운영 가시성',
          description: '주요 작업은 추적하고 검토할 수 있도록 관찰 가능합니다.',
        },
        {
          title: '분리된 데이터 처리 경계',
          description: '메모리 처리는 불필요한 노출을 줄이기 위해 명확한 서비스 경계 안에서 이뤄집니다.',
        },
        {
          title: '프로덕션급 클라우드 인프라',
          description: '기반 플랫폼은 내구성, 신뢰성, 안정적인 운영을 목표로 구축됩니다.',
        },
      ],
      foundationTitle: '프로덕션급 클라우드 인프라 / 신뢰 기반',
      foundationBody:
        '기반 플랫폼은 내구성, 신뢰성, 안정적인 운영을 목표로 구축됩니다. 동시에 mem9는 그 뒤에서 성숙한 보안 관행, 통제, 운영 표준의 이점을 활용합니다.',
      learnMoreTitle: '더 알아보기',
      learnMoreBody: '자세한 내용은 보안 개요와 백서를 참고하세요.',
    },
    billing: {
      meta: {
        title: '요금 | mem9',
        description: 'mem9 요금제. 무료로 시작하고, 필요할 때 확장하세요.',
      },
      kicker: '요금',
      title: '간단하고 투명한 요금제',
      description: '무료로 시작하고, 필요할 때 확장하세요.',
      featureLabels: [
        '최종 사용자',
        '추가 요청',
        '검색 요청',
        '지원',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '무제한',
            '13,000 / 월',
            '1,300 / 월',
            '커뮤니티',
          ],
          ctaLabel: '시작하기',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 월',
          features: [
            '무제한',
            '65,000 / 월',
            '6,500 / 월',
            '이메일',
          ],
          ctaLabel: '구매하기',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 월',
          features: [
            '무제한',
            '650,000 / 월',
            '65,000 / 월',
            '우선',
          ],
          ctaLabel: '구매하기',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: '맞춤형',
          period: '',
          features: [
            '무제한',
            '무제한',
            '무제한',
            '전담 지원 & 맞춤 SLA',
          ],
          ctaLabel: '문의하기',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: '곧 출시됩니다! 현재 완전 무료입니다. 유료 요금제에 도달하더라도 충분한 크레딧을 드리니 안심하고 사용하세요!',
      contactMessage:
        '엔터프라이즈 요금, 보안 검토, 전담 지원이 필요하면 이메일로 문의해 주세요.',
      contactCopyLabel: '이메일 복사',
      contactCopiedMessage: '이메일 주소를 복사했습니다.',
      contactCopyFailedMessage:
        '복사에 실패했습니다. 아래 이메일 주소를 사용해 주세요.',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: '확인',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '기여하기',
      security: '보안',
      contact: '문의하기',
      poweredByLabel: 'TiDB Cloud 기반',
      copyright: 'mem9.ai. AI 에이전트를 위한 무제한 메모리 인프라.',
    },
    aria: {
      home: 'mem9 홈',
      mainMenu: '메인 메뉴 열기',
      changeLanguage: '언어 변경',
      changeTheme: '테마 변경',
      themeModeLight: '테마 모드: 라이트',
      themeModeDark: '테마 모드: 다크',
      themeModeSystem: '테마 모드: 시스템 따라가기',
      copyOnboarding: '온보딩 안내 복사',
    },
    themeOptions: {
      light: '라이트',
      dark: '다크',
      system: '시스템 따라가기',
    },
    copyFeedback: {
      copied: '온보딩 안내를 복사했습니다.',
      copyFailed: '복사에 실패했습니다. 직접 복사해 주세요.',
    },
    localeNames,
  },
  id: {
    meta: {
      title: 'mem9 - Infrastruktur memori tanpa batas untuk OpenClaw',
      description:
        'mem9.ai adalah infrastruktur memori tanpa batas untuk OpenClaw. Menyediakan recall persisten, pencarian hybrid, dan konteks multi-agent untuk Dify, Claude Code, OpenCode, OpenClaw, dan tool kustom.',
    },
    nav: {
      home: 'Beranda',
      features: 'Fitur',
      platforms: 'Platform',
      benchmark: 'Benchmark',
      openclaw: 'OpenClaw',
      yourMemory: 'Memori Anda',
      yourMemoryDescription: 'Manajemen memori visual',
      webConsole: 'Web Console',
      webConsoleDescription: 'Kelola space, rantai space, penggunaan, dan pesanan Anda.',
      login: 'Masuk',
      billing: 'Harga',
      security: 'Keamanan',
      faq: 'FAQ',
      github: 'GitHub',
      xcom: 'X.com',
      docs: 'Dokumentasi',
      mem9Docs: 'Dokumentasi mem9',
      consoleDocs: 'Dokumentasi mem9 Console',
      api: 'API',
      apiReferences: 'Referensi API',
      releaseNotes: 'Catatan Rilis',
      contact: 'Hubungi Kami',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Memori tanpa batas',
      titleAccent: 'untuk AI agents',
      subtitle:
        'Agent Anda melupakan semuanya di antara sesi. mem9 memberi agent yang Anda gunakan satu lapis memori bersama dengan recall hybrid dan dashboard visual.',
      guideSelector: {
        label: 'Bekerja dengan stack agent Anda',
        items: guideSelectorItems,
      },
      onboardingLabel: 'Instal untuk OpenClaw',
      onboardingBadge: 'Tempel di OpenClaw',
      onboardingHint:
        'OpenClaw akan otomatis menginstal mem9 dan menyediakan <strong>API Key</strong> untuk Anda.',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'Baca https://mem9.ai/SKILL.md lalu ikuti petunjuk untuk menginstal dan mengonfigurasi mem9 untuk OpenClaw',
      onboardingCommandBeta:
        'Baca https://mem9.ai/beta/SKILL.md lalu ikuti petunjuk untuk menginstal dan mengonfigurasi mem9 untuk OpenClaw',
      betaFeature: {
        title: 'Dukungan Context Engine',
        description:
          'Dengan dukungan terbaru untuk Context Engine, mem9 membantu agent Anda mengingat hal yang penting dan hanya membawa memori yang tepat untuk setiap tugas. Hasilnya, pengguna tidak perlu terlalu sering mengulang informasi, respons menjadi lebih akurat, dan prompt tetap ringkas. Dampaknya adalah pengalaman agent yang lebih cepat, lebih fokus, dengan penggunaan token yang lebih rendah dan biaya yang tidak terbuang.',
      },
      highlights: [
        {
          title: 'Tidak lupa lagi',
          description:
            'Memori persisten di cloud tetap bertahan setelah reset, restart, dan perpindahan perangkat.',
        },
        {
          title: 'Dicadangkan dengan aman',
          description:
            'Memori agent Anda disimpan di cloud storage yang tahan lama, bukan di file lokal yang rapuh.',
        },
        {
          title: 'Onboarding tanpa gesekan',
          description:
            'Mulai dengan satu instruksi, lalu pindahkan memori yang sudah ada tanpa merusak alur kerja Anda.',
        },
      ],
    },
    trust: {
      title: 'Keamanan & Privasi',
      body:
        'mem9 dibangun untuk penggunaan production di atas infrastruktur cloud kelas enterprise, dengan enkripsi saat transit dan saat tersimpan, kontrol akses, auditabilitas, dan batas penanganan data yang jelas.',
      supporting: 'Pelajari lebih lanjut di ringkasan keamanan dan white paper kami.',
      overviewLabel: 'Ringkasan Keamanan',
      whitePaperLabel: 'White Paper Keamanan',
    },
    features: {
      kicker: 'Fitur',
      title: 'Memori persisten, tanpa pekerjaan plumbing',
      description:
        'Berhenti menambal database, vector store, dan script sinkronisasi secara manual. mem9 memberi agent Anda satu lapisan memori untuk penyimpanan, pencarian, dan berbagi.',
      items: [
        {
          icon: '01',
          title: 'Penyimpanan persisten instan',
          description:
            'Bangun backend memori yang tahan lama dalam hitungan detik. Tanpa desain schema, tanpa control plane, tanpa ops. Agent Anda menulis, mem9 yang menyimpan.',
        },
        {
          icon: '02',
          title: 'Pencarian hybrid, tanpa konfigurasi',
          description:
            'Pencarian keyword langsung berjalan. Tambahkan embeddings dan mem9 otomatis meningkatkan menjadi pencarian vector plus keyword tanpa re-index dan tanpa perubahan pipeline.',
        },
        {
          icon: '03',
          title: 'Memori yang mengikuti agent Anda',
          description:
            'Tutup tab, restart mesin, ganti perangkat, tidak masalah. Memori agent Anda tetap ada di cloud dan mengikuti lintas sesi, mesin, dan tool.',
        },
        {
          icon: '04',
          title: 'Open source, bisa self-host',
          description:
            'Server Go Apache-2.0, plugin TypeScript, dan bash hooks. Jalankan di cloud kami atau di infrastruktur Anda sendiri.',
        },
      ],
    },
    platforms: {
      kicker: 'Platform',
      title: 'Memori bersama untuk setiap stack agent',
      description:
        'mem9 memberi runtime agent dan platform workflow Anda memori bersama yang persisten, dapat dicari, dan selalu sinkron.',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Plugin memori',
          detail:
            'Tempelkan perintah instal di bagian atas halaman ini ke OpenClaw, lalu ia akan menyiapkan semuanya secara otomatis.',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: 'Penyedia memori',
          detail:
            'Instal plugin Hermes memory provider mandiri, lalu aktifkan di Hermes Agent.',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'Kait dan kemampuan',
          detail:
            'Gunakan paket plugin Claude Code untuk menyimpan dan memanggil kembali memori melalui kait mem9.',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            'Muat integrasi mem9 OpenCode dari konfigurasi OpenCode Anda dan gunakan mem9 API yang sama.',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: 'Kait terkelola',
          detail:
            'Gunakan plugin Codex untuk memasang kait terkelola dan konfigurasi proyek yang didukung mem9.',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'Platform agent dan workflow',
          detail:
            'Tambahkan tool mem9 ke aplikasi Agent dan Workflow Dify, dengan satu ruang bersama atau API key per node.',
          guideId: 'dify',
        },
        {
          name: 'Memori Anda',
          desc: 'Aplikasi resmi mem9.ai',
          detail:
            'Visualisasikan, kelola, analisis, impor, dan ekspor memories Anda dari antarmuka resmi mem9.ai.',
          badge: 'Beta',
        },
      ],
      ctaLabel: 'Coba Memori Anda',
      guideCtaLabel: 'Baca panduan',
      note:
        'Client HTTP kustom juga bisa membaca dan menulis melalui layer mem9 API serta berbagi ruang memori yang sama.',
    },
    benchmark: {
      kicker: 'Benchmark',
      title: 'Hasil Benchmark LoCoMo',
      description: 'Mengevaluasi kualitas memori percakapan panjang meliputi penalaran multi-hop, recall single-hop, penalaran temporal, QA domain terbuka, dan ketahanan adversarial.',
      model: 'qwen3.5-plus',
      modelLabel: 'Model',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'Skor F1',
      llmLabel: 'Skor LLM',
      erLabel: 'Evidence Recall',
      categoryLabel: 'Kategori',
      categories: [
        { name: 'Penalaran Multi-hop', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: 'Recall Single-hop', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: 'Penalaran Temporal', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: 'QA Domain Terbuka', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: 'Adversarial', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark: Kerangka evaluasi memori percakapan panjang',
    },
    faq: faqCopyByLocale.id,
    apiPage: apiPageByLocale.id,
    releaseNotesPage: releaseNotesPageCopyByLocale.id,
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'Pelajari bagaimana mem9 menangani data, enkripsi, kontrol akses, dan batas operasional.',
      },
      kicker: 'Keamanan',
      title: 'Keamanan & Privasi',
      intro:
        'mem9 dirancang untuk memberi manfaat memori cloud persisten dengan batas operasional yang jelas dan fondasi keamanan yang kuat.',
      bridgeBody:
        'Memori sering kali menjadi masalah state pertama di sistem agent. Ketika alur kerja Anda meluas ke file, artefak, dan retrieval, drive9 menjadi lapisan berikutnya.',
      bridgeCtaLabel: 'Jelajahi drive9 \u2192',
      dataTitle: 'Bagaimana mem9 menangani data',
      dataBody:
        'mem9 menyimpan data memori untuk membantu agent mempertahankan konteks yang berguna di berbagai sesi, perangkat, dan alur kerja. Aliran data dibatasi pada fungsi utamanya: menyimpan, mengambil, dan menyajikan memori dengan batas penanganan data yang jelas untuk akses dan operasi.',
      protectionsTitle: 'Perlindungan keamanan inti',
      protections: [
        {
          title: 'Enkripsi saat transit dan saat tersimpan',
          description: 'Data memori dilindungi saat berpindah di jaringan maupun saat disimpan.',
        },
        {
          title: 'Kontrol akses',
          description: 'Akses ke sistem production dan data dibatasi pada sistem dan operator yang membutuhkannya.',
        },
        {
          title: 'Auditabilitas dan visibilitas operasional',
          description: 'Tindakan penting dapat diamati agar operasi bisa dilacak dan ditinjau.',
        },
        {
          title: 'Batas penanganan data yang terisolasi',
          description: 'Pemrosesan memori dibatasi ke batas layanan yang jelas untuk mengurangi paparan yang tidak perlu.',
        },
        {
          title: 'Infrastruktur cloud kelas production',
          description: 'Platform dasarnya dibangun untuk durabilitas, keandalan, dan operasi yang stabil.',
        },
      ],
      foundationTitle: 'Infrastruktur cloud kelas production / Fondasi kepercayaan',
      foundationBody:
        'Platform dasarnya dibangun untuk durabilitas, keandalan, dan operasi yang stabil. Pada saat yang sama, mem9 mendapat manfaat dari praktik keamanan yang matang, kontrol, dan standar operasional di balik layar.',
      learnMoreTitle: 'Pelajari lebih lanjut',
      learnMoreBody: 'Baca ringkasan keamanan dan white paper untuk detail tambahan.',
    },
    billing: {
      meta: {
        title: 'Harga | mem9',
        description: 'Paket harga mem9. Mulai gratis, skalakan sesuai kebutuhan.',
      },
      kicker: 'Harga',
      title: 'Harga yang sederhana dan transparan',
      description: 'Mulai gratis. Skalakan saat dibutuhkan.',
      featureLabels: [
        'Pengguna akhir',
        'Permintaan add',
        'Permintaan retrieval',
        'Dukungan',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            'Tanpa batas',
            '13.000 / bulan',
            '1.300 / bulan',
            'Komunitas',
          ],
          ctaLabel: 'Mulai',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / bln',
          features: [
            'Tanpa batas',
            '65.000 / bulan',
            '6.500 / bulan',
            'Email',
          ],
          ctaLabel: 'Beli Sekarang',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / bln',
          features: [
            'Tanpa batas',
            '650.000 / bulan',
            '65.000 / bulan',
            'Prioritas',
          ],
          ctaLabel: 'Beli Sekarang',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: 'Kustom',
          period: '',
          features: [
            'Tanpa batas',
            'Tanpa batas',
            'Tanpa batas',
            'Dukungan khusus & SLA kustom',
          ],
          ctaLabel: 'Hubungi Kami',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: 'Nantikan! Saat ini sepenuhnya gratis. Jika Anda mencapai tier berbayar, kami akan memberikan kredit yang cukup. Silakan gunakan dengan tenang!',
      contactMessage:
        'Untuk harga enterprise, review keamanan, dan dukungan khusus, hubungi kami lewat email.',
      contactCopyLabel: 'Salin Email',
      contactCopiedMessage: 'Alamat email disalin.',
      contactCopyFailedMessage:
        'Gagal menyalin. Gunakan alamat email di bawah ini.',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: 'OK',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'Berkontribusi',
      security: 'Keamanan',
      contact: 'Hubungi Kami',
      poweredByLabel: 'Didukung TiDB Cloud',
      copyright: 'mem9.ai. Infrastruktur memori tanpa batas untuk AI agents.',
    },
    aria: {
      home: 'beranda mem9',
      mainMenu: 'Buka menu utama',
      changeLanguage: 'Ganti bahasa',
      changeTheme: 'Ganti tema',
      themeModeLight: 'Mode tema: Terang',
      themeModeDark: 'Mode tema: Gelap',
      themeModeSystem: 'Mode tema: Ikuti sistem',
      copyOnboarding: 'Salin instruksi onboarding',
    },
    themeOptions: {
      light: 'Terang',
      dark: 'Gelap',
      system: 'Ikuti sistem',
    },
    copyFeedback: {
      copied: 'Instruksi onboarding disalin.',
      copyFailed: 'Gagal menyalin. Silakan salin manual.',
    },
    localeNames,
  },
  th: {
    meta: {
      title: 'mem9 - โครงสร้างพื้นฐานหน่วยความจำไม่จำกัดสำหรับ OpenClaw',
      description:
        'mem9.ai คือโครงสร้างพื้นฐานหน่วยความจำไม่จำกัดสำหรับ OpenClaw พร้อมการเรียกคืนแบบถาวร การค้นหาแบบ hybrid และบริบทแบบ multi-agent สำหรับ Dify, Claude Code, OpenCode, OpenClaw และเครื่องมือแบบกำหนดเอง',
    },
    nav: {
      home: 'หน้าแรก',
      features: 'ความสามารถ',
      platforms: 'แพลตฟอร์ม',
      benchmark: 'เบนช์มาร์ก',
      openclaw: 'OpenClaw',
      yourMemory: 'ความทรงจำของคุณ',
      yourMemoryDescription: 'การจัดการหน่วยความจำแบบภาพ',
      webConsole: 'Web Console',
      webConsoleDescription: 'จัดการพื้นที่ เชนพื้นที่ การใช้งาน และคำสั่งซื้อของคุณ',
      login: 'ล็อกอิน',
      billing: 'ราคา',
      security: 'ความปลอดภัย',
      faq: 'คำถามที่พบบ่อย',
      github: 'GitHub',
      xcom: 'X.com',
      docs: 'เอกสาร',
      mem9Docs: 'เอกสาร mem9',
      consoleDocs: 'เอกสาร mem9 Console',
      api: 'API',
      apiReferences: 'เอกสารอ้างอิง API',
      releaseNotes: 'บันทึกการเผยแพร่',
      contact: 'ติดต่อเรา',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'หน่วยความจำไม่จำกัด',
      titleAccent: 'สำหรับ AI agents',
      subtitle:
        'เอเจนต์ของคุณลืมทุกอย่างระหว่างแต่ละเซสชัน mem9 มอบเลเยอร์หน่วยความจำที่แชร์ร่วมกันให้กับเอเจนต์ที่คุณใช้งาน พร้อมการค้นคืนแบบ hybrid และแดชบอร์ดแบบภาพ',
      guideSelector: {
        label: 'ใช้งานได้กับสแตกเอเจนต์ของคุณ',
        items: guideSelectorItems,
      },
      onboardingLabel: 'ติดตั้งสำหรับ OpenClaw',
      onboardingBadge: 'วางใน OpenClaw',
      onboardingHint:
        'OpenClaw จะติดตั้ง mem9 และออก <strong>API Key</strong> ให้คุณโดยอัตโนมัติ',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'อ่าน https://mem9.ai/SKILL.md แล้วทำตามขั้นตอนเพื่อติดตั้งและตั้งค่า mem9 สำหรับ OpenClaw',
      onboardingCommandBeta:
        'อ่าน https://mem9.ai/beta/SKILL.md แล้วทำตามขั้นตอนเพื่อติดตั้งและตั้งค่า mem9 สำหรับ OpenClaw',
      betaFeature: {
        title: 'รองรับ Context Engine',
        description:
          'ตอนนี้ mem9 รองรับ Context Engine รุ่นล่าสุดแล้ว ช่วยให้เอเจนต์ของคุณจำสิ่งที่สำคัญ และดึงเข้ามาเฉพาะหน่วยความจำที่เหมาะกับแต่ละงานเท่านั้น ผู้ใช้จึงไม่ต้องพูดซ้ำบ่อย คำตอบแม่นยำขึ้น และ prompt ก็ยังคงกระชับ ผลลัพธ์คือประสบการณ์เอเจนต์ที่เร็วขึ้น โฟกัสมากขึ้น ใช้โทเค็นน้อยลง และลดค่าใช้จ่ายที่สูญเปล่า。',
      },
      highlights: [
        {
          title: 'ไม่ลืมอีกต่อไป',
          description:
            'หน่วยความจำแบบถาวรบนคลาวด์ยังคงอยู่ต่อแม้รีเซ็ต รีสตาร์ต หรือสลับอุปกรณ์',
        },
        {
          title: 'สำรองอย่างปลอดภัย',
          description:
            'หน่วยความจำของเอเจนต์ถูกเก็บไว้ในคลาวด์สตอเรจที่ทนทาน ไม่ใช่ไฟล์โลคัลที่เปราะบาง',
        },
        {
          title: 'เริ่มใช้งานลื่นไหล',
          description:
            'เริ่มต้นด้วยคำสั่งเดียว แล้วค่อยย้ายหน่วยความจำเดิมเข้ามาโดยไม่ทำลาย flow การทำงาน',
        },
      ],
    },
    trust: {
      title: 'ความปลอดภัยและความเป็นส่วนตัว',
      body:
        'mem9 ถูกสร้างมาสำหรับการใช้งานระดับ production บนโครงสร้างพื้นฐานคลาวด์ระดับ enterprise พร้อมการเข้ารหัสระหว่างส่งและขณะจัดเก็บ การควบคุมสิทธิ์ การตรวจสอบย้อนหลังได้ และขอบเขตการจัดการข้อมูลที่ชัดเจน',
      supporting: 'ดูรายละเอียดเพิ่มเติมได้ในภาพรวมด้านความปลอดภัยและ white paper ของเรา',
      overviewLabel: 'ภาพรวมด้านความปลอดภัย',
      whitePaperLabel: 'Security White Paper',
    },
    features: {
      kicker: 'ความสามารถ',
      title: 'หน่วยความจำถาวร โดยไม่ต้องต่อ plumbing เอง',
      description:
        'เลิกเอาฐานข้อมูล vector store และสคริปต์ซิงก์มาผูกกันเอง mem9 ให้เอเจนต์ของคุณมี memory layer เดียวสำหรับการเก็บ ค้นหา และแชร์',
      items: [
        {
          icon: '01',
          title: 'สตอเรจถาวรพร้อมใช้ทันที',
          description:
            'เปิดใช้ backend สำหรับหน่วยความจำที่ทนทานได้ภายในไม่กี่วินาที ไม่ต้องออกแบบ schema ไม่ต้องมี control plane ไม่ต้องดูแล ops เอเจนต์ของคุณเขียน ส่วน mem9 จะเก็บไว้ให้',
        },
        {
          icon: '02',
          title: 'ค้นหาแบบ hybrid โดยไม่ต้องตั้งค่า',
          description:
            'การค้นหาด้วยคีย์เวิร์ดใช้ได้ทันที เพิ่ม embeddings แล้ว mem9 จะอัปเกรดเป็น vector plus keyword search โดยอัตโนมัติ ไม่ต้อง re-index และไม่ต้องแก้ pipeline',
        },
        {
          icon: '03',
          title: 'หน่วยความจำที่ตามเอเจนต์ไปทุกที่',
          description:
            'ปิดแท็บ รีสตาร์ตเครื่อง หรือเปลี่ยนอุปกรณ์ก็ไม่เป็นไร หน่วยความจำของเอเจนต์ยังอยู่บนคลาวด์และตามไปข้ามเซสชัน เครื่อง และเครื่องมือ',
        },
        {
          icon: '04',
          title: 'โอเพนซอร์สและ self-host ได้',
          description:
            'มีทั้งเซิร์ฟเวอร์ Go แบบ Apache-2.0 ปลั๊กอิน TypeScript และ bash hooks จะรันบนคลาวด์ของเราหรือบนโครงสร้างพื้นฐานของคุณเองก็ได้',
        },
      ],
    },
    platforms: {
      kicker: 'แพลตฟอร์ม',
      title: 'หน่วยความจำร่วมสำหรับทุกสแตกเอเจนต์',
      description:
        'mem9 ทำให้ runtime ของเอเจนต์และแพลตฟอร์มเวิร์กโฟลว์ของคุณมีหน่วยความจำร่วมกันแบบถาวร ค้นหาได้ และซิงก์กันเสมอ',
      items: [
        {
          name: 'OpenClaw',
          desc: 'ปลั๊กอินหน่วยความจำ',
          detail:
            'วางคำสั่งติดตั้งจากด้านบนของหน้านี้ลงใน OpenClaw แล้วระบบจะตั้งค่าให้อัตโนมัติ',
          guideId: 'openclaw',
        },
        {
          name: 'Hermes Agent',
          desc: 'ผู้ให้บริการหน่วยความจำ',
          detail:
            'ติดตั้งปลั๊กอิน Hermes memory provider แบบ standalone แล้วเปิดใช้งานใน Hermes Agent',
          guideId: 'hermes',
        },
        {
          name: 'Claude Code',
          desc: 'ฮุกและทักษะ',
          detail:
            'ใช้แพ็กเกจปลั๊กอิน Claude Code เพื่อบันทึกและเรียกคืนหน่วยความจำผ่านฮุกของ mem9',
          guideId: 'claude',
        },
        {
          name: 'OpenCode',
          desc: 'Plugin SDK',
          detail:
            'โหลดการเชื่อมต่อ mem9 OpenCode จาก config ของ OpenCode แล้วใช้ mem9 API ชุดเดียวกัน',
          guideId: 'opencode',
        },
        {
          name: 'Codex',
          desc: 'ฮุกแบบจัดการ',
          detail:
            'ใช้ปลั๊กอิน Codex เพื่อติดตั้งฮุกแบบจัดการและการตั้งค่าระดับโปรเจกต์ที่ใช้ mem9 เป็นฐาน',
          guideId: 'codex',
        },
        {
          name: 'Dify',
          desc: 'แพลตฟอร์มเอเจนต์และเวิร์กโฟลว์',
          detail:
            'เพิ่มเครื่องมือ mem9 ให้แอป Agent และ Workflow ของ Dify พร้อมใช้พื้นที่ร่วมกันหรือ API key แยกตามโหนด',
          guideId: 'dify',
        },
        {
          name: 'ความทรงจำของคุณ',
          desc: 'แอปทางการของ mem9.ai',
          detail:
            'ดูภาพรวม จัดการ วิเคราะห์ นำเข้า และส่งออก memories ของคุณผ่านอินเทอร์เฟซทางการของ mem9.ai',
          badge: 'Beta',
        },
      ],
      ctaLabel: 'ลองใช้ความทรงจำของคุณ',
      guideCtaLabel: 'อ่านคู่มือ',
      note:
        'HTTP client แบบกำหนดเองก็อ่านและเขียนผ่านเลเยอร์ mem9 API ได้ และแชร์พื้นที่หน่วยความจำเดียวกัน',
    },
    benchmark: {
      kicker: 'เบนช์มาร์ก',
      title: 'ผลลัพธ์เบนช์มาร์ก LoCoMo',
      description: 'ประเมินคุณภาพหน่วยความจำการสนทนายาวครอบคลุมการอนุมานหลายขั้น การเรียกคืนขั้นเดียว การอนุมานเชิงเวลา QA โดเมนเปิด และความทนทานต่อการโจมตี',
      model: 'qwen3.5-plus',
      modelLabel: 'โมเดล',
      overallF1: '58.84%',
      overallLLM: '71.95%',
      overallER: '53.76%',
      f1Label: 'คะแนน F1',
      llmLabel: 'คะแนน LLM',
      erLabel: 'Evidence Recall',
      categoryLabel: 'หมวดหมู่',
      categories: [
        { name: 'การอนุมานหลายขั้น', f1: '22.60%', llm: '53.90%', er: '25.1%' },
        { name: 'การเรียกคืนขั้นเดียว', f1: '58.18%', llm: '76.01%', er: '67.8%' },
        { name: 'การอนุมานเชิงเวลา', f1: '13.79%', llm: '44.79%', er: '18.6%' },
        { name: 'QA โดเมนเปิด', f1: '56.57%', llm: '79.55%', er: '60.1%' },
        { name: 'การทดสอบเชิงรุก', f1: '96.19%', llm: 'N/A', er: '57.1%' },
      ],
      source: 'LoCoMo Benchmark: เฟรมเวิร์กประเมินหน่วยความจำการสนทนายาว',
    },
    faq: faqCopyByLocale.th,
    apiPage: apiPageByLocale.th,
    releaseNotesPage: releaseNotesPageCopyByLocale.th,
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'ดูว่า mem9 จัดการข้อมูล การเข้ารหัส การควบคุมสิทธิ์ และขอบเขตการปฏิบัติงานอย่างไร',
      },
      kicker: 'ความปลอดภัย',
      title: 'ความปลอดภัยและความเป็นส่วนตัว',
      intro:
        'mem9 ถูกออกแบบมาเพื่อให้ได้ประโยชน์จาก cloud memory แบบถาวร พร้อมขอบเขตการปฏิบัติงานที่ชัดเจนและรากฐานด้านความปลอดภัยที่แข็งแรง',
      bridgeBody:
        'หน่วยความจำมักเป็นปัญหา state แรกของระบบเอเจนต์ เมื่อเวิร์กโฟลว์ของคุณขยายไปที่ไฟล์ อาร์ติแฟกต์ และการค้นคืน drive9 จะกลายเป็นเลเยอร์ถัดไป',
      bridgeCtaLabel: 'สำรวจ drive9 \u2192',
      dataTitle: 'mem9 จัดการข้อมูลอย่างไร',
      dataBody:
        'mem9 จัดเก็บข้อมูลหน่วยความจำเพื่อช่วยให้เอเจนต์รักษาบริบทที่มีประโยชน์ไว้ได้ข้ามเซสชัน อุปกรณ์ และเวิร์กโฟลว์ การไหลของข้อมูลถูกจำกัดให้อยู่ในหน้าที่หลักของผลิตภัณฑ์ คือการจัดเก็บ ค้นคืน และให้บริการหน่วยความจำ พร้อมขอบเขตการจัดการข้อมูลที่ชัดเจนสำหรับการเข้าถึงและการปฏิบัติงาน',
      protectionsTitle: 'มาตรการป้องกันด้านความปลอดภัยหลัก',
      protections: [
        {
          title: 'การเข้ารหัสระหว่างส่งและขณะจัดเก็บ',
          description: 'ข้อมูลหน่วยความจำได้รับการปกป้องทั้งขณะส่งผ่านเครือข่ายและขณะจัดเก็บ',
        },
        {
          title: 'การควบคุมสิทธิ์',
          description: 'การเข้าถึงระบบ production และข้อมูลถูกจำกัดเฉพาะระบบและผู้ปฏิบัติงานที่จำเป็น',
        },
        {
          title: 'การตรวจสอบย้อนหลังและการมองเห็นเชิงปฏิบัติการ',
          description: 'การดำเนินการสำคัญสามารถตรวจสอบและทบทวนย้อนหลังได้',
        },
        {
          title: 'ขอบเขตการจัดการข้อมูลที่แยกชัดเจน',
          description: 'การประมวลผลหน่วยความจำถูกจำกัดภายในขอบเขตบริการที่ชัดเจนเพื่อลดการเปิดเผยโดยไม่จำเป็น',
        },
        {
          title: 'โครงสร้างพื้นฐานคลาวด์ระดับ production',
          description: 'แพลตฟอร์มพื้นฐานถูกสร้างเพื่อความทนทาน ความน่าเชื่อถือ และการปฏิบัติงานที่เสถียร',
        },
      ],
      foundationTitle: 'โครงสร้างพื้นฐานคลาวด์ระดับ production / รากฐานของความไว้วางใจ',
      foundationBody:
        'แพลตฟอร์มพื้นฐานถูกสร้างเพื่อความทนทาน ความน่าเชื่อถือ และการปฏิบัติงานที่เสถียร ขณะเดียวกัน mem9 ก็ได้ประโยชน์จากแนวปฏิบัติด้านความปลอดภัย มาตรการควบคุม และมาตรฐานการปฏิบัติงานที่เป็นผู้ใหญ่ในเบื้องหลัง',
      learnMoreTitle: 'ดูเพิ่มเติม',
      learnMoreBody: 'อ่านภาพรวมด้านความปลอดภัยและ white paper เพื่อดูรายละเอียดเพิ่มเติม',
    },
    billing: {
      meta: {
        title: 'ราคา | mem9',
        description: 'แพ็กเกจราคา mem9 เริ่มต้นฟรี ขยายตามความต้องการ',
      },
      kicker: 'ราคา',
      title: 'ราคาที่เรียบง่ายและโปร่งใส',
      description: 'เริ่มต้นฟรี ขยายเมื่อคุณต้องการ',
      featureLabels: [
        'ผู้ใช้ปลายทาง',
        'Add requests',
        'Retrieval requests',
        'การสนับสนุน',
      ],
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            'ไม่จำกัด',
            '13,000 / เดือน',
            '1,300 / เดือน',
            'ชุมชน',
          ],
          ctaLabel: 'เริ่มใช้งาน',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / เดือน',
          features: [
            'ไม่จำกัด',
            '65,000 / เดือน',
            '6,500 / เดือน',
            'อีเมล',
          ],
          ctaLabel: 'ซื้อเลย',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / เดือน',
          features: [
            'ไม่จำกัด',
            '650,000 / เดือน',
            '65,000 / เดือน',
            'เร่งด่วน',
          ],
          ctaLabel: 'ซื้อเลย',
          ctaAction: 'alert',
          highlighted: true,
        },
        {
          name: 'Enterprise',
          price: 'กำหนดเอง',
          period: '',
          features: [
            'ไม่จำกัด',
            'ไม่จำกัด',
            'ไม่จำกัด',
            'สนับสนุนเฉพาะ & SLA กำหนดเอง',
          ],
          ctaLabel: 'ติดต่อเรา',
          ctaAction: 'mailto',
        },
      ],
      alertMessage: 'โปรดรอติดตาม! ขณะนี้ใช้งานได้ฟรีทั้งหมด หากคุณถึงแพ็กเกจที่ต้องชำระเงิน เราจะให้เครดิตที่เพียงพอ ใช้งานได้อย่างสบายใจ!',
      contactMessage:
        'หากต้องการสอบถามราคาแบบองค์กร การตรวจสอบความปลอดภัย หรือการสนับสนุนเฉพาะ โปรดติดต่อเราทางอีเมล',
      contactCopyLabel: 'คัดลอกอีเมล',
      contactCopiedMessage: 'คัดลอกที่อยู่อีเมลแล้ว',
      contactCopyFailedMessage:
        'คัดลอกไม่สำเร็จ โปรดใช้อีเมลด้านล่าง',
      contactEmail: 'mem9@pingcap.com',
      modalOkLabel: 'ตกลง',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'ร่วมพัฒนา',
      security: 'ความปลอดภัย',
      contact: 'ติดต่อเรา',
      poweredByLabel: 'ขับเคลื่อนโดย TiDB Cloud',
      copyright: 'mem9.ai โครงสร้างพื้นฐานหน่วยความจำไม่จำกัดสำหรับ AI agents',
    },
    aria: {
      home: 'หน้าแรก mem9',
      mainMenu: 'เปิดเมนูหลัก',
      changeLanguage: 'เปลี่ยนภาษา',
      changeTheme: 'เปลี่ยนธีม',
      themeModeLight: 'โหมดธีม: สว่าง',
      themeModeDark: 'โหมดธีม: มืด',
      themeModeSystem: 'โหมดธีม: ตามระบบ',
      copyOnboarding: 'คัดลอกคำแนะนำการตั้งค่า',
    },
    themeOptions: {
      light: 'สว่าง',
      dark: 'มืด',
      system: 'ตามระบบ',
    },
    copyFeedback: {
      copied: 'คัดลอกคำแนะนำการตั้งค่าแล้ว',
      copyFailed: 'คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง',
    },
    localeNames,
  },
};

export function isSiteLocale(value: string | null | undefined): value is SiteLocale {
  return (
    value === 'en' ||
    value === 'zh' ||
    value === 'zh-Hant' ||
    value === 'ja' ||
    value === 'ko' ||
    value === 'id' ||
    value === 'th'
  );
}

export function isSiteThemePreference(
  value: string | null | undefined,
): value is SiteThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isSiteResolvedTheme(
  value: string | null | undefined,
): value is SiteResolvedTheme {
  return value === 'light' || value === 'dark';
}
