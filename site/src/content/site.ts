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
}

export interface SitePlatformsCopy {
  kicker: string;
  title: string;
  description: string;
  items: SitePlatformItem[];
  note: string;
}

export interface SiteFooterCopy {
  github: string;
  license: string;
  contributing: string;
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
  features: SiteFeaturesCopy;
  platforms: SitePlatformsCopy;
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
      ],
      note: 'Also works with any client that can read or write through the mem9 API layer.',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'Contributing',
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
      ],
      note: '任何能够通过 mem9 API 层读写的客户端也都可以接入。',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '参与贡献',
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
      ],
      note: '任何能夠透過 mem9 API 層讀寫的客戶端也都可以接入。',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '參與貢獻',
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
      ],
      note: 'mem9 API レイヤー経由で読み書きできるクライアントなら、そのまま利用できます。',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'コントリビュート',
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
      ],
      note: 'mem9 API 레이어를 통해 읽고 쓸 수 있는 모든 클라이언트와도 함께 동작합니다.',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: '기여하기',
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
      ],
      note: 'Juga bekerja dengan klien apa pun yang dapat membaca atau menulis melalui lapisan API mem9.',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'Berkontribusi',
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
      ],
      note: 'ยังทำงานได้กับไคลเอนต์ใดก็ตามที่อ่านหรือเขียนผ่านชั้น API ของ mem9 ได้',
    },
    footer: {
      github: 'GitHub',
      license: 'Apache-2.0',
      contributing: 'ร่วมพัฒนา',
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
