export type SiteLocale = 'en' | 'zh' | 'zh-Hant' | 'ja' | 'ko' | 'id' | 'th';
export type SiteThemePreference = 'light' | 'dark' | 'system';
export type SiteResolvedTheme = 'light' | 'dark';

export interface SiteMeta {
  title: string;
  description: string;
}

export interface SiteNavCopy {
  home: string;
  features: string;
  platforms: string;
  yourMemory: string;
  billing: string;
  security: string;
  docs: string;
}

export interface SiteHeroHighlight {
  title: string;
  description: string;
}

export interface SiteHeroFeature {
  title: string;
  description: string;
}

export interface SiteHeroCopy {
  eyebrow: string;
  titleLead: string;
  titleAccent: string;
  subtitle: string;
  onboardingLabel: string;
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

export interface SiteFaqCopy {
  kicker: string;
  title: string;
  question: string;
  answer: string;
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
}

export interface SitePlatformsCopy {
  kicker: string;
  title: string;
  description: string;
  items: SitePlatformItem[];
  ctaLabel: string;
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

export interface SiteFooterCopy {
  github: string;
  license: string;
  contributing: string;
  security: string;
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
  faq: SiteFaqCopy;
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

export const siteCopy: Record<SiteLocale, SiteDictionary> = {
  en: {
    meta: {
      title: 'mem9 - Unlimited Memory Infrastructure for OpenClaw',
      description:
        'mem9.ai is unlimited memory infrastructure for OpenClaw. Persistent recall, hybrid search, and multi-agent context for Claude Code, OpenCode, OpenClaw, and custom tools.',
    },
    nav: {
      home: 'Home',
      features: 'Features',
      platforms: 'Platforms',
      yourMemory: 'Your Memory',
      billing: 'Billing',
      security: 'Security',
      docs: 'Docs',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for OpenClaw',
      subtitle:
        'Your agents forget everything between sessions. mem9 fixes that. Persistent memory infrastructure with hybrid search, shared spaces, and cross-agent recall from first write to forever.',
      onboardingLabel: 'Agent Onboarding',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        'Read https://mem9.ai/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw',
      onboardingCommandBeta:
        'Read https://mem9.ai/beta/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw',
      betaFeature: {
        title: 'Context Engine Support',
        description:
          'Now with support for the latest Context Engine, mem9 helps your agent remember what matters and bring in only the right memory for each task—so users repeat less, responses stay more accurate, and prompts stay lean. The result is a faster, more focused agent experience with lower token usage and less wasted cost.',
      },
      highlights: [
        {
          title: 'Never forget again',
          description:
            'Cloud-persistent memory that survives resets, restarts, and machine switches.',
        },
        {
          title: 'Securely backed up',
          description:
            'Your agent memory lives in durable cloud storage, not fragile local files.',
        },
        {
          title: 'Seamless onboarding',
          description:
            'Start with one instruction, then bring over existing memory without breaking your flow.',
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
      title: 'One memory layer. Every agent.',
      description:
        "Agents shouldn't lose context when they switch tools. mem9 gives every agent in your stack a shared, persistent memory that stays durable, searchable, and always in sync.",
      items: [
        {
          name: 'OpenClaw',
          desc: 'Unlimited memory',
          detail:
            'Give your OpenClaw agents memory that never expires. Recall past conversations, reuse learned knowledge, and stay consistent session after session.',
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
      note: 'Also works with any client that can read or write through the mem9 API layer.',
    },
    faq: {
      kicker: 'FAQ',
      title: 'Trust, without the enterprise theater',
      question: 'Is mem9 secure?',
      answer:
        'mem9 is built on enterprise-grade cloud infrastructure with encryption in transit and at rest, access controls, auditability, and clear operational boundaries. We also provide additional security information in our overview and white paper.',
    },
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
      title: 'mem9 - 面向 OpenClaw 的无限记忆基础设施',
      description:
        'mem9.ai 为 OpenClaw 提供无限记忆基础设施，支持持久召回、混合搜索，以及面向 Claude Code、OpenCode、OpenClaw 和自定义工具的多 Agent 上下文共享。',
    },
    nav: {
      home: '首页',
      features: '能力',
      platforms: '平台',
      yourMemory: '你的记忆',
      billing: '定价',
      security: '安全',
      docs: '文档',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '无限记忆',
      titleAccent: 'for OpenClaw',
      subtitle:
        '你的 Agent 会在每次会话结束后忘掉一切，mem9 负责修复这件事。它提供持久化记忆基础设施，支持混合搜索、共享空间和跨 Agent 召回，从第一次写入一直保留到未来。',
      onboardingLabel: 'Agent 接入',
      onboardingStableLabel: 'Stable',
      onboardingBetaLabel: 'Beta',
      onboardingCommandStable:
        '阅读 https://mem9.ai/SKILL.md ，按照说明为 OpenClaw 安装并配置 mem9',
      onboardingCommandBeta:
        '阅读 https://mem9.ai/beta/SKILL.md ，按照说明为 OpenClaw 安装并配置 mem9',
      betaFeature: {
        title: 'Context Engine 支持',
        description:
          '现在已支持最新的 Context Engine，mem9 能帮助你的 Agent 记住真正重要的内容，并在每个任务里只带入最合适的记忆。这样用户不需要反复重复信息，回复会更准确，提示词也能保持精简。最终效果是 Agent 体验更快、更聚焦，同时减少 token 消耗和无谓成本。',
      },
      highlights: [
        {
          title: '不再遗忘',
          description: '云端持久记忆可跨越重置、重启和设备切换持续保留。',
        },
        {
          title: '安全备份',
          description: '你的 Agent 记忆存放在耐久云存储里，而不是脆弱的本地文件。',
        },
        {
          title: '无缝接入',
          description: '从一条指令开始，再逐步迁移已有记忆，不会打断现有工作流。',
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
      title: '一层记忆，覆盖每个 Agent。',
      description:
        'Agent 在切换工具时不该丢掉上下文。mem9 为你的整套 Agent 栈提供共享且持久的记忆层，始终可搜索、可同步、可长期保存。',
      items: [
        {
          name: 'OpenClaw',
          desc: '无限记忆',
          detail:
            '为你的 OpenClaw Agent 提供永不过期的记忆。回忆过去的对话，复用已经学到的知识，并在一轮又一轮会话中保持一致。',
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
      note: '任何能够通过 mem9 API 层读写的客户端也都可以接入。',
    },
    faq: {
      kicker: 'FAQ',
      title: '轻量可信，不做过度包装',
      question: 'mem9 安全吗？',
      answer:
        'mem9 构建在企业级云基础设施之上，提供传输中与静态加密、访问控制、可审计性，以及清晰的操作边界。我们也在安全概览和白皮书中提供更多说明。',
    },
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
        'mem9.ai 為 OpenClaw 提供無限記憶基礎設施，支援持久召回、混合搜尋，以及面向 Claude Code、OpenCode、OpenClaw 和自訂工具的多 Agent 上下文共享。',
    },
    nav: {
      home: '首頁',
      features: '能力',
      platforms: '平台',
      yourMemory: '你的記憶',
      billing: '定價',
      security: '安全',
      docs: '文檔',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '無限記憶',
      titleAccent: 'for OpenClaw',
      subtitle:
        '你的 Agent 會在每次會話結束後忘掉一切，mem9 負責修復這件事。它提供持久化記憶基礎設施，支援混合搜尋、共享空間和跨 Agent 召回，從第一次寫入一路保留到未來。',
      onboardingLabel: 'Agent 接入',
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
      title: '一層記憶，覆蓋每個 Agent。',
      description:
        'Agent 在切換工具時不該丟掉上下文。mem9 為你的整套 Agent 堆疊提供共享且持久的記憶層，始終可搜尋、可同步、可長期保存。',
      items: [
        {
          name: 'OpenClaw',
          desc: '無限記憶',
          detail:
            '為你的 OpenClaw Agent 提供永不過期的記憶。回想過去的對話，重用已學到的知識，並在一輪又一輪會話中保持一致。',
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
      note: '任何能夠透過 mem9 API 層讀寫的客戶端也都可以接入。',
    },
    faq: {
      kicker: 'FAQ',
      title: '輕量可信，不走企業話術',
      question: 'mem9 安全嗎？',
      answer:
        'mem9 建立在企業級雲端基礎設施之上，提供傳輸中與靜態加密、存取控制、可稽核性，以及清楚的操作邊界。我們也在安全概覽與白皮書中提供更多說明。',
    },
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
        'mem9.ai は OpenClaw 向けの無制限メモリ基盤です。永続リコール、ハイブリッド検索、そして Claude Code、OpenCode、OpenClaw、独自ツール向けのマルチエージェント文脈共有を提供します。',
    },
    nav: {
      home: 'ホーム',
      features: '機能',
      platforms: '対応環境',
      yourMemory: 'あなたの記憶',
      billing: '料金',
      security: 'セキュリティ',
      docs: 'ドキュメント',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Unlimited memory',
      titleAccent: 'for OpenClaw',
      subtitle:
        'エージェントはセッションが変わるたびにすべてを忘れます。mem9 はそれを解決します。ハイブリッド検索、共有スペース、エージェント間リコールを備えた永続メモリ基盤で、最初の書き込みからずっと記憶を保ちます。',
      onboardingLabel: 'エージェント導入',
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
      title: 'Security & Privacy',
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
      title: 'ひとつのメモリレイヤーを、すべてのエージェントへ。',
      description:
        'ツールを切り替えるたびにエージェントが文脈を失うべきではありません。mem9 はスタック内のすべてのエージェントに、永続的で検索可能、常に同期された共有メモリを提供します。',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Unlimited memory',
          detail:
            'OpenClaw エージェントに期限のない記憶を与えます。過去の会話を呼び戻し、学習済みの知識を再利用し、セッションをまたいで一貫性を保てます。',
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
      note: 'mem9 API レイヤー経由で読み書きできるクライアントなら、そのまま利用できます。',
    },
    faq: {
      kicker: 'FAQ',
      title: '大げさにしない、でも信頼できる',
      question: 'mem9 は安全ですか？',
      answer:
        'mem9 はエンタープライズグレードのクラウド基盤上で構築されており、通信時と保存時の暗号化、アクセス制御、監査性、そして明確な運用境界を備えています。追加の情報はセキュリティ概要とホワイトペーパーで公開しています。',
    },
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'mem9 のデータ取り扱い、暗号化、アクセス制御、運用境界への考え方を紹介します。',
      },
      kicker: 'Security',
      title: 'Security & Privacy',
      intro:
        'mem9 は、永続クラウドメモリの利点を提供しながら、明確な運用境界と強固なセキュリティ基盤を保つよう設計されています。',
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
        'mem9.ai는 OpenClaw를 위한 무제한 메모리 인프라입니다. 지속 리콜, 하이브리드 검색, 그리고 Claude Code, OpenCode, OpenClaw 및 커스텀 도구를 위한 멀티 에이전트 컨텍스트 공유를 제공합니다.',
    },
    nav: {
      home: '홈',
      features: '기능',
      platforms: '플랫폼',
      yourMemory: '당신의 기억',
      billing: '요금',
      security: '보안',
      docs: '문서',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: '무제한 메모리',
      titleAccent: 'for OpenClaw',
      subtitle:
        '에이전트는 세션이 바뀔 때마다 모든 것을 잊습니다. mem9가 이를 해결합니다. 하이브리드 검색, 공유 공간, 에이전트 간 리콜을 갖춘 지속 메모리 인프라로 첫 번째 기록부터 계속 기억을 유지합니다.',
      onboardingLabel: '에이전트 온보딩',
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
      title: 'Security & Privacy',
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
      title: '하나의 메모리 레이어. 모든 에이전트.',
      description:
        '도구를 바꿀 때마다 에이전트가 컨텍스트를 잃어서는 안 됩니다. mem9는 스택 전체의 에이전트에게 공유되고 지속적이며, 검색 가능하고 항상 동기화된 메모리를 제공합니다.',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Unlimited memory',
          detail:
            'OpenClaw 에이전트에 만료되지 않는 메모리를 제공합니다. 이전 대화를 다시 불러오고, 배운 지식을 재사용하며, 세션이 바뀌어도 일관성을 유지합니다.',
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
      note: 'mem9 API 레이어를 통해 읽고 쓸 수 있는 모든 클라이언트와도 함께 동작합니다.',
    },
    faq: {
      kicker: 'FAQ',
      title: '과장하지 않지만 믿을 수 있게',
      question: 'mem9는 안전한가요?',
      answer:
        'mem9는 엔터프라이즈급 클라우드 인프라 위에 구축되었으며, 전송 중 및 저장 시 암호화, 접근 제어, 감사 가능성, 그리고 명확한 운영 경계를 갖추고 있습니다. 추가 보안 정보는 보안 개요와 백서에서 제공합니다.',
    },
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'mem9의 데이터 처리, 암호화, 접근 제어, 운영 경계에 대한 접근 방식을 소개합니다.',
      },
      kicker: 'Security',
      title: 'Security & Privacy',
      intro:
        'mem9는 지속형 클라우드 메모리의 이점을 제공하면서도 명확한 운영 경계와 강한 보안 기반을 유지하도록 설계되었습니다.',
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
        'mem9.ai adalah infrastruktur memori tanpa batas untuk OpenClaw. Menyediakan recall persisten, pencarian hybrid, dan konteks multi-agent untuk Claude Code, OpenCode, OpenClaw, dan tool kustom.',
    },
    nav: {
      home: 'Beranda',
      features: 'Fitur',
      platforms: 'Platform',
      yourMemory: 'Memori Anda',
      billing: 'Harga',
      security: 'Keamanan',
      docs: 'Dokumentasi',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'Memori tanpa batas',
      titleAccent: 'for OpenClaw',
      subtitle:
        'Agent Anda melupakan semuanya di antara sesi. mem9 memperbaikinya. Infrastruktur memori persisten dengan pencarian hybrid, ruang bersama, dan recall lintas agent dari penulisan pertama hingga seterusnya.',
      onboardingLabel: 'Onboarding Agent',
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
      title: 'Security & Privacy',
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
      title: 'Satu lapisan memori. Untuk setiap agent.',
      description:
        'Agent tidak seharusnya kehilangan konteks saat berpindah tool. mem9 memberi semua agent di stack Anda memori bersama yang persisten, dapat dicari, dan selalu sinkron.',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Unlimited memory',
          detail:
            'Berikan agent OpenClaw Anda memori yang tidak pernah kedaluwarsa. Panggil kembali percakapan lama, gunakan ulang pengetahuan yang sudah dipelajari, dan tetap konsisten dari sesi ke sesi.',
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
      note: 'Juga bekerja dengan klien apa pun yang dapat membaca atau menulis melalui lapisan API mem9.',
    },
    faq: {
      kicker: 'FAQ',
      title: 'Terpercaya, tanpa terasa korporat',
      question: 'Apakah mem9 aman?',
      answer:
        'mem9 dibangun di atas infrastruktur cloud kelas enterprise dengan enkripsi saat transit dan saat tersimpan, kontrol akses, auditabilitas, dan batas operasional yang jelas. Kami juga menyediakan detail keamanan tambahan di ringkasan keamanan dan white paper kami.',
    },
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'Pelajari bagaimana mem9 menangani data, enkripsi, kontrol akses, dan batas operasional.',
      },
      kicker: 'Security',
      title: 'Security & Privacy',
      intro:
        'mem9 dirancang untuk memberi manfaat memori cloud persisten dengan batas operasional yang jelas dan fondasi keamanan yang kuat.',
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
        'mem9.ai คือโครงสร้างพื้นฐานหน่วยความจำไม่จำกัดสำหรับ OpenClaw พร้อมการเรียกคืนแบบถาวร การค้นหาแบบ hybrid และบริบทแบบ multi-agent สำหรับ Claude Code, OpenCode, OpenClaw และเครื่องมือแบบกำหนดเอง',
    },
    nav: {
      home: 'หน้าแรก',
      features: 'ความสามารถ',
      platforms: 'แพลตฟอร์ม',
      yourMemory: 'ความทรงจำของคุณ',
      billing: 'ราคา',
      security: 'ความปลอดภัย',
      docs: 'เอกสาร',
    },
    hero: {
      eyebrow: 'MEM9.AI',
      titleLead: 'หน่วยความจำไม่จำกัด',
      titleAccent: 'for OpenClaw',
      subtitle:
        'เอเจนต์ของคุณลืมทุกอย่างระหว่างแต่ละเซสชัน mem9 เข้ามาแก้ปัญหานี้ด้วยโครงสร้างพื้นฐานหน่วยความจำแบบถาวรที่มีการค้นหาแบบ hybrid พื้นที่ร่วมกัน และการเรียกคืนข้ามเอเจนต์ตั้งแต่การเขียนครั้งแรกไปจนตลอดการใช้งาน',
      onboardingLabel: 'การตั้งค่าเอเจนต์',
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
      title: 'Security & Privacy',
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
      title: 'เมมโมรีเลเยอร์เดียว สำหรับทุกเอเจนต์',
      description:
        'เอเจนต์ไม่ควรสูญเสียบริบทเมื่อสลับเครื่องมือ mem9 ทำให้ทุกเอเจนต์ในสแตกของคุณมีหน่วยความจำร่วมกันแบบถาวร ค้นหาได้ และซิงก์กันเสมอ',
      items: [
        {
          name: 'OpenClaw',
          desc: 'Unlimited memory',
          detail:
            'มอบหน่วยความจำที่ไม่มีวันหมดอายุให้กับเอเจนต์ OpenClaw ของคุณ เรียกดูบทสนทนาเก่า ใช้ความรู้ที่เคยเรียนรู้ซ้ำ และคงความสม่ำเสมอได้ในทุกเซสชัน',
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
      note: 'ยังทำงานได้กับไคลเอนต์ใดก็ตามที่อ่านหรือเขียนผ่านชั้น API ของ mem9 ได้',
    },
    faq: {
      kicker: 'FAQ',
      title: 'น่าเชื่อถือ โดยไม่ต้องดูเป็นองค์กรเกินไป',
      question: 'mem9 ปลอดภัยไหม?',
      answer:
        'mem9 ทำงานบนโครงสร้างพื้นฐานคลาวด์ระดับ enterprise พร้อมการเข้ารหัสระหว่างส่งและขณะจัดเก็บ การควบคุมสิทธิ์ การตรวจสอบย้อนหลังได้ และขอบเขตการทำงานที่ชัดเจน เรายังมีข้อมูลด้านความปลอดภัยเพิ่มเติมในภาพรวมด้านความปลอดภัยและ white paper',
    },
    securityPage: {
      meta: {
        title: 'Security & Privacy | mem9',
        description:
          'ดูว่า mem9 จัดการข้อมูล การเข้ารหัส การควบคุมสิทธิ์ และขอบเขตการปฏิบัติงานอย่างไร',
      },
      kicker: 'Security',
      title: 'Security & Privacy',
      intro:
        'mem9 ถูกออกแบบมาเพื่อให้ได้ประโยชน์จาก cloud memory แบบถาวร พร้อมขอบเขตการปฏิบัติงานที่ชัดเจนและรากฐานด้านความปลอดภัยที่แข็งแรง',
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
