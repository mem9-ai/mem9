import type { SiteLocale, SiteMeta } from './site';

export type DocsLocale = 'en' | 'zh' | 'ja' | 'ko' | 'id' | 'th';

export interface DocsLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface DocsSubsection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  links?: DocsLink[];
}

export interface DocsSection {
  id: string;
  label: string;
  title: string;
  intro?: string;
  paragraphs?: string[];
  bullets?: string[];
  subsections?: DocsSubsection[];
  links?: DocsLink[];
}

export interface DocsSectionGroup {
  title: string;
  sectionIDs: string[];
}

export interface DocsHeroCopy {
  eyebrow: string;
  title: string;
  intro: string;
  summaryTitle: string;
  summaryBullets: string[];
  tocTitle: string;
}

export interface DocsPageCopy {
  meta: SiteMeta;
  hero: DocsHeroCopy;
  tocGroups: DocsSectionGroup[];
  sections: DocsSection[];
}

export const docsCopy: Record<DocsLocale, DocsPageCopy> = {
  en: {
    meta: {
      title: 'mem9 Docs | Official User Guide',
      description:
        'Official mem9 user guide for OpenClaw users. Learn setup, reconnect, dashboard workflows, memory behavior, security, and Context Engine support.',
    },
    hero: {
      eyebrow: 'Docs',
      title: 'mem9 Official User Guide',
      intro:
        'mem9 gives OpenClaw a durable cloud memory layer plus a dashboard for inspecting, managing, and analyzing what your agents remember. This guide focuses on the official mem9.ai experience: how to install it, what to expect, and how to use it well over time.',
      summaryTitle: 'What this guide covers',
      summaryBullets: [
        'The fastest official path: start from mem9.ai/SKILL.md.',
        'What mem9 actually changes compared with local memory files.',
        'How setup, reconnect, uninstall, and dashboard workflows behave.',
        'Where Hook mode and Context Engine support fit into the product.',
      ],
      tocTitle: 'On this page',
    },
    tocGroups: [
      {
        title: 'Start Here',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: 'Why mem9',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: 'Setup & Daily Use',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: 'Trust & Limits',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: 'Quick Start',
        intro: 'If you only do one thing, do this first.',
        paragraphs: [
          'Read https://mem9.ai/SKILL.md and follow the instructions to install and configure mem9 for OpenClaw. That is the main official entry point for the hosted mem9.ai service.',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a> can be used as an optional install source, but this guide assumes the official mem9.ai flow so the experience matches the website, dashboard, and support materials.',
        ],
        bullets: [
          'Install mem9 from the official onboarding flow.',
          'Save the generated MEM9_API_KEY somewhere secure.',
          'Use that key again whenever you reconnect on another machine.',
          'After setup, open Your Memory to inspect what your agents are storing.',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: 'What mem9 Is',
        paragraphs: [
          'mem9 is long-term cloud memory for OpenClaw plus a visual dashboard for managing and analyzing that memory.',
          'It turns fragile, scattered, hard-to-manage local memory into a durable product layer that is hosted, searchable, shareable, inspectable, and built for ongoing use.',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: 'Who This Guide Is For',
        intro: 'This guide is for users who want the official hosted mem9.ai experience.',
        bullets: [
          'What mem9 is and why it is useful over the long term.',
          'Why mem9 is often better than local memory files for durable workflows.',
          'How to start from SKILL.md and what setup actually gives you.',
          'What Your Memory does, which terms matter, and how reconnect or uninstall behaves.',
        ],
        subsections: [
          {
            title: 'What this guide does not cover',
            bullets: [
              'Self-hosting the Go backend.',
              'Deploying the mem9 API service yourself.',
              'Running your own database, infra, and operations stack.',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'Problems mem9 Solves',
        paragraphs: [
          'Default local memory approaches are tied to one machine, easy to lose after resets or migrations, hard to share across multiple agents, and difficult to review or manage over time.',
          'mem9 makes important context survive across sessions, devices, and agents. It also makes memory visible through the dashboard so users can inspect, clean up, import, export, and analyze it instead of blindly trusting local files.',
          'Just as importantly, mem9 aims to behave like a facts-and-insights memory layer rather than a pile of raw chat logs. The goal is to bring back the smallest useful set of relevant memory, not to keep stuffing old transcripts into prompts.',
        ],
        bullets: [
          'Less repetition of project background and user preferences.',
          'Less loss after restarts, resets, or machine switches.',
          'Less fragmentation when multiple agents need the same long-term knowledge.',
          'More control over what the system actually remembers.',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'OpenClaw Native Memory vs mem9',
        intro:
          'The clearest difference is not that one is “good” and the other is “bad”. They solve different memory problems.',
        paragraphs: [
          'OpenClaw native memory is not useless. It is fundamentally about helping the agent write important information into local Markdown and then retrieve those files through indexing.',
          'mem9 addresses a different class of need: memory that persists across sessions, resets, agents, devices, and ongoing operational workflows.',
        ],
        subsections: [
          {
            title: 'When OpenClaw native memory is usually enough',
            bullets: [
              'A single OpenClaw agent.',
              'A single machine.',
              'You mainly rely on `MEMORY.md` and daily notes.',
              'You are fine with recall returning original snippets or chunks.',
            ],
          },
          {
            title: 'When mem9 becomes the right product shape',
            bullets: [
              'Memory needs to survive across sessions, resets, and machines.',
              'You do not want memory quality to depend on whether the agent wrote Markdown correctly.',
              'You want long conversations to be distilled into more stable facts or insights.',
              'You need multiple agents to share one memory pool.',
              'You need different memory layers such as insight, pinned, and session.',
              'You need APIs, a dashboard, analysis, and memory governance.',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory is closer to a local knowledge notebook.',
          'mem9 is closer to an external agent memory system.',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: 'Core Capabilities',
        intro: 'These are the product behaviors users will feel most directly.',
        subsections: [
          {
            title: 'Cloud long-term memory',
            paragraphs: [
              'Important context lives in the cloud instead of only inside the current chat session. That means resets, restarts, and device changes do not force your agent to start from zero.',
            ],
          },
          {
            title: 'Shared memory spaces',
            paragraphs: [
              'Multiple agents can connect to the same mem9 space and reuse the same long-term knowledge. This works well for multi-device usage, repeated automation, and shared project context.',
            ],
          },
          {
            title: 'Hybrid recall',
            paragraphs: [
              'mem9 combines keyword and semantic recall so the system can search by exact terms and by current-task relevance. The goal is not perfect retrieval every time; the goal is to bring back better memory than a plain local file lookup can.',
            ],
            bullets: [
              'Smaller prompt payloads.',
              'Less irrelevant context.',
              'Lower token usage and lower cost.',
              'Less pressure from context compaction in long-running sessions.',
            ],
          },
          {
            title: 'Your Memory dashboard',
            paragraphs: [
              'Your Memory is the official mem9 dashboard. It lets users view, manage, analyze, import, and export memories from a dedicated interface instead of treating memory as an invisible side effect.',
            ],
          },
          {
            title: 'Explicit “remember this” writes',
            paragraphs: [
              'Once mem9 is configured, a clear durable-write request such as “remember this” or “save this to mem9” should be treated as a real write request, not as casual conversation. The system can then decide which parts belong in long-term memory and confirm success or failure briefly.',
            ],
          },
          {
            title: 'Hook mode and Context Engine support',
            paragraphs: [
              'mem9 supports both Hook mode and Context Engine mode. Hook mode has the best compatibility today. Context Engine mode is the stronger path because it lets mem9 participate more directly in prompt assembly, message ingest, and compaction-related lifecycle behavior.',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: 'Official Install Flow',
        paragraphs: [
          'The simplest official install path is still the SKILL.md entry point. If users remember one thing, it should be that URL.',
        ],
        subsections: [
          {
            title: 'Start from mem9.ai/SKILL.md',
            paragraphs: [
              'Read https://mem9.ai/SKILL.md and follow the onboarding instructions inside OpenClaw. That is the source of truth for the official hosted workflow.',
            ],
          },
          {
            title: 'Typical setup choices inside OpenClaw',
            bullets: [
              'Create new mem9: generate a new API key and start a fresh memory space.',
              'Reconnect mem9: enter an existing API key and reconnect to the same memory space.',
              'Agents using the same API key share the same memory space in real time.',
              'The API key can be switched later if the user intentionally wants a different memory space.',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'What You Get After Setup',
        bullets: [
          'A cloud-backed long-term memory space connected to mem9.ai.',
          'A MEM9_API_KEY that must be kept safe for reconnect and recovery.',
          'An OpenClaw environment that can explicitly store durable memory.',
          'A dashboard entry point for viewing, organizing, importing, exporting, and analyzing memory.',
        ],
        paragraphs: [
          'From that point on, the main user actions are straightforward: ask the agent to remember important background, share one memory space across multiple agents, and use Your Memory whenever inspection or cleanup is needed.',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Your Memory Dashboard',
        intro: 'Your Memory is the main visual application in the mem9 product.',
        bullets: [
          'View existing memories.',
          'Review, clean up, and manage entries.',
          'Analyze memory content and patterns.',
          'Import historical data when the user explicitly wants it.',
          'Export current memory when needed.',
        ],
        links: [
          {
            label: 'Open Your Memory',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: 'Daily Usage Expectations',
        paragraphs: [
          'The most immediate day-to-day change is that users stop repeating the same project background, preferences, and working agreements every session.',
        ],
        subsections: [
          {
            title: 'What mem9 is good at remembering',
            bullets: [
              'Preferences and working style.',
              'Project background and stable context.',
              'Rules, standards, and conventions worth reusing.',
              'Verified conclusions and recurring facts.',
            ],
          },
          {
            title: 'What users should not expect immediately',
            bullets: [
              'Every line of chat automatically becomes high-quality long-term memory.',
              'All old local history is automatically imported during setup.',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: 'Reconnect, New Machine, and API Key Care',
        subsections: [
          {
            title: 'Reconnect',
            paragraphs: [
              'Reconnect means taking an existing MEM9_API_KEY and attaching the agent back to the original memory space. It does not create a new memory space.',
            ],
          },
          {
            title: 'Recovering on a new machine',
            bullets: [
              'Install the mem9 plugin again.',
              'Write the same MEM9_API_KEY back into the config.',
              'Keep the original official service URL unless you intentionally changed it.',
              'Restart and verify that the original memory space is visible again.',
            ],
          },
          {
            title: 'Protecting the key',
            paragraphs: [
              'The API key should be treated like a real secret and stored in a password manager or another secure vault. It is the key to reconnecting the same memory space later.',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: 'Uninstall Behavior',
        intro: 'Uninstalling mem9 affects the local machine setup, not the remote cloud data.',
        subsections: [
          {
            title: 'What uninstall does',
            bullets: [
              'Removes the local mem9 plugin configuration from that machine.',
              'Restores the previous local memory configuration when applicable.',
              'Cleans up local install residue.',
            ],
          },
          {
            title: 'What uninstall does not do',
            bullets: [
              'It does not delete remote mem9 cloud data.',
              'It does not revoke the MEM9_API_KEY.',
              'It does not automatically reset the current chat session.',
            ],
          },
        ],
        paragraphs: [
          'If the user wants the same memory back later, the usual path is simply to reinstall mem9 and reconnect with the original API key.',
          'The uninstall flow is designed around a single restart, and resetting the current session is a separate follow-up after uninstall verification succeeds.',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: 'Security and Trust',
        paragraphs: [
          'mem9 positions itself as a production-ready memory layer, not an opaque black box. The product story emphasizes clear data handling boundaries and production-grade cloud infrastructure.',
        ],
        bullets: [
          'Encryption in transit.',
          'Encryption at rest.',
          'Access controls.',
          'Auditability.',
          'Clear data processing boundaries.',
          'Production-grade cloud infrastructure.',
        ],
        links: [
          {
            label: 'Security Overview',
            href: '/#security',
          },
          {
            label: 'TiDB Cloud Security White Paper',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: 'Product Expectations and Limits',
        subsections: [
          {
            title: 'mem9 is a long-term memory layer, not a universal reasoning engine',
            bullets: [
              'It is good at preserving important information over time.',
              'It is good at bringing back relevant memory when needed.',
              'It reduces repeated explanation and setup cost.',
              'It does not guarantee perfect retrieval on every turn.',
            ],
          },
          {
            title: 'Setup is not the same thing as import',
            paragraphs: [
              'Initial setup is about connecting mem9, not uploading every historical local memory automatically. If the user wants local memory imported, that should happen as an explicit request, not as silent background collection.',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: 'Recommended Path and Official Links',
        intro: 'For a new user, the cleanest sequence looks like this.',
        bullets: [
          'Open mem9.ai and copy the SKILL.md onboarding instruction into OpenClaw.',
          'Finish setup and save the MEM9_API_KEY immediately.',
          'Use mem9 for a few days so the memory space has real data.',
          'Open Your Memory to review, organize, and analyze what was captured.',
        ],
        links: [
          {
            label: 'mem9 Website',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'mem9 GitHub Repository',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
  zh: {
    meta: {
      title: 'mem9 文档 | 官方用户手册',
      description:
        'mem9 面向 OpenClaw 用户的官方手册，涵盖 setup、reconnect、Your Memory、长期记忆行为、安全说明以及 Context Engine 支持。',
    },
    hero: {
      eyebrow: '文档',
      title: 'mem9 官方用户手册',
      intro:
        'mem9 为 OpenClaw 提供云端长期记忆层，以及一个可以查看、管理和分析记忆的可视化应用。这个文档页聚焦官方 mem9.ai 托管体验：如何安装、setup 之后会得到什么、日常使用应该期待什么，以及长期如何维护这份记忆。',
      summaryTitle: '这份文档会讲什么',
      summaryBullets: [
        '最快的官方入口：从 mem9.ai/SKILL.md 开始。',
        'mem9 相比本地 memory 文件到底改变了什么。',
        'setup、reconnect、uninstall 和 Dashboard 的真实行为。',
        'Hook 模式与 Context Engine 支持在产品里的定位。',
      ],
      tocTitle: '目录',
    },
    tocGroups: [
      {
        title: '开始使用',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: '为什么用 mem9',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: '安装与日常使用',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: '安全、边界与入口',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: '最短开始方式',
        intro: '如果你现在就要开始，先做这一件事。',
        paragraphs: [
          '阅读 https://mem9.ai/SKILL.md ，按照说明为 OpenClaw 安装并配置 mem9。这就是 mem9.ai 官方托管服务的主入口。',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a> 可以作为可选安装来源，但这份手册默认你走的是 mem9.ai 官网路径，这样和官网、Dashboard、支持材料保持一致。',
        ],
        bullets: [
          '按官方 onboarding 流程安装 mem9。',
          '把生成的 MEM9_API_KEY 妥善保存。',
          '之后在新机器或重连时继续使用同一个 key。',
          'setup 完成后打开 Your Memory 查看 Agent 实际记住了什么。',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: '一句话理解 mem9',
        paragraphs: [
          'mem9 = OpenClaw 的云端长期记忆 + 可视化记忆管理和洞察工具。',
          '它把原本脆弱、分散、难管理的本地 memory，变成一层官方托管、可持续、可共享、可检索、可审阅的产品能力。',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: '这份手册适合谁',
        intro: '这份手册面向想直接使用 mem9.ai 官方托管服务的用户。',
        bullets: [
          'mem9 是什么，以及它为什么适合长期使用。',
          '为什么 mem9 往往比本地 memory 文件更适合作为长期记忆层。',
          '怎样从 SKILL.md 开始，以及 setup 之后到底会得到什么。',
          'Your Memory 是做什么的，reconnect 和 uninstall 会发生什么。',
        ],
        subsections: [
          {
            title: '这份手册不讲什么',
            bullets: [
              '自建 Go 后端。',
              '自己部署 mem9 API 服务。',
              '自己搭数据库和整套运维基础设施。',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'mem9 解决什么问题',
        paragraphs: [
          '默认本地 memory 方案往往跟着一台机器走，重装、迁移或 reset 后容易丢，多个 Agent 之间难以共享，也很难长期回看、整理和管理。',
          'mem9 让重要信息跨会话持续存在，让记忆跟着 Agent 走，而不是跟着本地文件走；同时通过 Dashboard 让用户能看见、管理、导入、导出和分析记忆。',
          '更关键的是，mem9 的目标不是把整段旧聊天原样塞回 LLM，而是更接近一层基于 facts / insights 的 memory infrastructure：尽量把当前任务最相关、最精简的记忆带回模型。',
        ],
        bullets: [
          '少重复项目背景和个人偏好。',
          '少在重启、重置、换机后丢失关键上下文。',
          '少在多个 Agent 之间形成碎片化记忆。',
          '多一点对长期记忆的可见性和可控感。',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'OpenClaw 原生记忆和 mem9 的区别',
        intro: '最清楚的区分方式，不是说谁“更好”，而是看你到底在解决哪一类记忆问题。',
        paragraphs: [
          'OpenClaw 原生记忆并不是“没用”，但它解决的问题本质上是“让 Agent 把重要内容写进本地 Markdown，并为这些文件建立检索索引”。',
          'mem9 解决的是另一类问题：把记忆从“本地笔记文件 + chunk 检索”升级成“面向多 session、多 Agent、多设备、可共享、可运营的记忆基础设施”。',
        ],
        subsections: [
          {
            title: '如果你的需求是',
            bullets: [
              '单个 OpenClaw agent',
              '单台机器',
              '主要靠 `MEMORY.md` 和每天的 notes 记事',
              '可以接受 recall 回来的是原文 snippet / chunk',
            ],
            paragraphs: [
              '那么 OpenClaw 原生记忆通常够用。',
            ],
          },
          {
            title: '如果你的需求升级为',
            bullets: [
              '记忆要跨 session、跨 reset、跨机器稳定存在',
              '不想依赖 agent 有没有把信息正确写进 Markdown',
              '希望把长对话自动提炼成更稳定的 facts / insights',
              '需要 multi-agent 共享一个 memory pool',
              '需要区分 insight、pinned、session 等不同记忆层',
              '需要 API、dashboard、分析、治理能力',
            ],
            paragraphs: [
              '那么 OpenClaw native memory 很快就会碰到结构性上限，mem9 才是对应的产品形态。',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory 更像本地知识笔记本。',
          'mem9 更像外置的 agent memory system。',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: '核心能力',
        intro: '下面这些能力，是用户最直接会感受到的产品变化。',
        subsections: [
          {
            title: '云端长期记忆',
            paragraphs: [
              '长期有价值的信息保留在云端，而不是只留在当前会话里。这意味着 reset、重启和换设备都不必让 Agent 从零开始。',
            ],
          },
          {
            title: '共享空间',
            paragraphs: [
              '多个 Agent 可以连接到同一个 mem9 空间，复用同一份长期知识。这对多设备使用、团队共享项目上下文，以及自动化 Agent 反复处理同类任务都很有价值。',
            ],
          },
          {
            title: '混合召回',
            paragraphs: [
              'mem9 提供关键词 + 语义的 hybrid recall。它不只是按关键词翻旧记录，也尽量按当前任务相关性带回内容。',
            ],
            bullets: [
              '送进 LLM 的 context 更小。',
              '无关上下文更少，输入更精准。',
              'token 消耗更低，成本更低。',
              '长会话里更不容易频繁触发 context compaction。',
            ],
          },
          {
            title: 'Your Memory Dashboard',
            paragraphs: [
              'Your Memory 是 mem9 的主要可视化应用。它让记忆不再只是一个“看不见的副作用”，而是可以查看、管理、分析、导入和导出的产品界面。',
            ],
          },
          {
            title: '显式“记住这件事”',
            paragraphs: [
              '当 mem9 已经配置好，而用户明确说“记住这件事”“保存这个到 mem9”时，系统应把它视为真正的 durable write 请求，而不是普通聊天。随后系统再判断哪些内容值得进入长期记忆，并给出简短确认或失败原因。',
            ],
          },
          {
            title: 'Hook 模式与 Context Engine 支持',
            paragraphs: [
              'mem9 同时支持 Hook 模式和 Context Engine 模式。Hook 模式兼容性最好；Context Engine 模式则更强，因为它可以让 mem9 更直接参与上下文组装、消息摄取和 compaction 相关生命周期。',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: '官方安装路径',
        paragraphs: [
          '最简单的官方安装路径仍然是 SKILL.md。如果用户只记一个入口，就应该记住这个地址。',
        ],
        subsections: [
          {
            title: '从 mem9.ai/SKILL.md 开始',
            paragraphs: [
              '阅读 https://mem9.ai/SKILL.md，并在 OpenClaw 中按说明完成接入。这是官方托管流程的事实入口。',
            ],
          },
          {
            title: 'OpenClaw 里的典型 setup 选择',
            bullets: [
              'Create new mem9：生成新的 API key，创建新的记忆空间。',
              'Reconnect mem9：输入已有 API key，连回原来的记忆空间。',
              '使用同一个 API key 的多个 Agent 会实时共享同一份记忆。',
              '如果用户明确想切换空间，也可以之后再切换 API key。',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'setup 成功后，你会得到什么',
        bullets: [
          '一套已经连到 mem9.ai 的云端长期记忆。',
          '一个必须妥善保存的 MEM9_API_KEY。',
          '一个可以显式“记住这件事”的 OpenClaw。',
          '一个用来查看、整理、导入、导出和分析记忆的 Dashboard 入口。',
        ],
        paragraphs: [
          '从这里开始，用户的日常动作其实很清晰：让 Agent 长期记住重要背景，让多个 Agent 共享同一份长期知识，并在需要检查或清理时进入 Your Memory。',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Your Memory 是什么',
        intro: 'Your Memory 是 mem9 的主要可视化应用。',
        bullets: [
          '查看已有记忆。',
          '分析、审阅和清理内容。',
          '管理记忆条目。',
          '在用户明确要求时导入旧历史。',
          '导出当前记忆。',
        ],
        links: [
          {
            label: '打开 Your Memory',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: '日常使用时，mem9 会怎样改变体验',
        paragraphs: [
          '最直接的变化通常是：你不需要每次重新解释项目背景，长期知识不会只留在某次聊天里，而且你还能明确要求“把这件事记下来”。',
        ],
        subsections: [
          {
            title: '更适合长期记住的内容',
            bullets: [
              '偏好和工作风格。',
              '项目背景和稳定上下文。',
              '值得反复复用的规范与约定。',
              '已经验证过的结论和会反复使用的事实。',
            ],
          },
          {
            title: '不建议一开始就期待的事情',
            bullets: [
              '每句聊天都会自动变成高质量长期知识。',
              'setup 时自动导入所有旧本地历史。',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: '恢复、重连和 API key 保管',
        subsections: [
          {
            title: 'reconnect 的意义',
            paragraphs: [
              'Reconnect 是拿已有的 MEM9_API_KEY，把 Agent 接回原来的记忆空间；它不是重新创建一套新的记忆。',
            ],
          },
          {
            title: '新机器恢复',
            bullets: [
              '重新安装 mem9 插件。',
              '把同一个 MEM9_API_KEY 写回配置。',
              '继续使用原来的官方服务地址，除非你明确改过。',
              '重启并验证原来的记忆空间已经连回来了。',
            ],
          },
          {
            title: 'API key 要怎么保管',
            paragraphs: [
              '这个 key 应该被当成真正的秘密信息，最好保存进密码管理器或其他安全仓库。以后换机器、重装或 reconnect，都要靠它找回原来的记忆空间。',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: '卸载时，会发生什么，不会发生什么',
        intro: '卸载影响的是本地配置，不会直接删除远端云数据。',
        subsections: [
          {
            title: '卸载会做的事',
            bullets: [
              '移除这台机器上的 mem9 插件配置。',
              '在适用时恢复原来的本地 memory 配置。',
              '清理本地安装残留。',
            ],
          },
          {
            title: '卸载不会做的事',
            bullets: [
              '不会删除远端 mem9 云数据。',
              '不会吊销 MEM9_API_KEY。',
              '不会自动重置当前聊天 session。',
            ],
          },
        ],
        paragraphs: [
          '如果以后想把同一份记忆接回来，通常只需要重新安装 mem9，然后用原来的 API key reconnect。',
          '卸载流程应该只发生一次重启；如果还想 reset 当前 session，应当在卸载验证成功后作为单独后续动作处理。',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: '安全和信任基础',
        paragraphs: [
          'mem9 对自己的定位是面向生产场景的长期记忆层，而不是一个不可控黑盒。官方叙述强调的是清晰的数据处理边界，以及生产级云基础设施。',
        ],
        bullets: [
          '传输中加密。',
          '静态加密。',
          '访问控制。',
          '可审计性。',
          '清晰的数据处理边界。',
          '生产级云基础设施。',
        ],
        links: [
          {
            label: '安全概览',
            href: '/#security',
          },
          {
            label: 'TiDB Cloud 安全白皮书',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: '真实使用时，应该有什么预期',
        subsections: [
          {
            title: 'mem9 是长期记忆层，不是万能理解引擎',
            bullets: [
              '它擅长长期保留重要信息。',
              '它擅长在需要时带回相关记忆。',
              '它能减少重复解释和重复 setup 成本。',
              '它不保证每一轮都完美召回。',
            ],
          },
          {
            title: 'setup 不是导入流程',
            paragraphs: [
              '首次 setup 的目标是接通 mem9，而不是自动上传你过去所有本地历史。如果用户希望把本地 memory 导入 mem9，这应该是一个明确提出的请求，而不是系统在后台默认收集。',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: '给新用户的推荐顺序和官方入口',
        intro: '如果你第一次使用 mem9，推荐路径可以很简单。',
        bullets: [
          '打开 mem9.ai，把 SKILL.md 的一句话接入说明交给 OpenClaw。',
          '完成 setup 后立刻保存好 MEM9_API_KEY。',
          '先正常使用几天，让记忆空间有真实数据。',
          '随后进入 Your Memory 查看、整理和分析已经写入的记忆。',
        ],
        links: [
          {
            label: 'mem9 官网',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'mem9 GitHub 仓库',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
  ja: {
    meta: {
      title: 'mem9 ドキュメント | 公式ユーザーガイド',
      description:
        'OpenClaw 向け mem9 の公式ガイドです。setup、reconnect、Your Memory、長期記憶の挙動、セキュリティ、Context Engine 対応を説明します。',
    },
    hero: {
      eyebrow: 'ドキュメント',
      title: 'mem9 公式ユーザーガイド',
      intro:
        'mem9 は OpenClaw にクラウド長期記憶レイヤーを提供し、記憶の確認・管理・分析ができる可視化アプリも備えています。このページは mem9.ai の公式ホスト版を前提に、導入方法、setup 後に得られるもの、日常運用での期待値、そして長期的なメモリ運用の考え方をまとめています。',
      summaryTitle: 'このドキュメントでわかること',
      summaryBullets: [
        '最速の公式入口は mem9.ai/SKILL.md です。',
        'mem9 がローカル memory ファイルと比べて何を変えるのか。',
        'setup、reconnect、uninstall、Dashboard の実際の挙動。',
        'Hook モードと Context Engine 対応の位置づけ。',
      ],
      tocTitle: '目次',
    },
    tocGroups: [
      {
        title: 'はじめに',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: 'なぜ mem9 か',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: 'セットアップと日常利用',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: 'セキュリティ・制約・公式入口',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: '最短の始め方',
        intro: '今すぐ始めるなら、まずはこれだけです。',
        paragraphs: [
          'https://mem9.ai/SKILL.md を読み、案内に従って OpenClaw に mem9 をインストール・設定してください。これが mem9.ai 公式ホスト版の主入口です。',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a> も任意のインストール元として利用できますが、このガイドは公式サイト経由の体験を前提にしています。',
        ],
        bullets: [
          '公式 onboarding フローから mem9 を導入する。',
          '生成された MEM9_API_KEY を安全に保存する。',
          '新しいマシンや reconnect 時にも同じ key を使う。',
          'setup 後は Your Memory を開いて、実際に何が保存されたか確認する。',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: 'mem9 を一言で言うと',
        paragraphs: [
          'mem9 は OpenClaw 向けのクラウド長期記憶と、記憶を管理・分析するための可視化ツールです。',
          '壊れやすく分散しがちなローカル memory を、継続的に使える公式ホスト型の製品レイヤーに変えます。',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: 'このガイドの対象',
        intro: 'このガイドは mem9.ai の公式ホストサービスをそのまま使いたいユーザー向けです。',
        bullets: [
          'mem9 とは何か、なぜ長期利用に向いているか。',
          'なぜ mem9 がローカル memory ファイルより長期記憶レイヤーに向いているか。',
          'SKILL.md からどう始めるか、setup 後に何を得るか。',
          'Your Memory の役割と、reconnect・uninstall の挙動。',
        ],
        subsections: [
          {
            title: 'このガイドで扱わないこと',
            bullets: [
              'Go バックエンドのセルフホスト。',
              'mem9 API サービスの自己デプロイ。',
              'データベースや運用基盤の自前構築。',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'mem9 が解決する問題',
        paragraphs: [
          'ローカル memory は 1 台のマシンに結びつきやすく、再インストールや移行後に失われやすく、複数 Agent 間で共有しづらいという問題があります。',
          'mem9 は重要な情報をセッションをまたいで保持し、記憶を Agent に追従させ、Dashboard から記憶を確認・整理・入出力・分析できるようにします。',
          'また、古い会話ログをそのまま詰め込むのではなく、facts / insights に近いメモリレイヤーとして、今のタスクに本当に必要な記憶だけを返すことを目指します。',
        ],
        bullets: [
          'プロジェクト背景や好みの説明を繰り返さなくてよくなる。',
          '再起動・reset・マシン変更後の情報喪失が減る。',
          '複数 Agent 間の記憶断片化を抑えられる。',
          '何が記憶されているかを把握しやすくなる。',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'OpenClaw 標準メモリと mem9 の違い',
        intro: 'いちばんわかりやすい違いは、どちらが優れているかではなく、解いている記憶の問題が違うという点です。',
        paragraphs: [
          'OpenClaw の標準 memory は役に立たないわけではありません。本質的には、重要な情報をローカル Markdown に書き出し、そのファイルに検索インデックスを作る仕組みです。',
          'mem9 が解くのは別の問題です。記憶を「ローカルノート + chunk 検索」から、「複数 session・複数 Agent・複数デバイスで共有でき、継続運用できる記憶基盤」へ引き上げます。',
        ],
        subsections: [
          {
            title: '次の条件なら OpenClaw 標準メモリで十分なことが多い',
            bullets: [
              'OpenClaw Agent が 1 つだけ。',
              '使うマシンが 1 台だけ。',
              '主に `MEMORY.md` と daily notes に依存している。',
              '想起結果が元の snippet / chunk でも問題ない。',
            ],
          },
          {
            title: '次の条件なら mem9 が適した形になる',
            bullets: [
              '記憶を session、reset、マシン変更をまたいで安定して残したい。',
              'Agent が Markdown を正しく書けたかどうかに依存したくない。',
              '長い会話から、より安定した facts / insights を抽出したい。',
              '複数 Agent で同じ memory pool を共有したい。',
              'insight、pinned、session など異なる記憶レイヤーを使い分けたい。',
              'API、dashboard、分析、運用管理が必要。',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory はローカル知識ノートに近い。',
          'mem9 は外部の agent memory system に近い。',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: 'コア機能',
        intro: '以下はユーザーがもっとも直接感じる変化です。',
        subsections: [
          {
            title: 'クラウド長期記憶',
            paragraphs: [
              '価値のある長期情報を現在の会話だけでなくクラウドに保持します。reset、再起動、デバイス変更があっても最初からやり直しになりません。',
            ],
          },
          {
            title: '共有スペース',
            paragraphs: [
              '複数 Agent が同じ mem9 スペースに接続し、同じ長期知識を共有できます。マルチデバイス利用やチーム共有に向いています。',
            ],
          },
          {
            title: 'ハイブリッド想起',
            paragraphs: [
              'mem9 はキーワード検索と意味検索を組み合わせて、現在のタスクに関連する内容を返します。',
            ],
            bullets: [
              'LLM に送る context を小さくできる。',
              '無関係な文脈を減らせる。',
              'token 消費とコストを抑えやすい。',
              '長いセッションでも context compaction の圧力を下げられる。',
            ],
          },
          {
            title: 'Your Memory Dashboard',
            paragraphs: [
              'Your Memory は mem9 の主要な可視化アプリです。記憶を確認、管理、分析、インポート、エクスポートできます。',
            ],
          },
          {
            title: '明示的な「これを覚えて」書き込み',
            paragraphs: [
              'mem9 が設定済みなら、「これを覚えて」「これを mem9 に保存して」のような明示的な依頼は、通常の会話ではなく durable write として扱われるべきです。',
            ],
          },
          {
            title: 'Hook モードと Context Engine 対応',
            paragraphs: [
              'mem9 は Hook モードと Context Engine モードの両方をサポートします。互換性は Hook モードが最も高く、より強力なのは Context Engine モードです。',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: '公式インストールフロー',
        paragraphs: [
          'もっともシンプルな公式インストール経路は SKILL.md です。ひとつだけ覚えるならこの URL を覚えてください。',
        ],
        subsections: [
          {
            title: 'mem9.ai/SKILL.md から始める',
            paragraphs: [
              'https://mem9.ai/SKILL.md を読み、OpenClaw 内で案内に従って接続します。これが公式ホスト版の基準フローです。',
            ],
          },
          {
            title: 'OpenClaw 内での代表的な setup 選択肢',
            bullets: [
              'Create new mem9: 新しい API key を生成して新規メモリ空間を作る。',
              'Reconnect mem9: 既存の API key を入力して元の空間に接続し直す。',
              '同じ API key を使う Agent は同じ記憶空間を共有する。',
              '別空間に切り替えたい場合は、後から API key を変更できる。',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'setup 完了後に得られるもの',
        bullets: [
          'mem9.ai に接続されたクラウド長期記憶。',
          '安全に保管すべき MEM9_API_KEY。',
          '明示的に記憶を書き込める OpenClaw 環境。',
          '記憶の確認・整理・分析・入出力ができる Dashboard 入口。',
        ],
        paragraphs: [
          '以後の主な操作はシンプルです。重要な背景を覚えさせる、複数 Agent で同じ記憶を共有する、必要な時に Your Memory で確認・整理する、の 3 つです。',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Your Memory とは',
        intro: 'Your Memory は mem9 の主要な可視化アプリです。',
        bullets: [
          '既存の記憶を確認する。',
          '内容を分析・レビュー・整理する。',
          '記憶エントリを管理する。',
          'ユーザーが明示的に求めた場合に旧履歴をインポートする。',
          '現在の記憶をエクスポートする。',
        ],
        links: [
          {
            label: 'Your Memory を開く',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: '日常利用で mem9 が変えること',
        paragraphs: [
          'もっとも直接的な変化は、毎回同じプロジェクト背景や作業ルールを説明し直さなくてよくなることです。',
        ],
        subsections: [
          {
            title: '長期記憶に向いている内容',
            bullets: [
              '好みや作業スタイル。',
              'プロジェクト背景と安定した文脈。',
              '繰り返し使う規約や約束事。',
              '検証済みの結論や再利用される事実。',
            ],
          },
          {
            title: '最初から期待しすぎないこと',
            bullets: [
              'すべての会話が自動的に高品質な長期知識になるわけではない。',
              'setup 時に旧ローカル履歴が自動ですべて取り込まれるわけではない。',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: 'reconnect・復元・API key の管理',
        subsections: [
          {
            title: 'reconnect の意味',
            paragraphs: [
              'Reconnect とは、既存の MEM9_API_KEY を使って元の記憶空間に戻ることです。新しい空間を作ることではありません。',
            ],
          },
          {
            title: '新しいマシンでの復元',
            bullets: [
              'mem9 プラグインを再インストールする。',
              '同じ MEM9_API_KEY を設定に戻す。',
              '意図的に変えていない限り、元の公式サービス URL を使い続ける。',
              '再起動して元の記憶空間に接続されたことを確認する。',
            ],
          },
          {
            title: 'API key の保管',
            paragraphs: [
              'この key は本物の秘密情報として扱い、パスワードマネージャーや安全な保管場所に入れてください。再接続や移行時の鍵になります。',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: 'uninstall で起きること / 起きないこと',
        intro: 'uninstall はローカル設定に影響しますが、クラウド上のデータは直接削除しません。',
        subsections: [
          {
            title: 'uninstall が行うこと',
            bullets: [
              'そのマシン上の mem9 プラグイン設定を削除する。',
              '必要に応じて元のローカル memory 設定を戻す。',
              'ローカルのインストール残骸を整理する。',
            ],
          },
          {
            title: 'uninstall で行われないこと',
            bullets: [
              'リモートの mem9 クラウドデータは削除されない。',
              'MEM9_API_KEY は失効しない。',
              '現在のチャット session が自動で reset されることはない。',
            ],
          },
        ],
        paragraphs: [
          '同じ記憶を後で再接続したい場合は、通常は再インストールして元の API key で reconnect するだけで十分です。',
          'uninstall フローは 1 回の再起動で完了する前提であり、現在の session の reset は検証成功後の別フォローアップです。',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: 'セキュリティと信頼の基盤',
        paragraphs: [
          'mem9 は、制御不能なブラックボックスではなく、本番運用を前提とした長期記憶レイヤーとして位置づけられています。説明の中心は、明確なデータ処理境界と本番級クラウド基盤です。',
        ],
        bullets: [
          '通信中の暗号化。',
          '保存時の暗号化。',
          'アクセス制御。',
          '監査可能性。',
          '明確なデータ処理境界。',
          '本番級クラウド基盤。',
        ],
        links: [
          {
            label: 'セキュリティ概要',
            href: '/#security',
          },
          {
            label: 'TiDB Cloud セキュリティホワイトペーパー',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: '実運用での期待値',
        subsections: [
          {
            title: 'mem9 は長期記憶レイヤーであり、万能な理解エンジンではない',
            bullets: [
              '重要な情報を長期に保つのが得意。',
              '必要な時に関連記憶を呼び戻すのが得意。',
              '繰り返し説明するコストを減らせる。',
              '毎回完璧に想起できることを保証するものではない。',
            ],
          },
          {
            title: 'setup は import そのものではない',
            paragraphs: [
              '初回 setup の目的は mem9 を接続することであり、過去のローカル履歴を自動的にすべてアップロードすることではありません。ローカル memory を取り込みたい場合は、明示的なユーザー要求として行うべきです。',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: '新規ユーザー向けおすすめ順序と公式入口',
        intro: '初めて mem9 を使うなら、次の流れがもっともシンプルです。',
        bullets: [
          'mem9.ai を開き、SKILL.md の導入文を OpenClaw に渡す。',
          'setup 完了後すぐに MEM9_API_KEY を保存する。',
          '数日使って実データをためる。',
          'その後 Your Memory で記憶を確認・整理・分析する。',
        ],
        links: [
          {
            label: 'mem9 公式サイト',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'mem9 GitHub リポジトリ',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
  ko: {
    meta: {
      title: 'mem9 문서 | 공식 사용자 가이드',
      description:
        'OpenClaw 사용자를 위한 mem9 공식 가이드입니다. setup, reconnect, Your Memory, 장기 메모리 동작, 보안, Context Engine 지원을 설명합니다.',
    },
    hero: {
      eyebrow: '문서',
      title: 'mem9 공식 사용자 가이드',
      intro:
        'mem9는 OpenClaw에 클라우드 장기 메모리 레이어를 제공하고, 저장된 메모리를 확인·관리·분석할 수 있는 시각화 앱도 함께 제공합니다. 이 문서는 공식 mem9.ai 호스팅 경험을 기준으로 설치 방법, setup 이후 얻는 것, 일상 사용에서 기대할 점, 그리고 장기 운영 방식을 정리합니다.',
      summaryTitle: '이 문서에서 다루는 내용',
      summaryBullets: [
        '가장 빠른 공식 진입점은 mem9.ai/SKILL.md입니다.',
        'mem9가 로컬 memory 파일 대비 무엇을 바꾸는지.',
        'setup, reconnect, uninstall, Dashboard의 실제 동작.',
        'Hook 모드와 Context Engine 지원의 위치.',
      ],
      tocTitle: '목차',
    },
    tocGroups: [
      {
        title: '시작하기',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: '왜 mem9인가',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: '설치와 일상 사용',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: '보안, 한계, 공식 경로',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: '가장 빠른 시작 방법',
        intro: '지금 바로 시작하려면 이 한 가지부터 하세요.',
        paragraphs: [
          'https://mem9.ai/SKILL.md 를 읽고 안내에 따라 OpenClaw에 mem9를 설치하고 설정하세요. 이것이 mem9.ai 공식 호스팅 서비스의 기본 진입점입니다.',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a>도 선택 가능한 설치 경로이지만, 이 가이드는 공식 웹사이트 경로를 기준으로 작성되었습니다.',
        ],
        bullets: [
          '공식 onboarding 흐름으로 mem9를 설치한다.',
          '생성된 MEM9_API_KEY를 안전하게 보관한다.',
          '새 기기나 reconnect 때도 같은 key를 사용한다.',
          'setup 후 Your Memory를 열어 실제로 무엇이 저장됐는지 확인한다.',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: '한 문장으로 보는 mem9',
        paragraphs: [
          'mem9는 OpenClaw를 위한 클라우드 장기 메모리와 시각적 메모리 관리·분석 도구입니다.',
          '깨지기 쉽고 흩어지기 쉬운 로컬 memory를, 지속적으로 사용할 수 있는 공식 호스팅 제품 레이어로 바꿉니다.',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: '이 가이드는 누구를 위한 문서인가',
        intro: '이 문서는 mem9.ai 공식 호스팅 서비스를 바로 사용하려는 사용자를 위한 문서입니다.',
        bullets: [
          'mem9가 무엇인지, 왜 장기 사용에 적합한지.',
          '왜 mem9가 로컬 memory 파일보다 장기 메모리 레이어로 더 적합한지.',
          'SKILL.md에서 어떻게 시작하고 setup 후 무엇을 얻게 되는지.',
          'Your Memory의 역할과 reconnect, uninstall의 동작.',
        ],
        subsections: [
          {
            title: '이 가이드에서 다루지 않는 내용',
            bullets: [
              'Go 백엔드 셀프 호스팅.',
              'mem9 API 서비스 직접 배포.',
              '데이터베이스와 운영 인프라 직접 구성.',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'mem9가 해결하는 문제',
        paragraphs: [
          '기본 로컬 memory 방식은 한 대의 기기에 묶이기 쉽고, 재설치나 마이그레이션 이후 잃어버리기 쉽고, 여러 Agent 간에 공유하기 어렵습니다.',
          'mem9는 중요한 정보를 세션 간에 유지하고, 메모리를 기기가 아니라 Agent에 연결하며, Dashboard를 통해 메모리를 보고 정리하고 가져오고 내보내고 분석할 수 있게 합니다.',
          '또한 오래된 대화 전체를 그대로 프롬프트에 넣기보다, facts / insights 중심의 메모리 인프라처럼 현재 작업에 가장 관련 있는 메모리만 가져오도록 설계됩니다.',
        ],
        bullets: [
          '프로젝트 배경과 선호를 반복 설명하는 일이 줄어든다.',
          '재시작, reset, 기기 변경 후 손실이 줄어든다.',
          '여러 Agent 사이의 메모리 파편화가 줄어든다.',
          '시스템이 무엇을 기억하는지 더 잘 통제할 수 있다.',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'OpenClaw 기본 메모리와 mem9의 차이',
        intro: '가장 명확한 차이는 어느 쪽이 더 “좋다”가 아니라, 서로 다른 메모리 문제를 해결한다는 점입니다.',
        paragraphs: [
          'OpenClaw의 기본 메모리가 쓸모없는 것은 아닙니다. 본질적으로는 중요한 정보를 로컬 Markdown에 기록하게 하고, 그 파일들 위에 검색 인덱스를 만드는 방식입니다.',
          'mem9는 다른 종류의 문제를 해결합니다. 메모리를 “로컬 노트 파일 + chunk 검색”에서 “여러 session, 여러 Agent, 여러 기기에서 공유하고 운영할 수 있는 메모리 인프라”로 끌어올립니다.',
        ],
        subsections: [
          {
            title: '다음 조건이면 OpenClaw 기본 메모리로도 충분한 경우가 많습니다',
            bullets: [
              'OpenClaw Agent가 하나뿐이다.',
              '기기가 한 대뿐이다.',
              '주로 `MEMORY.md`와 일일 notes에 의존한다.',
              '리콜 결과가 원문 snippet / chunk여도 괜찮다.',
            ],
          },
          {
            title: '다음 조건이면 mem9가 더 맞는 제품 형태입니다',
            bullets: [
              '메모리가 session, reset, 기기 변경을 넘어 안정적으로 유지되어야 한다.',
              'Agent가 Markdown을 제대로 썼는지에 메모리 품질이 좌우되길 원하지 않는다.',
              '긴 대화를 더 안정적인 facts / insights로 정리하고 싶다.',
              '여러 Agent가 하나의 memory pool을 공유해야 한다.',
              'insight, pinned, session 같은 서로 다른 메모리 레이어가 필요하다.',
              'API, dashboard, 분석, 운영 관리 기능이 필요하다.',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory는 로컬 지식 노트에 더 가깝다.',
          'mem9는 외부 agent memory system에 더 가깝다.',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: '핵심 기능',
        intro: '아래 항목은 사용자가 가장 직접적으로 체감하는 변화입니다.',
        subsections: [
          {
            title: '클라우드 장기 메모리',
            paragraphs: [
              '가치 있는 장기 정보를 현재 대화 안에만 두지 않고 클라우드에 유지합니다. reset, 재시작, 기기 변경이 있어도 처음부터 다시 시작할 필요가 없습니다.',
            ],
          },
          {
            title: '공유 공간',
            paragraphs: [
              '여러 Agent가 같은 mem9 공간에 연결해 같은 장기 지식을 공유할 수 있습니다. 멀티 디바이스 사용, 팀 컨텍스트 공유에 특히 유용합니다.',
            ],
          },
          {
            title: '하이브리드 리콜',
            paragraphs: [
              'mem9는 키워드와 의미 기반 검색을 결합해 현재 작업과 더 관련 있는 메모리를 되돌려줍니다.',
            ],
            bullets: [
              'LLM에 전달하는 context를 더 작게 유지할 수 있다.',
              '관련 없는 문맥이 줄어든다.',
              'token 사용량과 비용을 낮추기 쉽다.',
              '긴 세션에서 context compaction 압력을 줄인다.',
            ],
          },
          {
            title: 'Your Memory Dashboard',
            paragraphs: [
              'Your Memory는 mem9의 주요 시각화 앱입니다. 메모리 보기, 관리, 분석, 가져오기, 내보내기를 한곳에서 수행할 수 있습니다.',
            ],
          },
          {
            title: '명시적인 “이걸 기억해” 쓰기',
            paragraphs: [
              'mem9가 설정된 뒤 사용자가 “이걸 기억해”, “이 내용을 mem9에 저장해”라고 명확히 말하면, 시스템은 이를 일반 대화가 아니라 durable write 요청으로 취급해야 합니다.',
            ],
          },
          {
            title: 'Hook 모드와 Context Engine 지원',
            paragraphs: [
              'mem9는 Hook 모드와 Context Engine 모드를 모두 지원합니다. 호환성은 Hook 모드가 가장 높고, 더 강력한 경로는 Context Engine 모드입니다.',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: '공식 설치 경로',
        paragraphs: [
          '가장 간단한 공식 설치 경로는 여전히 SKILL.md입니다. 하나만 기억해야 한다면 그 URL을 기억하면 됩니다.',
        ],
        subsections: [
          {
            title: 'mem9.ai/SKILL.md 에서 시작하기',
            paragraphs: [
              'https://mem9.ai/SKILL.md 를 읽고 OpenClaw 안에서 안내에 따라 연결하세요. 이것이 공식 호스팅 워크플로의 기준입니다.',
            ],
          },
          {
            title: 'OpenClaw 안의 대표적인 setup 선택지',
            bullets: [
              'Create new mem9: 새 API key를 만들고 새 메모리 공간을 생성한다.',
              'Reconnect mem9: 기존 API key를 입력해 원래 메모리 공간에 다시 연결한다.',
              '같은 API key를 쓰는 Agent는 같은 메모리 공간을 공유한다.',
              '다른 공간으로 바꾸고 싶다면 나중에 API key를 바꿀 수 있다.',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'setup 이후 얻게 되는 것',
        bullets: [
          'mem9.ai에 연결된 클라우드 장기 메모리.',
          '안전하게 보관해야 하는 MEM9_API_KEY.',
          '명시적으로 메모리를 저장할 수 있는 OpenClaw 환경.',
          '메모리를 보고 정리하고 분석하고 가져오고 내보낼 수 있는 Dashboard 진입점.',
        ],
        paragraphs: [
          '이후의 핵심 동작은 단순합니다. 중요한 배경을 기억시키고, 여러 Agent가 같은 기억을 공유하게 하고, 필요할 때 Your Memory에서 확인하고 정리하면 됩니다.',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Your Memory란 무엇인가',
        intro: 'Your Memory는 mem9의 주요 시각화 앱입니다.',
        bullets: [
          '기존 메모리 보기.',
          '내용 분석, 검토, 정리.',
          '메모리 항목 관리.',
          '사용자가 명시적으로 요청한 경우 과거 데이터 가져오기.',
          '현재 메모리 내보내기.',
        ],
        links: [
          {
            label: 'Your Memory 열기',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: '일상 사용에서 어떻게 달라지는가',
        paragraphs: [
          '가장 즉각적인 변화는 프로젝트 배경, 선호, 작업 규칙을 매번 다시 설명하지 않아도 된다는 점입니다.',
        ],
        subsections: [
          {
            title: '장기 기억에 특히 적합한 내용',
            bullets: [
              '선호와 작업 스타일.',
              '프로젝트 배경과 안정적인 컨텍스트.',
              '반복해 쓰는 규칙과 합의.',
              '검증된 결론과 반복 활용되는 사실.',
            ],
          },
          {
            title: '처음부터 기대하지 않는 것이 좋은 것들',
            bullets: [
              '모든 대화가 자동으로 고품질 장기 지식이 되는 것은 아니다.',
              'setup 시 과거 로컬 이력이 자동으로 모두 가져와지는 것은 아니다.',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: '복구, reconnect, API key 관리',
        subsections: [
          {
            title: 'reconnect의 의미',
            paragraphs: [
              'Reconnect는 기존 MEM9_API_KEY로 원래 메모리 공간에 다시 연결하는 것을 뜻합니다. 새 공간을 만드는 것이 아닙니다.',
            ],
          },
          {
            title: '새 기기에서 복구하기',
            bullets: [
              'mem9 플러그인을 다시 설치한다.',
              '같은 MEM9_API_KEY를 설정에 다시 입력한다.',
              '의도적으로 바꾼 것이 아니라면 원래 공식 서비스 URL을 유지한다.',
              '재시작 후 원래 메모리 공간이 보이는지 확인한다.',
            ],
          },
          {
            title: 'API key 보관 방법',
            paragraphs: [
              '이 key는 실제 비밀 값으로 취급해야 하며, 비밀번호 관리자나 안전한 저장소에 보관하는 것이 좋습니다. reconnect와 기기 이전의 핵심입니다.',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: '제거 시 일어나는 일과 일어나지 않는 일',
        intro: 'uninstall은 로컬 설정에 영향을 주지만 원격 클라우드 데이터는 직접 삭제하지 않습니다.',
        subsections: [
          {
            title: 'uninstall이 하는 일',
            bullets: [
              '해당 기기의 mem9 플러그인 설정을 제거한다.',
              '해당되는 경우 이전 로컬 memory 설정을 복원한다.',
              '로컬 설치 잔여물을 정리한다.',
            ],
          },
          {
            title: 'uninstall이 하지 않는 일',
            bullets: [
              '원격 mem9 클라우드 데이터는 삭제되지 않는다.',
              'MEM9_API_KEY는 폐기되지 않는다.',
              '현재 채팅 session이 자동으로 reset 되지 않는다.',
            ],
          },
        ],
        paragraphs: [
          '같은 기억을 나중에 다시 연결하고 싶다면, 보통은 다시 설치하고 원래 API key로 reconnect 하면 충분합니다.',
          'uninstall 흐름은 한 번의 재시작만 전제로 하며, 현재 session reset은 제거 검증이 끝난 뒤의 별도 후속 작업입니다.',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: '보안과 신뢰의 기반',
        paragraphs: [
          'mem9는 통제 불가능한 블랙박스가 아니라, 프로덕션 장기 메모리 레이어로 자리매김합니다. 공식 설명의 중심은 명확한 데이터 처리 경계와 프로덕션급 클라우드 인프라입니다.',
        ],
        bullets: [
          '전송 중 암호화.',
          '저장 시 암호화.',
          '접근 제어.',
          '감사 가능성.',
          '명확한 데이터 처리 경계.',
          '프로덕션급 클라우드 인프라.',
        ],
        links: [
          {
            label: '보안 개요',
            href: '/#security',
          },
          {
            label: 'TiDB Cloud 보안 백서',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: '실사용에서의 기대치와 한계',
        subsections: [
          {
            title: 'mem9는 장기 메모리 레이어이지 만능 이해 엔진이 아니다',
            bullets: [
              '중요한 정보를 장기간 보존하는 데 강하다.',
              '필요할 때 관련 메모리를 불러오는 데 강하다.',
              '반복 설명과 setup 비용을 줄여준다.',
              '매 턴 완벽한 리콜을 보장하는 것은 아니다.',
            ],
          },
          {
            title: 'setup은 import 그 자체가 아니다',
            paragraphs: [
              '초기 setup의 목표는 mem9를 연결하는 것이지, 과거 로컬 기록을 자동으로 모두 업로드하는 것이 아닙니다. 로컬 memory를 가져오려면 명시적 사용자 요청이어야 합니다.',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: '신규 사용자를 위한 추천 순서와 공식 링크',
        intro: '처음 mem9를 사용하는 사용자에게는 다음 순서가 가장 단순합니다.',
        bullets: [
          'mem9.ai를 열고 SKILL.md 안내 문장을 OpenClaw에 전달한다.',
          'setup 직후 MEM9_API_KEY를 바로 저장한다.',
          '며칠 사용해 실제 메모리 데이터를 만든다.',
          '그다음 Your Memory에서 메모리를 검토하고 정리하고 분석한다.',
        ],
        links: [
          {
            label: 'mem9 공식 웹사이트',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'mem9 GitHub 저장소',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
  id: {
    meta: {
      title: 'Dokumentasi mem9 | Panduan Pengguna Resmi',
      description:
        'Panduan resmi mem9 untuk pengguna OpenClaw. Mencakup setup, reconnect, Your Memory, perilaku memori jangka panjang, keamanan, dan dukungan Context Engine.',
    },
    hero: {
      eyebrow: 'Dokumentasi',
      title: 'Panduan Pengguna Resmi mem9',
      intro:
        'mem9 memberi OpenClaw lapisan memori jangka panjang di cloud, plus aplikasi visual untuk melihat, mengelola, dan menganalisis memori. Halaman ini berfokus pada pengalaman resmi mem9.ai: cara memasang, apa yang didapat setelah setup, apa yang perlu diharapkan dalam penggunaan harian, dan bagaimana merawat memori itu dari waktu ke waktu.',
      summaryTitle: 'Apa yang dibahas di dokumen ini',
      summaryBullets: [
        'Jalur resmi tercepat dimulai dari mem9.ai/SKILL.md.',
        'Apa yang berubah ketika memakai mem9 dibanding file memory lokal.',
        'Perilaku nyata setup, reconnect, uninstall, dan Dashboard.',
        'Posisi Hook mode dan dukungan Context Engine.',
      ],
      tocTitle: 'Daftar isi',
    },
    tocGroups: [
      {
        title: 'Memulai',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: 'Mengapa mem9',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: 'Setup dan penggunaan harian',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: 'Keamanan, batasan, dan jalur resmi',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: 'Cara tercepat untuk mulai',
        intro: 'Jika Anda ingin mulai sekarang juga, lakukan satu hal ini dulu.',
        paragraphs: [
          'Baca https://mem9.ai/SKILL.md lalu ikuti petunjuk untuk memasang dan mengonfigurasi mem9 di OpenClaw. Itulah pintu masuk utama untuk layanan hosted resmi mem9.ai.',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a> tetap bisa dipakai sebagai sumber pemasangan opsional, tetapi panduan ini mengasumsikan jalur resmi dari situs mem9.ai agar pengalaman tetap konsisten.',
        ],
        bullets: [
          'Pasang mem9 lewat alur onboarding resmi.',
          'Simpan MEM9_API_KEY yang dihasilkan di tempat aman.',
          'Gunakan key yang sama saat reconnect atau pindah mesin.',
          'Setelah setup selesai, buka Your Memory untuk melihat apa yang benar-benar disimpan.',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: 'mem9 dalam satu kalimat',
        paragraphs: [
          'mem9 = memori jangka panjang di cloud untuk OpenClaw + alat visual untuk mengelola dan menganalisis memori.',
          'Ia mengubah memory lokal yang rapuh, tersebar, dan sulit dikelola menjadi lapisan produk hosted resmi yang bisa dipakai secara berkelanjutan.',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: 'Panduan ini untuk siapa',
        intro: 'Panduan ini ditujukan bagi pengguna yang ingin langsung memakai layanan hosted resmi mem9.ai.',
        bullets: [
          'Apa itu mem9 dan mengapa cocok untuk penggunaan jangka panjang.',
          'Mengapa mem9 sering lebih cocok daripada file memory lokal sebagai lapisan memori jangka panjang.',
          'Cara mulai dari SKILL.md dan apa yang didapat setelah setup.',
          'Apa fungsi Your Memory, dan apa yang terjadi saat reconnect atau uninstall.',
        ],
        subsections: [
          {
            title: 'Apa yang tidak dibahas di panduan ini',
            bullets: [
              'Self-host Go backend.',
              'Deploy layanan API mem9 sendiri.',
              'Menjalankan database dan infrastruktur operasional sendiri.',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'Masalah yang diselesaikan mem9',
        paragraphs: [
          'Skema memory lokal biasanya terikat ke satu mesin, mudah hilang setelah reset atau migrasi, sulit dibagikan antar Agent, dan sulit ditinjau atau dibersihkan dari waktu ke waktu.',
          'mem9 membuat informasi penting bertahan lintas sesi, membuat memori mengikuti Agent alih-alih file lokal, dan memberi Dashboard agar pengguna bisa melihat, mengelola, mengimpor, mengekspor, dan menganalisis memori.',
          'Yang terpenting, tujuan mem9 bukan memasukkan ulang seluruh percakapan lama ke LLM, melainkan bertindak seperti memory infrastructure berbasis facts / insights dan hanya mengembalikan bagian yang paling relevan untuk tugas saat ini.',
        ],
        bullets: [
          'Lebih sedikit mengulang latar belakang proyek dan preferensi.',
          'Lebih sedikit kehilangan konteks setelah restart, reset, atau pindah mesin.',
          'Lebih sedikit fragmentasi memori antar Agent.',
          'Lebih banyak visibilitas dan kontrol atas apa yang benar-benar diingat sistem.',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'Perbedaan memori native OpenClaw dan mem9',
        intro: 'Perbedaan paling jelas bukan soal mana yang “lebih bagus”, tetapi soal jenis masalah memori yang diselesaikan.',
        paragraphs: [
          'Memori native OpenClaw bukan berarti tidak berguna. Pada dasarnya ia membantu Agent menulis informasi penting ke file Markdown lokal lalu membangun indeks pencarian di atas file-file itu.',
          'mem9 menyelesaikan masalah yang berbeda. Ia menaikkan memori dari “file catatan lokal + pencarian chunk” menjadi infrastruktur memori yang bisa bertahan, dibagikan, dan dioperasikan lintas session, Agent, dan perangkat.',
        ],
        subsections: [
          {
            title: 'Jika kebutuhan Anda seperti ini',
            bullets: [
              'Satu OpenClaw agent.',
              'Satu mesin.',
              'Terutama mengandalkan `MEMORY.md` dan notes harian.',
              'Tidak masalah jika recall mengembalikan snippet atau chunk asli.',
            ],
            paragraphs: [
              'Maka memori native OpenClaw biasanya sudah cukup.',
            ],
          },
          {
            title: 'Jika kebutuhan Anda naik menjadi seperti ini',
            bullets: [
              'Memori harus stabil lintas session, reset, dan perpindahan mesin.',
              'Anda tidak ingin kualitas memori bergantung pada apakah Agent menulis Markdown dengan benar.',
              'Anda ingin percakapan panjang diringkas menjadi facts / insights yang lebih stabil.',
              'Anda membutuhkan banyak Agent berbagi satu memory pool.',
              'Anda membutuhkan lapisan memori berbeda seperti insight, pinned, dan session.',
              'Anda membutuhkan API, dashboard, analisis, dan tata kelola memori.',
            ],
            paragraphs: [
              'Maka OpenClaw native memory akan cepat mencapai batas strukturalnya, dan mem9 menjadi bentuk produk yang lebih tepat.',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory lebih mirip notebook pengetahuan lokal.',
          'mem9 lebih mirip agent memory system eksternal.',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: 'Kemampuan inti',
        intro: 'Inilah perubahan produk yang paling langsung dirasakan pengguna.',
        subsections: [
          {
            title: 'Memori jangka panjang di cloud',
            paragraphs: [
              'Informasi jangka panjang yang bernilai disimpan di cloud, bukan hanya di sesi saat ini. Reset, restart, dan ganti perangkat tidak memaksa Agent mulai dari nol.',
            ],
          },
          {
            title: 'Ruang bersama',
            paragraphs: [
              'Beberapa Agent dapat terhubung ke ruang mem9 yang sama dan berbagi pengetahuan jangka panjang yang sama. Cocok untuk multi-device, kolaborasi tim, dan automation berulang.',
            ],
          },
          {
            title: 'Hybrid recall',
            paragraphs: [
              'mem9 menggabungkan recall berbasis kata kunci dan semantik agar hasil yang dikembalikan lebih relevan terhadap tugas saat ini.',
            ],
            bullets: [
              'Context yang dikirim ke LLM menjadi lebih kecil.',
              'Konteks yang tidak relevan berkurang.',
              'Penggunaan token dan biaya lebih rendah.',
              'Tekanan context compaction di sesi panjang berkurang.',
            ],
          },
          {
            title: 'Your Memory Dashboard',
            paragraphs: [
              'Your Memory adalah aplikasi visual utama mem9. Pengguna bisa melihat, mengelola, menganalisis, mengimpor, dan mengekspor memori dari sana.',
            ],
          },
          {
            title: 'Write eksplisit “ingat ini”',
            paragraphs: [
              'Jika mem9 sudah dikonfigurasi, permintaan seperti “ingat ini” atau “simpan ini ke mem9” seharusnya diperlakukan sebagai durable write sungguhan, bukan percakapan biasa.',
            ],
          },
          {
            title: 'Hook mode dan dukungan Context Engine',
            paragraphs: [
              'mem9 mendukung Hook mode dan Context Engine mode. Kompatibilitas terbaik ada di Hook mode, sedangkan jalur yang lebih kuat ada di Context Engine mode.',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: 'Alur instalasi resmi',
        paragraphs: [
          'Jalur instalasi resmi yang paling sederhana tetap SKILL.md. Jika pengguna hanya mengingat satu pintu masuk, itulah URL yang perlu diingat.',
        ],
        subsections: [
          {
            title: 'Mulai dari mem9.ai/SKILL.md',
            paragraphs: [
              'Baca https://mem9.ai/SKILL.md dan ikuti instruksi di OpenClaw. Itulah jalur resmi untuk pengalaman hosted.',
            ],
          },
          {
            title: 'Pilihan setup yang umum di OpenClaw',
            bullets: [
              'Create new mem9: membuat API key baru dan ruang memori baru.',
              'Reconnect mem9: memasukkan API key yang sudah ada dan menyambung ke ruang lama.',
              'Agent yang memakai API key yang sama akan berbagi memori yang sama.',
              'API key masih bisa diganti nanti bila pengguna memang ingin pindah ruang.',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'Apa yang Anda dapat setelah setup',
        bullets: [
          'Memori jangka panjang di cloud yang sudah terhubung ke mem9.ai.',
          'MEM9_API_KEY yang harus disimpan dengan aman.',
          'Lingkungan OpenClaw yang bisa menulis memori secara eksplisit.',
          'Pintu masuk Dashboard untuk melihat, merapikan, mengimpor, mengekspor, dan menganalisis memori.',
        ],
        paragraphs: [
          'Setelah itu, alur kerja utama menjadi sederhana: minta Agent mengingat latar belakang penting, bagikan ruang memori yang sama di banyak Agent, lalu buka Your Memory saat perlu memeriksa atau membersihkan.',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Apa itu Your Memory',
        intro: 'Your Memory adalah aplikasi visual utama dalam produk mem9.',
        bullets: [
          'Melihat memori yang sudah ada.',
          'Menganalisis, meninjau, dan membersihkan isi.',
          'Mengelola entri memori.',
          'Mengimpor riwayat lama bila pengguna memintanya secara eksplisit.',
          'Mengekspor memori saat ini.',
        ],
        links: [
          {
            label: 'Buka Your Memory',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: 'Bagaimana mem9 mengubah pengalaman harian',
        paragraphs: [
          'Perubahan paling langsung biasanya adalah Anda tidak perlu lagi menjelaskan ulang latar belakang proyek, preferensi, dan aturan kerja di setiap sesi.',
        ],
        subsections: [
          {
            title: 'Jenis informasi yang cocok untuk diingat jangka panjang',
            bullets: [
              'Preferensi dan gaya kerja.',
              'Latar belakang proyek dan konteks stabil.',
              'Aturan dan kesepakatan yang sering dipakai ulang.',
              'Kesimpulan terverifikasi dan fakta berulang.',
            ],
          },
          {
            title: 'Hal yang sebaiknya tidak langsung diharapkan',
            bullets: [
              'Setiap kalimat chat otomatis menjadi pengetahuan jangka panjang berkualitas tinggi.',
              'Semua riwayat lokal lama otomatis diimpor saat setup.',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: 'Reconnect, pemulihan, dan penyimpanan API key',
        subsections: [
          {
            title: 'Makna reconnect',
            paragraphs: [
              'Reconnect berarti menggunakan MEM9_API_KEY yang sudah ada untuk menyambung kembali ke ruang memori lama. Bukan membuat ruang yang baru.',
            ],
          },
          {
            title: 'Pemulihan di mesin baru',
            bullets: [
              'Pasang ulang plugin mem9.',
              'Tulis kembali MEM9_API_KEY yang sama ke konfigurasi.',
              'Tetap gunakan alamat layanan resmi yang sama kecuali memang pernah diubah.',
              'Restart lalu verifikasi bahwa ruang memori lama sudah kembali terlihat.',
            ],
          },
          {
            title: 'Cara menyimpan API key',
            paragraphs: [
              'Key ini harus diperlakukan sebagai secret sungguhan dan idealnya disimpan di password manager atau vault yang aman. Inilah kunci untuk reconnect di masa depan.',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: 'Apa yang terjadi dan tidak terjadi saat uninstall',
        intro: 'Uninstall memengaruhi konfigurasi lokal, bukan menghapus data cloud dari jarak jauh.',
        subsections: [
          {
            title: 'Yang dilakukan uninstall',
            bullets: [
              'Menghapus konfigurasi plugin mem9 di mesin tersebut.',
              'Mengembalikan konfigurasi memory lokal sebelumnya bila relevan.',
              'Membersihkan sisa instalasi lokal.',
            ],
          },
          {
            title: 'Yang tidak dilakukan uninstall',
            bullets: [
              'Tidak menghapus data cloud mem9 yang jauh.',
              'Tidak mencabut MEM9_API_KEY.',
              'Tidak otomatis mereset chat session saat ini.',
            ],
          },
        ],
        paragraphs: [
          'Jika pengguna ingin menyambung kembali memori yang sama nanti, biasanya cukup memasang ulang mem9 lalu reconnect dengan API key yang sama.',
          'Alur uninstall dirancang hanya dengan satu restart, dan reset session saat ini adalah tindak lanjut terpisah setelah verifikasi uninstall berhasil.',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: 'Fondasi keamanan dan kepercayaan',
        paragraphs: [
          'mem9 memosisikan diri sebagai lapisan memori jangka panjang untuk penggunaan produksi, bukan kotak hitam yang tidak terkontrol. Narasi resminya menekankan batas penanganan data yang jelas dan infrastruktur cloud kelas produksi.',
        ],
        bullets: [
          'Enkripsi saat transmisi.',
          'Enkripsi saat tersimpan.',
          'Kontrol akses.',
          'Auditabilitas.',
          'Batas pemrosesan data yang jelas.',
          'Infrastruktur cloud kelas produksi.',
        ],
        links: [
          {
            label: 'Ikhtisar Keamanan',
            href: '/#security',
          },
          {
            label: 'White Paper Keamanan TiDB Cloud',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: 'Ekspektasi nyata dan batasan produk',
        subsections: [
          {
            title: 'mem9 adalah lapisan memori jangka panjang, bukan mesin pemahaman serba bisa',
            bullets: [
              'Ia kuat dalam menjaga informasi penting untuk jangka panjang.',
              'Ia kuat dalam memanggil kembali memori yang relevan saat dibutuhkan.',
              'Ia mengurangi biaya penjelasan ulang dan setup berulang.',
              'Ia tidak menjamin recall yang sempurna di setiap turn.',
            ],
          },
          {
            title: 'setup bukan proses import otomatis',
            paragraphs: [
              'Tujuan setup pertama adalah menghubungkan mem9, bukan mengunggah semua riwayat lokal lama secara otomatis. Jika pengguna ingin mengimpor memory lokal, itu harus menjadi permintaan yang eksplisit.',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: 'Urutan yang direkomendasikan dan tautan resmi',
        intro: 'Untuk pengguna baru, urutan paling sederhana biasanya seperti ini.',
        bullets: [
          'Buka mem9.ai lalu berikan instruksi onboarding dari SKILL.md ke OpenClaw.',
          'Simpan MEM9_API_KEY segera setelah setup selesai.',
          'Gunakan mem9 beberapa hari agar ada data memori nyata.',
          'Setelah itu buka Your Memory untuk meninjau, merapikan, dan menganalisis memori.',
        ],
        links: [
          {
            label: 'Situs resmi mem9',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'Repositori GitHub mem9',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
  th: {
    meta: {
      title: 'เอกสาร mem9 | คู่มือผู้ใช้อย่างเป็นทางการ',
      description:
        'คู่มืออย่างเป็นทางการของ mem9 สำหรับผู้ใช้ OpenClaw ครอบคลุม setup, reconnect, Your Memory, พฤติกรรมของหน่วยความจำระยะยาว, ความปลอดภัย และการรองรับ Context Engine',
    },
    hero: {
      eyebrow: 'เอกสาร',
      title: 'คู่มือผู้ใช้ mem9 อย่างเป็นทางการ',
      intro:
        'mem9 มอบเลเยอร์หน่วยความจำระยะยาวบนคลาวด์ให้กับ OpenClaw พร้อมแอปแบบภาพสำหรับดู จัดการ และวิเคราะห์หน่วยความจำ หน้านี้เน้นประสบการณ์แบบ hosted บน mem9.ai อย่างเป็นทางการ: ติดตั้งอย่างไร หลัง setup แล้วได้อะไร ควรคาดหวังอะไรในการใช้งานประจำวัน และควรดูแลหน่วยความจำนี้อย่างไรในระยะยาว',
      summaryTitle: 'เอกสารนี้ครอบคลุมอะไรบ้าง',
      summaryBullets: [
        'ทางเข้าทางการที่เร็วที่สุดเริ่มจาก mem9.ai/SKILL.md',
        'mem9 เปลี่ยนอะไรเมื่อเทียบกับไฟล์ memory แบบโลคัล',
        'พฤติกรรมจริงของ setup, reconnect, uninstall และ Dashboard',
        'ตำแหน่งของ Hook mode และการรองรับ Context Engine',
      ],
      tocTitle: 'สารบัญ',
    },
    tocGroups: [
      {
        title: 'เริ่มต้นใช้งาน',
        sectionIDs: ['quick-start', 'what-is-mem9', 'who-this-guide-is-for'],
      },
      {
        title: 'ทำไมต้อง mem9',
        sectionIDs: ['problems-mem9-solves', 'openclaw-native-vs-mem9', 'core-capabilities'],
      },
      {
        title: 'การติดตั้งและการใช้งานประจำวัน',
        sectionIDs: [
          'official-install-flow',
          'what-you-get-after-setup',
          'your-memory-dashboard',
          'daily-usage-expectations',
          'reconnect-and-recovery',
          'uninstall-behavior',
        ],
      },
      {
        title: 'ความปลอดภัย ขอบเขต และช่องทางทางการ',
        sectionIDs: [
          'security-and-trust',
          'product-expectations-and-limits',
          'recommended-path-and-links',
        ],
      },
    ],
    sections: [
      {
        id: 'quick-start',
        label: '01',
        title: 'วิธีเริ่มที่สั้นที่สุด',
        intro: 'ถ้าคุณอยากเริ่มตอนนี้ ให้ทำสิ่งนี้ก่อนเพียงอย่างเดียว',
        paragraphs: [
          'อ่าน https://mem9.ai/SKILL.md แล้วทำตามคำแนะนำเพื่อติดตั้งและตั้งค่า mem9 สำหรับ OpenClaw นี่คือทางเข้าหลักของบริการ hosted อย่างเป็นทางการบน mem9.ai',
          '<a href="https://clawhub.ai/c4pt0r/mem9-ai" target="_blank" rel="noopener noreferrer">ClawHub</a> ยังใช้เป็นแหล่งติดตั้งทางเลือกได้ แต่คู่มือนี้อ้างอิงเส้นทางทางการจากเว็บไซต์ mem9.ai เป็นหลัก',
        ],
        bullets: [
          'ติดตั้ง mem9 ผ่านขั้นตอน onboarding อย่างเป็นทางการ',
          'เก็บ MEM9_API_KEY ที่สร้างขึ้นไว้ในที่ปลอดภัย',
          'ใช้ key เดิมเมื่อ reconnect หรือย้ายเครื่อง',
          'หลัง setup เสร็จ ให้เปิด Your Memory เพื่อดูว่าระบบจำอะไรไว้จริงบ้าง',
        ],
      },
      {
        id: 'what-is-mem9',
        label: '02',
        title: 'mem9 ในประโยคเดียว',
        paragraphs: [
          'mem9 = หน่วยความจำระยะยาวบนคลาวด์สำหรับ OpenClaw + เครื่องมือแบบภาพสำหรับจัดการและวิเคราะห์หน่วยความจำ',
          'มันเปลี่ยน memory แบบโลคัลที่เปราะบาง กระจัดกระจาย และจัดการยาก ให้กลายเป็นเลเยอร์ผลิตภัณฑ์แบบ hosted ที่ใช้งานต่อเนื่องได้',
        ],
      },
      {
        id: 'who-this-guide-is-for',
        label: '03',
        title: 'คู่มือนี้เหมาะกับใคร',
        intro: 'คู่มือนี้เหมาะสำหรับผู้ใช้ที่ต้องการใช้บริการ hosted อย่างเป็นทางการของ mem9.ai โดยตรง',
        bullets: [
          'mem9 คืออะไร และทำไมจึงเหมาะกับการใช้งานระยะยาว',
          'ทำไม mem9 มักเหมาะกว่าไฟล์ memory แบบโลคัลสำหรับใช้เป็นเลเยอร์หน่วยความจำระยะยาว',
          'จะเริ่มจาก SKILL.md อย่างไร และหลัง setup แล้วจะได้อะไร',
          'Your Memory ใช้ทำอะไร และ reconnect หรือ uninstall จะทำงานอย่างไร',
        ],
        subsections: [
          {
            title: 'สิ่งที่คู่มือนี้ไม่ได้ครอบคลุม',
            bullets: [
              'การ self-host Go backend',
              'การ deploy บริการ API ของ mem9 เอง',
              'การดูแลฐานข้อมูลและโครงสร้างพื้นฐานปฏิบัติการด้วยตนเอง',
            ],
          },
        ],
      },
      {
        id: 'problems-mem9-solves',
        label: '04',
        title: 'ปัญหาที่ mem9 แก้ได้',
        paragraphs: [
          'ระบบ memory แบบโลคัลมักผูกอยู่กับเครื่องเดียว สูญหายง่ายหลัง reset หรือ migration แชร์ข้าม Agent ได้ยาก และจัดระเบียบได้ยากเมื่อใช้ไปนาน ๆ',
          'mem9 ทำให้ข้อมูลสำคัญอยู่ข้าม session ทำให้หน่วยความจำติดตาม Agent แทนที่จะติดกับไฟล์โลคัล และมี Dashboard ให้ผู้ใช้ดู จัดการ นำเข้า ส่งออก และวิเคราะห์หน่วยความจำได้',
          'ที่สำคัญ เป้าหมายของ mem9 ไม่ใช่การยัดแชตเก่าทั้งหมดกลับเข้า LLM แต่เป็นการทำหน้าที่เหมือน memory infrastructure แบบ facts / insights ที่ดึงคืนเฉพาะส่วนที่เกี่ยวข้องที่สุดกับงานปัจจุบัน',
        ],
        bullets: [
          'อธิบายพื้นหลังโปรเจกต์และความชอบซ้ำน้อยลง',
          'สูญเสียบริบทน้อยลงหลัง restart, reset หรือเปลี่ยนเครื่อง',
          'เกิดการกระจัดกระจายของความจำระหว่าง Agent น้อยลง',
          'มองเห็นและควบคุมสิ่งที่ระบบจำได้มากขึ้น',
        ],
      },
      {
        id: 'openclaw-native-vs-mem9',
        label: '05',
        title: 'ความต่างระหว่าง OpenClaw native memory และ mem9',
        intro: 'ความต่างที่ชัดที่สุดไม่ใช่ว่าอันไหน “ดีกว่า” แต่อยู่ที่ว่ามันแก้ปัญหาความจำคนละแบบกัน',
        paragraphs: [
          'OpenClaw native memory ไม่ได้ “ใช้ไม่ได้” แต่มันเน้นช่วยให้ Agent เขียนข้อมูลสำคัญลงในไฟล์ Markdown แบบโลคัล แล้วสร้างดัชนีค้นคืนบนไฟล์เหล่านั้น',
          'mem9 แก้ปัญหาอีกคลาสหนึ่ง โดยยกระดับความจำจาก “ไฟล์โน้ตโลคัล + การค้นแบบ chunk” ไปเป็นโครงสร้างพื้นฐานด้านความจำที่ใช้ข้าม session, Agent, อุปกรณ์ และการปฏิบัติการได้จริง',
        ],
        subsections: [
          {
            title: 'ถ้าความต้องการของคุณเป็นแบบนี้',
            bullets: [
              'มี OpenClaw agent ตัวเดียว',
              'ใช้เพียงเครื่องเดียว',
              'อาศัย `MEMORY.md` และ notes รายวันเป็นหลัก',
              'ยอมรับได้ถ้า recall คืนเป็น snippet / chunk แบบต้นฉบับ',
            ],
            paragraphs: [
              'โดยทั่วไป OpenClaw native memory ก็มักเพียงพอแล้ว',
            ],
          },
          {
            title: 'แต่ถ้าความต้องการของคุณขยับมาเป็นแบบนี้',
            bullets: [
              'ความจำต้องคงอยู่ข้าม session, reset และการเปลี่ยนเครื่องอย่างเสถียร',
              'ไม่อยากให้คุณภาพของ memory ขึ้นกับว่า Agent เขียน Markdown ถูกต้องหรือไม่',
              'อยากให้บทสนทนายาว ๆ ถูกสกัดเป็น facts / insights ที่เสถียรกว่า',
              'ต้องการให้หลาย Agent แชร์ memory pool เดียวกัน',
              'ต้องการแยกเลเยอร์อย่าง insight, pinned และ session',
              'ต้องการ API, dashboard, การวิเคราะห์ และการกำกับดูแล memory',
            ],
            paragraphs: [
              'เมื่อนั้น OpenClaw native memory จะเริ่มชนข้อจำกัดเชิงโครงสร้างอย่างรวดเร็ว และ mem9 จะเป็นรูปแบบผลิตภัณฑ์ที่เหมาะกว่า',
            ],
          },
        ],
        bullets: [
          'OpenClaw native memory ใกล้เคียงกับสมุดบันทึกความรู้แบบโลคัลมากกว่า',
          'mem9 ใกล้เคียงกับ agent memory system ภายนอกมากกว่า',
        ],
      },
      {
        id: 'core-capabilities',
        label: '06',
        title: 'ความสามารถหลัก',
        intro: 'สิ่งต่อไปนี้คือความเปลี่ยนแปลงที่ผู้ใช้จะสัมผัสได้โดยตรงมากที่สุด',
        subsections: [
          {
            title: 'หน่วยความจำระยะยาวบนคลาวด์',
            paragraphs: [
              'ข้อมูลระยะยาวที่มีคุณค่าไม่ได้อยู่แค่ในบทสนทนาปัจจุบัน แต่ถูกเก็บไว้ในคลาวด์ ดังนั้น reset, restart และการเปลี่ยนอุปกรณ์จึงไม่ทำให้ต้องเริ่มจากศูนย์',
            ],
          },
          {
            title: 'พื้นที่ร่วมกัน',
            paragraphs: [
              'หลาย Agent สามารถเชื่อมต่อกับพื้นที่ mem9 เดียวกันและใช้ความรู้ระยะยาวชุดเดียวกันได้ เหมาะกับการใช้งานหลายอุปกรณ์ งานอัตโนมัติที่ทำซ้ำ และบริบทโปรเจกต์ที่ใช้ร่วมกัน',
            ],
          },
          {
            title: 'Hybrid recall',
            paragraphs: [
              'mem9 ผสานการค้นหาด้วยคีย์เวิร์ดและความหมาย เพื่อดึงหน่วยความจำที่เกี่ยวข้องกับงานปัจจุบันมากขึ้น',
            ],
            bullets: [
              'context ที่ส่งเข้า LLM มีขนาดเล็กลง',
              'บริบทที่ไม่เกี่ยวข้องลดลง',
              'ใช้ token และค่าใช้จ่ายน้อยลง',
              'ลดแรงกดดันจาก context compaction ใน session ยาว ๆ',
            ],
          },
          {
            title: 'Your Memory Dashboard',
            paragraphs: [
              'Your Memory คือแอปแบบภาพหลักของ mem9 ใช้ดู จัดการ วิเคราะห์ นำเข้า และส่งออกหน่วยความจำได้จากจุดเดียว',
            ],
          },
          {
            title: 'การสั่ง “จำสิ่งนี้ไว้” อย่างชัดเจน',
            paragraphs: [
              'เมื่อ mem9 ถูกตั้งค่าแล้ว คำขออย่าง “จำสิ่งนี้ไว้” หรือ “บันทึกสิ่งนี้ลง mem9” ควรถูกตีความเป็น durable write จริง ไม่ใช่บทสนทนาธรรมดา',
            ],
          },
          {
            title: 'Hook mode และการรองรับ Context Engine',
            paragraphs: [
              'mem9 รองรับทั้ง Hook mode และ Context Engine mode โดย Hook mode มีความเข้ากันได้ดีที่สุด ส่วนเส้นทางที่ทรงพลังกว่าคือ Context Engine mode',
            ],
          },
        ],
      },
      {
        id: 'official-install-flow',
        label: '07',
        title: 'เส้นทางติดตั้งอย่างเป็นทางการ',
        paragraphs: [
          'เส้นทางติดตั้งอย่างเป็นทางการที่ง่ายที่สุดยังคงเป็น SKILL.md หากผู้ใช้จำได้เพียงหนึ่งทางเข้า ก็ควรจำ URL นี้',
        ],
        subsections: [
          {
            title: 'เริ่มจาก mem9.ai/SKILL.md',
            paragraphs: [
              'อ่าน https://mem9.ai/SKILL.md แล้วทำตามคำแนะนำใน OpenClaw นี่คือ workflow มาตรฐานของประสบการณ์ hosted',
            ],
          },
          {
            title: 'ตัวเลือก setup ทั่วไปใน OpenClaw',
            bullets: [
              'Create new mem9: สร้าง API key ใหม่และสร้างพื้นที่หน่วยความจำใหม่',
              'Reconnect mem9: ใส่ API key เดิมแล้วเชื่อมต่อกลับไปยังพื้นที่เดิม',
              'Agent ที่ใช้ API key เดียวกันจะใช้พื้นที่หน่วยความจำเดียวกันร่วมกัน',
              'ถ้าต้องการย้ายไปอีกพื้นที่ก็สามารถเปลี่ยน API key ภายหลังได้',
            ],
          },
        ],
      },
      {
        id: 'what-you-get-after-setup',
        label: '08',
        title: 'คุณจะได้อะไรหลัง setup',
        bullets: [
          'หน่วยความจำระยะยาวบนคลาวด์ที่เชื่อมต่อกับ mem9.ai แล้ว',
          'MEM9_API_KEY ที่ต้องเก็บรักษาให้ดี',
          'สภาพแวดล้อม OpenClaw ที่สามารถเขียนหน่วยความจำแบบ explicit ได้',
          'ทางเข้า Dashboard สำหรับดู จัดระเบียบ นำเข้า ส่งออก และวิเคราะห์หน่วยความจำ',
        ],
        paragraphs: [
          'หลังจากนั้นการใช้งานหลักจะเรียบง่ายมาก: ให้ Agent จำพื้นหลังสำคัญ แชร์หน่วยความจำเดียวกันให้หลาย Agent และเปิด Your Memory เมื่อต้องการตรวจสอบหรือทำความสะอาด',
        ],
      },
      {
        id: 'your-memory-dashboard',
        label: '09',
        title: 'Your Memory คืออะไร',
        intro: 'Your Memory คือแอปแบบภาพหลักของ mem9',
        bullets: [
          'ดูหน่วยความจำที่มีอยู่',
          'วิเคราะห์ ตรวจทาน และจัดการเนื้อหา',
          'บริหารรายการหน่วยความจำ',
          'นำเข้าประวัติเก่าเมื่อผู้ใช้ร้องขออย่างชัดเจน',
          'ส่งออกหน่วยความจำปัจจุบัน',
        ],
        links: [
          {
            label: 'เปิด Your Memory',
            href: '/your-memory/',
          },
        ],
      },
      {
        id: 'daily-usage-expectations',
        label: '10',
        title: 'mem9 เปลี่ยนประสบการณ์การใช้งานประจำวันอย่างไร',
        paragraphs: [
          'ความเปลี่ยนแปลงที่ชัดที่สุดคือคุณไม่ต้องอธิบายพื้นหลังโปรเจกต์ ความชอบ และกติกาการทำงานซ้ำในทุก session',
        ],
        subsections: [
          {
            title: 'ข้อมูลที่เหมาะกับการจำระยะยาว',
            bullets: [
              'ความชอบและสไตล์การทำงาน',
              'พื้นหลังโปรเจกต์และบริบทที่เสถียร',
              'กฎและข้อตกลงที่ใช้ซ้ำบ่อย',
              'ข้อสรุปที่ยืนยันแล้วและข้อเท็จจริงที่ใช้ซ้ำ',
            ],
          },
          {
            title: 'สิ่งที่ไม่ควรคาดหวังตั้งแต่ต้น',
            bullets: [
              'ทุกบรรทัดของแชตจะกลายเป็นความรู้ระยะยาวคุณภาพสูงโดยอัตโนมัติ',
              'ประวัติแบบโลคัลเก่าทั้งหมดจะถูกนำเข้าอัตโนมัติระหว่าง setup',
            ],
          },
        ],
      },
      {
        id: 'reconnect-and-recovery',
        label: '11',
        title: 'Reconnect การกู้คืน และการเก็บ API key',
        subsections: [
          {
            title: 'ความหมายของ reconnect',
            paragraphs: [
              'Reconnect คือการใช้ MEM9_API_KEY เดิมเพื่อเชื่อมต่อกลับไปยังพื้นที่หน่วยความจำเดิม ไม่ใช่การสร้างพื้นที่ใหม่',
            ],
          },
          {
            title: 'กู้คืนบนเครื่องใหม่',
            bullets: [
              'ติดตั้งปลั๊กอิน mem9 ใหม่',
              'ใส่ MEM9_API_KEY เดิมกลับเข้าไปในคอนฟิก',
              'ใช้ที่อยู่บริการทางการเดิมต่อไป เว้นแต่คุณจะเปลี่ยนมันอย่างตั้งใจ',
              'รีสตาร์ตแล้วตรวจสอบว่าพื้นที่หน่วยความจำเดิมกลับมาแล้ว',
            ],
          },
          {
            title: 'วิธีเก็บ API key',
            paragraphs: [
              'key นี้ควรถูกปฏิบัติเป็นความลับจริง และควรเก็บไว้ใน password manager หรือ vault ที่ปลอดภัย เพราะเป็นกุญแจสำคัญสำหรับ reconnect ในอนาคต',
            ],
          },
        ],
      },
      {
        id: 'uninstall-behavior',
        label: '12',
        title: 'สิ่งที่จะเกิดขึ้นและไม่เกิดขึ้นเมื่อ uninstall',
        intro: 'การ uninstall มีผลกับการตั้งค่าในเครื่อง แต่ไม่ได้ลบข้อมูลคลาวด์จากระยะไกลโดยตรง',
        subsections: [
          {
            title: 'สิ่งที่ uninstall จะทำ',
            bullets: [
              'ลบการตั้งค่าปลั๊กอิน mem9 ออกจากเครื่องนี้',
              'คืนค่าการตั้งค่า memory แบบโลคัลเดิมเมื่อเกี่ยวข้อง',
              'ล้างเศษไฟล์การติดตั้งในเครื่อง',
            ],
          },
          {
            title: 'สิ่งที่ uninstall จะไม่ทำ',
            bullets: [
              'ไม่ลบข้อมูล mem9 บนคลาวด์จากระยะไกล',
              'ไม่เพิกถอน MEM9_API_KEY',
              'ไม่รีเซ็ต chat session ปัจจุบันโดยอัตโนมัติ',
            ],
          },
        ],
        paragraphs: [
          'ถ้าต้องการเชื่อมต่อความจำชุดเดิมกลับมาในภายหลัง ปกติเพียงติดตั้ง mem9 ใหม่แล้ว reconnect ด้วย API key เดิมก็เพียงพอ',
          'โฟลว์ uninstall ถูกออกแบบให้มีการรีสตาร์ตเพียงครั้งเดียว และการรีเซ็ต session ปัจจุบันเป็นงานติดตามแยกต่างหากหลังยืนยันการ uninstall สำเร็จ',
        ],
      },
      {
        id: 'security-and-trust',
        label: '13',
        title: 'พื้นฐานด้านความปลอดภัยและความน่าเชื่อถือ',
        paragraphs: [
          'mem9 วางตำแหน่งตัวเองเป็นเลเยอร์หน่วยความจำระยะยาวสำหรับงาน production ไม่ใช่กล่องดำที่ควบคุมไม่ได้ เรื่องราวทางการจึงเน้นขอบเขตการจัดการข้อมูลที่ชัดเจนและโครงสร้างพื้นฐานคลาวด์ระดับ production',
        ],
        bullets: [
          'การเข้ารหัสระหว่างส่งข้อมูล',
          'การเข้ารหัสเมื่อจัดเก็บ',
          'การควบคุมการเข้าถึง',
          'การตรวจสอบย้อนหลังได้',
          'ขอบเขตการประมวลผลข้อมูลที่ชัดเจน',
          'โครงสร้างพื้นฐานคลาวด์ระดับ production',
        ],
        links: [
          {
            label: 'ภาพรวมความปลอดภัย',
            href: '/#security',
          },
          {
            label: 'เอกสารความปลอดภัยของ TiDB Cloud',
            href: 'https://www.pingcap.com/trust-hub/security/tidb-cloud-security-white-paper/',
            external: true,
          },
        ],
      },
      {
        id: 'product-expectations-and-limits',
        label: '14',
        title: 'ความคาดหวังจริงและขอบเขตของผลิตภัณฑ์',
        subsections: [
          {
            title: 'mem9 เป็นเลเยอร์หน่วยความจำระยะยาว ไม่ใช่เครื่องทำความเข้าใจอเนกประสงค์',
            bullets: [
              'มันเก่งในการเก็บข้อมูลสำคัญไว้ระยะยาว',
              'มันเก่งในการเรียกคืนหน่วยความจำที่เกี่ยวข้องเมื่อจำเป็น',
              'มันช่วยลดต้นทุนจากการอธิบายซ้ำและ setup ซ้ำ',
              'มันไม่ได้รับประกัน recall ที่สมบูรณ์แบบในทุก turn',
            ],
          },
          {
            title: 'setup ไม่ใช่การ import อัตโนมัติ',
            paragraphs: [
              'เป้าหมายของ setup ครั้งแรกคือการเชื่อมต่อ mem9 ไม่ใช่การอัปโหลดประวัติแบบโลคัลเก่าทั้งหมดโดยอัตโนมัติ หากผู้ใช้ต้องการนำเข้า memory แบบโลคัล ควรเป็นคำขอที่ระบุชัดเจน',
            ],
          },
        ],
      },
      {
        id: 'recommended-path-and-links',
        label: '15',
        title: 'ลำดับที่แนะนำและลิงก์ทางการ',
        intro: 'สำหรับผู้ใช้ใหม่ ลำดับที่เรียบง่ายที่สุดมักเป็นดังนี้',
        bullets: [
          'เปิด mem9.ai แล้วส่งคำสั่ง onboarding จาก SKILL.md ให้ OpenClaw',
          'บันทึก MEM9_API_KEY ทันทีหลัง setup เสร็จ',
          'ใช้งาน mem9 สักสองสามวันเพื่อให้เกิดข้อมูลจริง',
          'จากนั้นเปิด Your Memory เพื่อตรวจสอบ จัดระเบียบ และวิเคราะห์หน่วยความจำ',
        ],
        links: [
          {
            label: 'เว็บไซต์ทางการของ mem9',
            href: 'https://mem9.ai/',
            external: true,
          },
          {
            label: 'Your Memory',
            href: '/your-memory/',
          },
          {
            label: 'รีโพซิทอรี GitHub ของ mem9',
            href: 'https://github.com/mem9-ai/mem9',
            external: true,
          },
          {
            label: 'SKILL.md',
            href: 'https://mem9.ai/SKILL.md',
            external: true,
          },
        ],
      },
    ],
  },
};

export function resolveDocsLocale(locale: SiteLocale): DocsLocale {
  switch (locale) {
    case 'zh':
    case 'zh-Hant':
      return 'zh';
    case 'ja':
      return 'ja';
    case 'ko':
      return 'ko';
    case 'id':
      return 'id';
    case 'th':
      return 'th';
    case 'en':
    default:
      return 'en';
  }
}
