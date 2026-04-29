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
  billing: string;
  security: string;
  faq: string;
  github: string;
  docs: string;
  api: string;
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
  poweredByLabel?: string;
  guideSelector?: SiteHeroGuideSelectorCopy;
  onboardingLabel: string;
  onboardingBadge: string;
  onboardingHint: string;
  onboardingStableLabel: string;
  onboardingBetaLabel: string;
  onboardingCommandStable: string;
  onboardingCommandBeta: string;
  substrateCtaLabel?: string;
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
  copyright: string;
}

export interface SiteAriaCopy {
  home: string;
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
const healthCheckCode = 'curl -s https://api.mem9.ai/healthz';
const createMemoryCode = `curl -sX POST "$API/memories" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Mnemo-Agent-Id: openclaw-main" \\
  -d '{"content":"Project uses PostgreSQL 15","tags":["tech","database"],"metadata":{"source":"setup-note"}}'`;
const listMemoryCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/memories?q=postgres&limit=5"';
const filterMemoryCode =
  'curl -s -H "X-API-Key: $API_KEY" "$API/memories?tags=tech&source=openclaw-main&limit=10"';
const getMemoryCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/memories/{id}"';
const updateMemoryCode = `curl -sX PUT "$API/memories/{id}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -H "If-Match: 3" \\
  -d '{"content":"Project uses PostgreSQL 16","tags":["tech","database"]}'`;
const deleteMemoryCode = 'curl -sX DELETE -H "X-API-Key: $API_KEY" "$API/memories/{id}"';
const importMemoryFileCode = `curl -sX POST "$API/imports" \\
  -H "X-API-Key: $API_KEY" \\
  -F "file=@memory.json" \\
  -F "file_type=memory" \\
  -F "agent_id=openclaw-main"`;
const importSessionFileCode = `curl -sX POST "$API/imports" \\
  -H "X-API-Key: $API_KEY" \\
  -F "file=@session.json" \\
  -F "file_type=session" \\
  -F "session_id=ses-001" \\
  -F "agent_id=openclaw-main"`;
const listImportsCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/imports"';
const getImportCode = 'curl -s -H "X-API-Key: $API_KEY" "$API/imports/{id}"';
const sessionMessagesCode =
  'curl -s -H "X-API-Key: $API_KEY" "$API/session-messages?session_id=ses-001&session_id=ses-002&limit_per_session=20"';

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
  { name: 'X-API-Key', description: 'Hosted API key for your mem9 space.', required: true },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const hostedJSONWriteHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'Hosted API key for your mem9 space.', required: true },
  { name: 'Content-Type', description: 'Set to `application/json` for JSON request bodies.', required: true },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const hostedUpdateHeaders: SiteApiFieldCopy[] = [
  ...hostedJSONWriteHeaders,
  { name: 'If-Match', description: 'Optional version guard for optimistic updates.' },
];

const hostedMultipartHeaders: SiteApiFieldCopy[] = [
  { name: 'X-API-Key', description: 'Hosted API key for your mem9 space.', required: true },
  {
    name: 'Content-Type',
    description: 'Your HTTP client sends this as `multipart/form-data`.',
    required: true,
  },
  { name: 'X-Mnemo-Agent-Id', description: 'Optional agent identity header for attribution.' },
];

const memoryCreateBodyFields: SiteApiFieldCopy[] = [
  { name: 'content', description: 'Plain memory content for direct writes.' },
  { name: 'messages', description: 'Conversation messages for ingest-based writes.' },
  { name: 'agent_id', description: 'Optional agent id to store with the write.' },
  { name: 'session_id', description: 'Optional session id for ingest or attribution.' },
  { name: 'tags', description: 'Optional string tags stored on the memory.' },
  { name: 'metadata', description: 'Optional JSON metadata payload.' },
  { name: 'mode', description: 'Ingest mode such as `smart` or `raw` when using `messages`.' },
  { name: 'sync', description: 'When true, wait for completion before returning.' },
];

const memoryListQueryParams: SiteApiFieldCopy[] = [
  { name: 'q', description: 'Semantic / keyword search query.' },
  { name: 'tags', description: 'Comma-separated tag filter.' },
  { name: 'source', description: 'Filter by stored source value.' },
  { name: 'state', description: 'Filter by lifecycle state such as `active` or `archived`.' },
  { name: 'memory_type', description: 'Filter by `insight`, `pinned`, or `session`.' },
  { name: 'agent_id', description: 'Filter by agent id.' },
  { name: 'session_id', description: 'Filter by session id.' },
  { name: 'limit', description: 'Page size. The handler caps large values.' },
  { name: 'offset', description: 'Offset for pagination.' },
];

const memoryUpdateBodyFields: SiteApiFieldCopy[] = [
  { name: 'content', description: 'Updated memory content.' },
  { name: 'tags', description: 'Updated tag array.' },
  { name: 'metadata', description: 'Updated JSON metadata payload.' },
];

const importBodyFields: SiteApiFieldCopy[] = [
  { name: 'file', description: 'Uploaded file payload.', required: true },
  { name: 'file_type', description: 'Use `memory` or `session`.', required: true },
  { name: 'agent_id', description: 'Optional agent id for attribution.' },
  { name: 'session_id', description: 'Required when uploading `session` files.' },
];

const sessionMessagesQueryParams: SiteApiFieldCopy[] = [
  { name: 'session_id', description: 'Repeat this query param for each session to fetch.', required: true },
  { name: 'limit_per_session', description: 'Optional per-session row limit.' },
];

const provisionResponseFields: SiteApiFieldCopy[] = [
  { name: 'id', description: 'The newly provisioned mem9 API key / space identifier.', required: true },
];

const healthResponseFields: SiteApiFieldCopy[] = [
  { name: 'status', description: 'Health status string. Hosted service returns `ok`.', required: true },
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
  { name: 'state', description: 'Lifecycle state.', required: true },
  { name: 'version', description: 'Current integer version.', required: true },
  { name: 'created_at', description: 'Creation timestamp.', required: true },
  { name: 'updated_at', description: 'Last update timestamp.', required: true },
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
  { name: 'limit_per_session', description: 'Applied per-session limit.', required: true },
];

const apiPageByLocale: Record<SiteLocale, SiteApiPageCopy> = {
  en: {
    meta: {
      title: 'mem9 API | Hosted API Reference',
      description:
        'Reference for provisioning API keys, reading and writing memories, importing files, and querying session messages on the hosted mem9 API.',
    },
    kicker: 'API',
    title: 'Hosted mem9 API reference',
    intro:
      'Use the hosted mem9 API to provision a space, write or search memory, import existing files, and inspect captured session messages.',
    summary:
      'Prefer `v1alpha2` for day-to-day usage. `v1alpha1` stays available for key provisioning and tenant-scoped compatibility.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response',
      examples: 'Examples',
      required: 'Required',
      next: 'Next',
      sidebarTitle: 'On this page',
      sidebarAuth: 'Authentication',
      sidebarQuickstart: 'Quick Start',
    },
    authTitle: 'Base URL & authentication',
    authCards: [
      {
        title: 'Hosted base URL',
        body: 'Use `https://api.mem9.ai`. For normal client traffic, send requests to `https://api.mem9.ai/v1alpha2/mem9s/...`.',
      },
      {
        title: 'Primary auth header',
        body: 'Send your mem9 API key in `X-API-Key`. This is the default hosted auth model for `v1alpha2`.',
      },
      {
        title: 'Optional agent identity',
        body: 'Send `X-Mnemo-Agent-Id` when you want writes and imports attributed to a specific agent. Legacy tenant-scoped routes still exist under `v1alpha1`.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription:
      'A minimal hosted flow is: provision a key, export it into your shell, then create and search memories.',
    quickstartSteps: [
      'Provision a new API key with `POST /v1alpha1/mem9s`.',
      'Export that key as `API_KEY` and set `API=https://api.mem9.ai/v1alpha2/mem9s`.',
      'Create a memory with `POST /memories`.',
      'Search it back with `GET /memories?q=...`.',
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
        description: 'Create the initial key you will reuse for hosted mem9 access.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: 'Provision a new mem9 API key.',
            description:
              'No auth or request body is required. The hosted service returns `201` with an `id` field, and that `id` is the key you store and reuse.',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Provision key', code: provisionKeyCode }],
          },
        ],
      },
      {
        id: 'memories',
        title: 'Memories',
        description: 'Create, search, read, update, and delete stored memories in your mem9 space.',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: 'Create a memory or ingest messages.',
            description:
              'Use `content` for direct writes or `messages` for ingest-driven writes. Do not send both in the same request.',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [{ label: 'Create memory', code: createMemoryCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: 'List or search memories.',
            description:
              'When `q` is present, the handler runs recall search. Without `q`, the endpoint behaves like a filtered list API.',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: 'Search memories', code: listMemoryCode },
              { label: 'Filter by tags / source', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: 'Read one memory by id.',
            description: 'Fetch a single stored memory object from the hosted service.',
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
        ],
      },
      {
        id: 'imports',
        title: 'Imports',
        description: 'Upload memory or session files and poll their background task status.',
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
        description: 'Inspect raw captured conversation rows that were stored during ingest.',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: 'List session messages by session id.',
            description:
              'Repeat `session_id` in the query string for each session you want to fetch. Use `limit_per_session` to cap rows per session.',
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
          'Use `/healthz` for liveness checks. Legacy tenant-scoped routes still exist under `/v1alpha1/mem9s/{tenantID}/...`, but hosted clients should prefer `v1alpha2` plus `X-API-Key`.',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: 'Check service health.',
            description: 'Useful before onboarding or when debugging network reachability.',
            responseFields: healthResponseFields,
            examples: [{ label: 'Health check', code: healthCheckCode }],
          },
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
      title: 'mem9 API | Hosted API 文档',
      description: '查看如何创建 API key、读写记忆、上传文件，以及查询 hosted mem9 API 的 session messages。',
    },
    kicker: 'API',
    title: 'Hosted mem9 API 文档',
    intro: '使用 hosted mem9 API 创建 space、写入或搜索记忆、导入已有文件，并查看捕获到的 session messages。',
    summary: '日常调用优先使用 `v1alpha2`。`v1alpha1` 继续保留给 key provision 和 tenant-scoped 兼容路径。',
    labels: {
      headers: '请求头',
      queryParams: '查询参数',
      body: '请求体',
      response: '响应',
      examples: '示例',
      required: '必填',
      next: '下一步',
      sidebarTitle: '本页目录',
      sidebarAuth: '认证',
      sidebarQuickstart: '快速开始',
    },
    authTitle: 'Base URL 与认证方式',
    authCards: [
      {
        title: 'Hosted base URL',
        body: '使用 `https://api.mem9.ai`。正常客户端请求应发送到 `https://api.mem9.ai/v1alpha2/mem9s/...`。',
      },
      {
        title: '主认证 header',
        body: '把 mem9 API key 放进 `X-API-Key`。这是 `v1alpha2` 的默认 hosted 认证模型。',
      },
      {
        title: '可选的 agent 身份',
        body: '当你希望写入或导入归属到某个 agent 时，再额外发送 `X-Mnemo-Agent-Id`。旧的 tenant-scoped 路由仍保留在 `v1alpha1` 下。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小 hosted 流程是：先 provision 一个 key，把它导出到 shell，然后创建并搜索记忆。',
    quickstartSteps: [
      '通过 `POST /v1alpha1/mem9s` 创建新的 API key。',
      '把该 key 导出成 `API_KEY`，并设置 `API=https://api.mem9.ai/v1alpha2/mem9s`。',
      '用 `POST /memories` 写入一条记忆。',
      '再用 `GET /memories?q=...` 搜回来。',
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
        description: '创建你后续会重复使用的 hosted mem9 访问 key。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha1/mem9s',
            summary: '创建新的 mem9 API key。',
            description: '不需要认证，也不需要请求体。hosted 服务会返回 `201` 和一个 `id` 字段，这个 `id` 就是你要保存和复用的 key。',
            responseFields: provisionResponseFields,
            examples: [{ label: '创建 key', code: provisionKeyCode }],
          },
        ],
      },
      {
        id: 'memories',
        title: 'Memories',
        description: '在你的 mem9 space 中创建、搜索、读取、更新和删除记忆。',
        endpoints: [
          {
            method: 'POST',
            path: '/v1alpha2/mem9s/memories',
            summary: '创建记忆或执行 message ingest。',
            description: '直接写入时使用 `content`；走 ingest 时使用 `messages`。同一个请求里不要同时发送这两个字段。',
            headers: hostedJSONWriteHeaders,
            bodyFields: memoryCreateBodyFields,
            responseFields: statusOnlyResponseFields,
            examples: [{ label: '创建记忆', code: createMemoryCode }],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories',
            summary: '列出或搜索记忆。',
            description: '带 `q` 时走 recall search；不带 `q` 时更像一个带过滤条件的列表接口。',
            headers: hostedReadHeaders,
            queryParams: memoryListQueryParams,
            responseFields: memoryListResponseFields,
            examples: [
              { label: '搜索记忆', code: listMemoryCode },
              { label: '按标签 / source 过滤', code: filterMemoryCode },
            ],
          },
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/memories/{id}',
            summary: '按 id 读取单条记忆。',
            description: '从 hosted 服务里拉取一条完整的记忆对象。',
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
        ],
      },
      {
        id: 'imports',
        title: 'Imports',
        description: '上传 memory / session 文件，并轮询后台任务状态。',
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
        description: '查看在 ingest 过程中被保存下来的原始对话消息。',
        endpoints: [
          {
            method: 'GET',
            path: '/v1alpha2/mem9s/session-messages',
            summary: '按 session id 读取 session messages。',
            description: '为每个要查询的 session 重复传 `session_id` 参数；用 `limit_per_session` 控制每个 session 的返回上限。',
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
        description: '用 `/healthz` 做存活检查。旧的 tenant-scoped 路由仍存在于 `/v1alpha1/mem9s/{tenantID}/...` 下，但 hosted 客户端应优先使用 `v1alpha2` + `X-API-Key`。',
        endpoints: [
          {
            method: 'GET',
            path: '/healthz',
            summary: '检查服务健康状态。',
            description: '适合在 onboarding 前或排查网络可达性问题时使用。',
            responseFields: healthResponseFields,
            examples: [{ label: '健康检查', code: healthCheckCode }],
          },
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
      title: 'mem9 API | Hosted API 文件',
      description: '查看如何建立 API key、讀寫記憶、上傳檔案，以及查詢 hosted mem9 API 的 session messages。',
    },
    kicker: 'API',
    title: 'Hosted mem9 API 文件',
    intro: '使用 hosted mem9 API 建立 space、寫入或搜尋記憶、匯入既有檔案，並查看捕捉到的 session messages。',
    summary: '日常呼叫優先使用 `v1alpha2`。`v1alpha1` 持續保留給 key provision 與 tenant-scoped 相容路徑。',
    labels: {
      headers: '請求頭',
      queryParams: '查詢參數',
      body: '請求體',
      response: '回應',
      examples: '範例',
      required: '必填',
      next: '下一步',
      sidebarTitle: '本頁目錄',
      sidebarAuth: '驗證',
      sidebarQuickstart: '快速開始',
    },
    authTitle: 'Base URL 與驗證方式',
    authCards: [
      {
        title: 'Hosted base URL',
        body: '使用 `https://api.mem9.ai`。一般客戶端請求應發送到 `https://api.mem9.ai/v1alpha2/mem9s/...`。',
      },
      {
        title: '主要驗證 header',
        body: '把 mem9 API key 放進 `X-API-Key`。這是 `v1alpha2` 的預設 hosted 驗證模式。',
      },
      {
        title: '可選 agent 身分',
        body: '當你希望寫入或匯入歸屬到特定 agent 時，再額外送出 `X-Mnemo-Agent-Id`。舊的 tenant-scoped 路由仍保留在 `v1alpha1` 下。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小 hosted 流程是：先 provision 一個 key，把它 export 到 shell，然後建立並搜尋記憶。',
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
            examples: [{ label: '建立記憶', code: createMemoryCode }],
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
        ],
      },
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
      title: 'mem9 API | Hosted API リファレンス',
      description: 'API key の発行、memory の読み書き、ファイル import、session messages の取得方法を確認できます。',
    },
    kicker: 'API',
    title: 'Hosted mem9 API リファレンス',
    intro: 'hosted mem9 API を使って space を発行し、memory を書き込み / 検索し、既存ファイルを import し、保存済み session messages を確認できます。',
    summary: '日常利用では `v1alpha2` を優先してください。`v1alpha1` は key の provision と tenant-scoped な互換ルート向けに残っています。',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response',
      examples: 'Examples',
      required: '必須',
      next: 'Next',
      sidebarTitle: 'このページの内容',
      sidebarAuth: '認証',
      sidebarQuickstart: 'クイックスタート',
    },
    authTitle: 'Base URL と認証',
    authCards: [
      {
        title: 'Hosted base URL',
        body: '`https://api.mem9.ai` を使います。通常のクライアント通信は `https://api.mem9.ai/v1alpha2/mem9s/...` に送ってください。',
      },
      {
        title: '主要な認証 header',
        body: 'mem9 API key は `X-API-Key` に送ります。これが `v1alpha2` の標準的な hosted 認証です。',
      },
      {
        title: '任意の agent identity',
        body: 'write や import を特定 agent に紐付けたい場合は `X-Mnemo-Agent-Id` も送ります。tenant-scoped な旧ルートは `v1alpha1` に残っています。',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '最小の hosted フローは、key を provision して shell に export し、その後 memory を作成して検索することです。',
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
            description: '認証も request body も不要です。hosted service は `201` と `id` を返し、その `id` が保存して再利用する key になります。',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Key を発行', code: provisionKeyCode }],
          },
        ],
      },
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
            examples: [{ label: 'Memory を作成', code: createMemoryCode }],
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
            description: 'hosted service から単一の memory object を取得します。',
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
        ],
      },
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
      title: 'mem9 API | Hosted API 레퍼런스',
      description: 'API key 발급, memory 읽기/쓰기, 파일 import, session messages 조회 방법을 확인할 수 있습니다.',
    },
    kicker: 'API',
    title: 'Hosted mem9 API 레퍼런스',
    intro: 'hosted mem9 API 로 space 를 만들고, memory 를 쓰고 검색하고, 기존 파일을 import 하고, 저장된 session messages 를 확인할 수 있습니다.',
    summary: '일상적인 사용은 `v1alpha2` 를 우선하세요. `v1alpha1` 은 key provision 과 tenant-scoped 호환 경로를 위해 남아 있습니다.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response',
      examples: 'Examples',
      required: '필수',
      next: '다음',
      sidebarTitle: '이 페이지 목차',
      sidebarAuth: '인증',
      sidebarQuickstart: '빠른 시작',
    },
    authTitle: 'Base URL 과 인증',
    authCards: [
      {
        title: 'Hosted base URL',
        body: '`https://api.mem9.ai` 를 사용합니다. 일반적인 클라이언트 트래픽은 `https://api.mem9.ai/v1alpha2/mem9s/...` 로 보내세요.',
      },
      {
        title: '기본 인증 header',
        body: 'mem9 API key 는 `X-API-Key` 로 보냅니다. 이것이 `v1alpha2` 의 기본 hosted 인증 방식입니다.',
      },
      {
        title: '선택적 agent identity',
        body: 'write 나 import 를 특정 agent 에 귀속시키고 싶다면 `X-Mnemo-Agent-Id` 도 함께 보내세요. 기존 tenant-scoped 경로는 `v1alpha1` 아래에 남아 있습니다.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: '가장 작은 hosted 흐름은 key 를 provision 하고 shell 에 export 한 뒤, memory 를 생성하고 검색하는 것입니다.',
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
            description: '인증도 request body 도 필요 없습니다. hosted service 는 `201` 과 `id` 를 반환하며, 이 `id` 가 저장하고 재사용할 key 입니다.',
            responseFields: provisionResponseFields,
            examples: [{ label: 'Key 발급', code: provisionKeyCode }],
          },
        ],
      },
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
            examples: [{ label: 'Memory 생성', code: createMemoryCode }],
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
            description: 'hosted service 에서 하나의 memory object 를 가져옵니다.',
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
        ],
      },
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
      title: 'mem9 API | Referensi Hosted API',
      description: 'Pelajari cara membuat API key, membaca dan menulis memory, mengimpor file, dan membaca session messages di hosted mem9 API.',
    },
    kicker: 'API',
    title: 'Referensi hosted mem9 API',
    intro: 'Gunakan hosted mem9 API untuk membuat space, menulis atau mencari memory, mengimpor file yang sudah ada, dan melihat session messages yang tersimpan.',
    summary: 'Gunakan `v1alpha2` untuk pemakaian harian. `v1alpha1` tetap tersedia untuk provision key dan kompatibilitas tenant-scoped.',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response',
      examples: 'Examples',
      required: 'Wajib',
      next: 'Next',
      sidebarTitle: 'Di halaman ini',
      sidebarAuth: 'Autentikasi',
      sidebarQuickstart: 'Quick Start',
    },
    authTitle: 'Base URL & autentikasi',
    authCards: [
      {
        title: 'Hosted base URL',
        body: 'Gunakan `https://api.mem9.ai`. Untuk trafik client normal, kirim request ke `https://api.mem9.ai/v1alpha2/mem9s/...`.',
      },
      {
        title: 'Header autentikasi utama',
        body: 'Kirim mem9 API key Anda di `X-API-Key`. Ini adalah model auth hosted default untuk `v1alpha2`.',
      },
      {
        title: 'Identitas agent opsional',
        body: 'Kirim `X-Mnemo-Agent-Id` jika Anda ingin write atau import diatribusikan ke agent tertentu. Rute tenant-scoped lama masih tersedia di bawah `v1alpha1`.',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: 'Alur hosted paling kecil adalah: provision key, export ke shell, lalu buat dan cari memory.',
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
            examples: [{ label: 'Buat memory', code: createMemoryCode }],
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
            description: 'Ambil satu memory object dari hosted service.',
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
        ],
      },
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
      title: 'mem9 API | เอกสาร Hosted API',
      description: 'ดูวิธีสร้าง API key อ่านและเขียน memory อัปโหลดไฟล์ และอ่าน session messages บน hosted mem9 API',
    },
    kicker: 'API',
    title: 'เอกสาร hosted mem9 API',
    intro: 'ใช้ hosted mem9 API เพื่อสร้าง space เขียนหรือค้นหา memory นำเข้าไฟล์เดิม และดู session messages ที่ถูกเก็บไว้',
    summary: 'สำหรับการใช้งานประจำวันให้ใช้ `v1alpha2` เป็นหลัก ส่วน `v1alpha1` ยังมีไว้สำหรับ provision key และเส้นทาง tenant-scoped แบบเดิม',
    labels: {
      headers: 'Headers',
      queryParams: 'Query Params',
      body: 'Body',
      response: 'Response',
      examples: 'Examples',
      required: 'จำเป็น',
      next: 'ถัดไป',
      sidebarTitle: 'ในหน้านี้',
      sidebarAuth: 'การยืนยันตัวตน',
      sidebarQuickstart: 'เริ่มต้นอย่างรวดเร็ว',
    },
    authTitle: 'Base URL และการยืนยันตัวตน',
    authCards: [
      {
        title: 'Hosted base URL',
        body: 'ใช้ `https://api.mem9.ai` สำหรับ client ปกติให้ส่ง request ไปที่ `https://api.mem9.ai/v1alpha2/mem9s/...`',
      },
      {
        title: 'Header สำหรับ auth หลัก',
        body: 'ส่ง mem9 API key ของคุณใน `X-API-Key` นี่คือรูปแบบ auth หลักของ hosted `v1alpha2`',
      },
      {
        title: 'Agent identity แบบเลือกได้',
        body: 'ส่ง `X-Mnemo-Agent-Id` เพิ่มเมื่อคุณต้องการให้ write หรือ import ถูกผูกกับ agent ใด agent หนึ่ง เส้นทาง tenant-scoped แบบเดิมยังอยู่ภายใต้ `v1alpha1`',
      },
    ],
    quickstartTitle: 'Quick start',
    quickstartDescription: 'ลำดับ hosted ที่เล็กที่สุดคือ provision key, export เข้า shell แล้วสร้างและค้นหา memory',
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
            examples: [{ label: 'สร้าง memory', code: createMemoryCode }],
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
            description: 'ดึง memory object เดียวจาก hosted service',
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
        ],
      },
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
      billing: 'Pricing',
      security: 'Security',
      faq: 'FAQ',
      github: 'GitHub',
      docs: 'Docs',
      api: 'API',
      contact: 'Contact Us',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for AI agents',
      subtitle:
        'Your agents forget everything between sessions. mem9 gives the agents you use one shared memory layer with hybrid recall and a visual dashboard.',
      poweredByLabel: 'Powered by TiDB Cloud',
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
      substrateCtaLabel:
        'Need the backend substrate behind memory? Explore via TiDB Cloud Zero \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 memories',
            '1,000 retrieval API calls / month',
            'Community support',
          ],
          ctaLabel: 'Get Started',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / mo',
          features: [
            '50,000 memories',
            '5,000 retrieval API calls / month',
            'Email support',
          ],
          ctaLabel: 'Buy Now',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / mo',
          features: [
            'Unlimited memories',
            '50,000 retrieval API calls / month',
            'Priority support',
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
            'Unlimited memories',
            'Unlimited API calls',
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
      copyright: 'mem9.ai. Unlimited memory infrastructure for AI agents.',
    },
    aria: {
      home: 'mem9 home',
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
      billing: '定价',
      security: '安全',
      faq: '常见问题',
      github: 'GitHub',
      docs: '文档',
      api: 'API',
      contact: '联系我们',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '无限记忆',
      titleAccent: 'for AI agents',
      subtitle:
        '你的 Agent 会在会话之间丢失上下文。mem9 为你使用的 Agent 提供同一层共享记忆，支持混合召回和可视化管理。',
      poweredByLabel: '由 TiDB Cloud 提供支持',
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
      substrateCtaLabel:
        '想了解记忆背后的后端基础设施？通过 TiDB Cloud Zero 一探究竟 \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 条记忆',
            '1,000 次检索 API 调用 / 月',
            '社区支持',
          ],
          ctaLabel: '开始使用',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '50,000 条记忆',
            '5,000 次检索 API 调用 / 月',
            '邮件支持',
          ],
          ctaLabel: '立即购买',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '无限记忆',
            '50,000 次检索 API 调用 / 月',
            '优先支持',
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
            '无限记忆',
            '无限 API 调用',
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
      copyright: 'mem9.ai。为 AI Agents 提供无限记忆基础设施。',
    },
    aria: {
      home: 'mem9 首页',
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
      billing: '定價',
      security: '安全',
      faq: '常見問題',
      github: 'GitHub',
      docs: '文檔',
      api: 'API',
      contact: '聯絡我們',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '無限記憶',
      titleAccent: 'for AI agents',
      subtitle:
        '你的 Agent 會在會話之間遺忘所有內容。mem9 為你使用的 Agent 提供同一層共享記憶，支援混合召回和可視化管理。',
      poweredByLabel: '由 TiDB Cloud 提供支援',
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
      substrateCtaLabel:
        '想了解記憶背後的後端基礎設施？透過 TiDB Cloud Zero 一探究竟 \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 條記憶',
            '1,000 次檢索 API 呼叫 / 月',
            '社群支援',
          ],
          ctaLabel: '開始使用',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '50,000 條記憶',
            '5,000 次檢索 API 呼叫 / 月',
            '電郵支援',
          ],
          ctaLabel: '立即購買',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '無限記憶',
            '50,000 次檢索 API 呼叫 / 月',
            '優先支援',
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
            '無限記憶',
            '無限 API 呼叫',
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
      copyright: 'mem9.ai。為 AI Agents 提供無限記憶基礎設施。',
    },
    aria: {
      home: 'mem9 首頁',
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
      billing: '料金',
      security: 'セキュリティ',
      faq: 'よくある質問',
      github: 'GitHub',
      docs: 'ドキュメント',
      api: 'API',
      contact: 'お問い合わせ',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for AI agents',
      subtitle:
        'エージェントはセッションが変わるたびにすべてを忘れます。mem9 は、ハイブリッド検索とビジュアルダッシュボードを備えた共有メモリレイヤーを、利用中のエージェントに提供します。',
      poweredByLabel: 'TiDB Cloud で稼働',
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
      substrateCtaLabel:
        'メモリの裏側にあるバックエンド基盤が気になりますか？ TiDB Cloud Zero でご確認ください \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 メモリ',
            '1,000 検索 API コール / 月',
            'コミュニティサポート',
          ],
          ctaLabel: '始める',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 月',
          features: [
            '50,000 メモリ',
            '5,000 検索 API コール / 月',
            'メールサポート',
          ],
          ctaLabel: '購入する',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 月',
          features: [
            '無制限メモリ',
            '50,000 検索 API コール / 月',
            '優先サポート',
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
            '無制限メモリ',
            '無制限 API コール',
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
      copyright: 'mem9.ai。AI エージェント向けの無制限メモリ基盤。',
    },
    aria: {
      home: 'mem9 ホーム',
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
      billing: '요금',
      security: '보안',
      faq: '자주 묻는 질문',
      github: 'GitHub',
      docs: '문서',
      api: 'API',
      contact: '문의하기',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '무제한 메모리',
      titleAccent: 'for AI agents',
      subtitle:
        '에이전트는 세션이 바뀔 때마다 모든 것을 잊습니다. mem9는 사용 중인 에이전트에 하이브리드 리콜과 시각적 대시보드를 갖춘 공유 메모리 레이어를 제공합니다.',
      poweredByLabel: 'TiDB Cloud 기반',
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
      substrateCtaLabel:
        '메모리의 백엔드 인프라가 궁금하신가요? TiDB Cloud Zero에서 살펴보세요 \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 메모리',
            '1,000 검색 API 호출 / 월',
            '커뮤니티 지원',
          ],
          ctaLabel: '시작하기',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / 월',
          features: [
            '50,000 메모리',
            '5,000 검색 API 호출 / 월',
            '이메일 지원',
          ],
          ctaLabel: '구매하기',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / 월',
          features: [
            '무제한 메모리',
            '50,000 검색 API 호출 / 월',
            '우선 지원',
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
            '무제한 메모리',
            '무제한 API 호출',
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
      copyright: 'mem9.ai. AI 에이전트를 위한 무제한 메모리 인프라.',
    },
    aria: {
      home: 'mem9 홈',
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
      billing: 'Harga',
      security: 'Keamanan',
      faq: 'FAQ',
      github: 'GitHub',
      docs: 'Dokumentasi',
      api: 'API',
      contact: 'Hubungi Kami',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Memori tanpa batas',
      titleAccent: 'untuk AI agents',
      subtitle:
        'Agent Anda melupakan semuanya di antara sesi. mem9 memberi agent yang Anda gunakan satu lapis memori bersama dengan recall hybrid dan dashboard visual.',
      poweredByLabel: 'Didukung TiDB Cloud',
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
      substrateCtaLabel:
        'Penasaran dengan substrat backend di balik memory? Jelajahi via TiDB Cloud Zero \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10.000 memori',
            '1.000 panggilan retrieval API / bulan',
            'Dukungan komunitas',
          ],
          ctaLabel: 'Mulai',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / bln',
          features: [
            '50.000 memori',
            '5.000 panggilan retrieval API / bulan',
            'Dukungan email',
          ],
          ctaLabel: 'Beli Sekarang',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / bln',
          features: [
            'Memori tanpa batas',
            '50.000 panggilan retrieval API / bulan',
            'Dukungan prioritas',
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
            'Memori tanpa batas',
            'Panggilan API tanpa batas',
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
      copyright: 'mem9.ai. Infrastruktur memori tanpa batas untuk AI agents.',
    },
    aria: {
      home: 'beranda mem9',
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
      billing: 'ราคา',
      security: 'ความปลอดภัย',
      faq: 'คำถามที่พบบ่อย',
      github: 'GitHub',
      docs: 'เอกสาร',
      api: 'API',
      contact: 'ติดต่อเรา',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'หน่วยความจำไม่จำกัด',
      titleAccent: 'สำหรับ AI agents',
      subtitle:
        'เอเจนต์ของคุณลืมทุกอย่างระหว่างแต่ละเซสชัน mem9 มอบเลเยอร์หน่วยความจำที่แชร์ร่วมกันให้กับเอเจนต์ที่คุณใช้งาน พร้อมการค้นคืนแบบ hybrid และแดชบอร์ดแบบภาพ',
      poweredByLabel: 'ขับเคลื่อนโดย TiDB Cloud',
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
      substrateCtaLabel:
        'สนใจโครงสร้างพื้นฐานเบื้องหลัง memory ใช่ไหม? สำรวจผ่าน TiDB Cloud Zero \u2192',
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
      tiers: [
        {
          name: 'Free',
          price: '$0',
          period: '',
          features: [
            '10,000 หน่วยความจำ',
            '1,000 retrieval API calls / เดือน',
            'การสนับสนุนจากชุมชน',
          ],
          ctaLabel: 'เริ่มใช้งาน',
          ctaAction: 'alert',
        },
        {
          name: 'Starter',
          price: '$9',
          period: ' / เดือน',
          features: [
            '50,000 หน่วยความจำ',
            '5,000 retrieval API calls / เดือน',
            'สนับสนุนทางอีเมล',
          ],
          ctaLabel: 'ซื้อเลย',
          ctaAction: 'alert',
        },
        {
          name: 'Pro',
          price: '$120',
          period: ' / เดือน',
          features: [
            'หน่วยความจำไม่จำกัด',
            '50,000 retrieval API calls / เดือน',
            'สนับสนุนแบบเร่งด่วน',
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
            'หน่วยความจำไม่จำกัด',
            'API calls ไม่จำกัด',
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
      copyright: 'mem9.ai โครงสร้างพื้นฐานหน่วยความจำไม่จำกัดสำหรับ AI agents',
    },
    aria: {
      home: 'หน้าแรก mem9',
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
