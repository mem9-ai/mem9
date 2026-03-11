import type { SiteLocale } from "./site";

export interface DiscoverabilityItem {
  title: string;
  description: string;
}

export interface DiscoverabilityFaqItem {
  question: string;
  answer: string;
}

export interface DiscoverabilityPositioningCopy {
  kicker: string;
  title: string;
  description: string;
  factsTitle: string;
  facts: string[];
  queriesTitle: string;
  queries: string[];
}

export interface DiscoverabilityUseCasesCopy {
  kicker: string;
  title: string;
  description: string;
  items: DiscoverabilityItem[];
}

export interface DiscoverabilityFaqCopy {
  kicker: string;
  title: string;
  description: string;
  items: DiscoverabilityFaqItem[];
}

export interface DiscoverabilityDictionary {
  positioning: DiscoverabilityPositioningCopy;
  useCases: DiscoverabilityUseCasesCopy;
  faq: DiscoverabilityFaqCopy;
}

export const seoKeywords: string[] = [
  "AI agent memory",
  "agent memory infrastructure",
  "persistent memory for AI agents",
  "long-term memory for coding agents",
  "Claude Code memory",
  "OpenClaw memory",
  "OpenCode memory",
  "context engineering",
  "hybrid search for agents",
  "multi-agent memory",
  "MCP memory backend",
];

const englishCopy: DiscoverabilityDictionary = {
  positioning: {
    kicker: "Positioning",
    title: "AI agent memory, not another generic database",
    description:
      "mem9 is persistent memory infrastructure for coding agents and AI assistants. It gives Claude Code, OpenClaw, OpenCode, and custom runtimes long-term memory with hybrid retrieval, shared spaces, and durable cloud-backed recall so teams can do context engineering without stitching together local files, a vector database, and sync scripts.",
    factsTitle: "What mem9 actually does",
    facts: [
      "Stores long-term memory for coding agents in durable cloud-backed storage.",
      "Combines keyword search and vector search behind one memory API.",
      "Works with OpenClaw, Claude Code, OpenCode, and custom agent tools.",
      "Supports single-agent recall and shared multi-agent memory.",
      "Can run as open source infrastructure instead of a black-box hosted silo.",
    ],
    queriesTitle: "Often searched as",
    queries: [
      "AI agent memory",
      "Claude Code memory",
      "OpenClaw memory",
      "OpenCode memory",
      "persistent memory for agents",
      "long-term memory for coding agents",
      "context engineering",
      "MCP memory backend",
    ],
  },
  useCases: {
    kicker: "Use Cases",
    title: "One memory layer for the workflows teams already search for",
    description:
      "Whether you call it AI agent memory, long-term memory, or context engineering, the job is the same: keep the right context durable, searchable, and reusable across tools.",
    items: [
      {
        title: "Claude Code memory",
        description:
          "Give Claude Code persistent memory across sessions so it can recall project decisions, coding conventions, and previous fixes instead of starting cold.",
      },
      {
        title: "OpenClaw memory",
        description:
          "Back OpenClaw with cloud-persistent recall, hybrid search, and shared memory so the agent stays consistent over time.",
      },
      {
        title: "OpenCode memory",
        description:
          "Keep OpenCode context durable across restarts and devices without building a custom memory stack around it.",
      },
      {
        title: "Shared memory for multi-agent teams",
        description:
          "Let multiple coding agents read and write to the same memory layer when a team needs shared context instead of isolated local notes.",
      },
      {
        title: "Memory backend for MCP servers and custom tools",
        description:
          "If your MCP server or custom agent runtime can call HTTP, mem9 can sit behind it as the durable memory backend.",
      },
      {
        title: "Context engineering with retrieval",
        description:
          "Keep durable memory outside the prompt, then pull in the right facts with hybrid search when a task actually needs them.",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "Questions people ask before choosing an agent memory layer",
    description:
      "These are the practical questions that come up when teams compare mem9 with local files, a vector database, or a custom retrieval stack.",
    items: [
      {
        question: "What is AI agent memory?",
        answer:
          "AI agent memory is the storage and retrieval layer that lets an agent keep useful context across sessions instead of forgetting everything when the process restarts. mem9 focuses on durable, searchable memory for coding agents and assistants.",
      },
      {
        question: "How do I add persistent memory to Claude Code?",
        answer:
          "mem9 provides a Claude Code integration so Claude Code can write memories, retrieve them later, and reuse project context across sessions without relying on fragile local files.",
      },
      {
        question: "Can mem9 be the memory layer for OpenClaw or OpenCode?",
        answer:
          "Yes. mem9 is built to give OpenClaw, OpenCode, and similar agent tools a shared persistent memory layer with hybrid search and cloud-backed recall.",
      },
      {
        question: "Can I use mem9 behind an MCP server or a custom agent runtime?",
        answer:
          "Yes. mem9 is API-first. If your MCP server or custom tool can read and write over HTTP, it can use mem9 as the persistent memory backend.",
      },
      {
        question: "How is mem9 different from a vector database?",
        answer:
          "A vector database stores embeddings. mem9 adds the agent-facing memory workflow around storage: persistent CRUD, keyword plus vector retrieval, cross-session recall, and a clean integration path for coding agents.",
      },
    ],
  },
};

const simplifiedChineseCopy: DiscoverabilityDictionary = {
  positioning: {
    kicker: "定位",
    title: "它是 AI agent memory，不是又一个通用数据库",
    description:
      "mem9 是面向 coding agents 和 AI assistants 的持久记忆基础设施。它为 Claude Code、OpenClaw、OpenCode 和自定义运行时提供 long-term memory、hybrid retrieval、shared spaces 和耐久的云端召回，让团队做 context engineering 时不必自己拼本地文件、向量库和同步脚本。",
    factsTitle: "mem9 实际解决什么",
    facts: [
      "把 coding agent 的 long-term memory 存进耐久的云端存储。",
      "在同一个 memory API 后面组合 keyword search 和 vector search。",
      "可接 OpenClaw、Claude Code、OpenCode 和自定义 agent 工具。",
      "既支持单 Agent 召回，也支持多 Agent 共享记忆。",
      "可作为开源基础设施运行，而不是黑盒托管孤岛。",
    ],
    queriesTitle: "常见搜索词",
    queries: [
      "AI agent memory",
      "Claude Code memory",
      "OpenClaw memory",
      "OpenCode memory",
      "persistent memory for agents",
      "long-term memory for coding agents",
      "context engineering",
      "MCP memory backend",
    ],
  },
  useCases: {
    kicker: "场景",
    title: "一层记忆，承接团队本来就在搜的那些需求",
    description:
      "不管你叫它 AI agent memory、long-term memory，还是 context engineering，本质任务都一样：把正确上下文长期保存、可搜索，并能在不同工具间复用。",
    items: [
      {
        title: "Claude Code memory",
        description:
          "让 Claude Code 跨会话保留项目决策、编码约定和历史修复，而不是每次都从零开始。",
      },
      {
        title: "OpenClaw memory",
        description:
          "为 OpenClaw 提供云端持久召回、混合搜索和共享记忆，让 Agent 在更长时间尺度上保持一致。",
      },
      {
        title: "OpenCode memory",
        description:
          "让 OpenCode 的上下文跨重启、跨设备持续存在，而不是额外搭一套自定义 memory stack。",
      },
      {
        title: "多 Agent 共享记忆",
        description:
          "当团队需要共享上下文时，让多个 coding agents 读写同一层记忆，而不是各自维护割裂的本地笔记。",
      },
      {
        title: "MCP server 与自定义工具的 memory backend",
        description:
          "如果你的 MCP server 或自定义 agent runtime 能调用 HTTP，mem9 就可以在后面充当持久记忆后端。",
      },
      {
        title: "带检索的 context engineering",
        description:
          "把长期记忆放在 prompt 之外，在任务真正需要时再通过 hybrid search 拉回正确事实。",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "团队选择 agent memory layer 前最常问的问题",
    description:
      "这些问题通常出现在团队拿 mem9 去和本地文件、向量数据库或自建 retrieval stack 做比较时。",
    items: [
      {
        question: "什么是 AI agent memory？",
        answer:
          "AI agent memory 是让 Agent 能跨会话保留和取回上下文的存储与检索层，而不是进程一重启就全部遗忘。mem9 专注于 coding agents 和 assistants 的耐久、可搜索记忆。",
      },
      {
        question: "怎么给 Claude Code 加 persistent memory？",
        answer:
          "mem9 提供 Claude Code 集成，让 Claude Code 能写入记忆、后续检索并复用项目上下文，不再依赖脆弱的本地文件。",
      },
      {
        question: "mem9 能作为 OpenClaw 或 OpenCode 的 memory layer 吗？",
        answer:
          "可以。mem9 就是为 OpenClaw、OpenCode 以及类似 Agent 工具提供共享持久记忆、混合搜索和云端召回而设计的。",
      },
      {
        question: "能不能把 mem9 放在 MCP server 或自定义 agent runtime 后面？",
        answer:
          "可以。mem9 是 API-first 的，只要你的 MCP server 或自定义工具能通过 HTTP 读写，就能把 mem9 当作持久记忆后端。",
      },
      {
        question: "mem9 和向量数据库有什么区别？",
        answer:
          "向量数据库负责存 embeddings。mem9 在存储之上补齐了面向 Agent 的记忆工作流：持久 CRUD、关键词加向量检索、跨会话召回，以及更直接的 coding agent 集成路径。",
      },
    ],
  },
};

const traditionalChineseCopy: DiscoverabilityDictionary = {
  positioning: {
    kicker: "定位",
    title: "它是 AI agent memory，不是另一個通用資料庫",
    description:
      "mem9 是面向 coding agents 與 AI assistants 的持久記憶基礎設施。它為 Claude Code、OpenClaw、OpenCode 與自訂執行環境提供 long-term memory、hybrid retrieval、shared spaces 與耐久的雲端召回，讓團隊做 context engineering 時不必自己拼接本地檔案、向量資料庫與同步腳本。",
    factsTitle: "mem9 實際解決什麼",
    facts: [
      "把 coding agent 的 long-term memory 存進耐久的雲端儲存。",
      "在同一個 memory API 後面結合 keyword search 與 vector search。",
      "可接 OpenClaw、Claude Code、OpenCode 與自訂 agent 工具。",
      "既支援單 Agent 召回，也支援多 Agent 共用記憶。",
      "可作為開源基礎設施運行，而不是黑盒託管孤島。",
    ],
    queriesTitle: "常見搜尋詞",
    queries: [
      "AI agent memory",
      "Claude Code memory",
      "OpenClaw memory",
      "OpenCode memory",
      "persistent memory for agents",
      "long-term memory for coding agents",
      "context engineering",
      "MCP memory backend",
    ],
  },
  useCases: {
    kicker: "場景",
    title: "一層記憶，承接團隊本來就在搜尋的那些需求",
    description:
      "不管你叫它 AI agent memory、long-term memory，還是 context engineering，本質任務都一樣：把正確上下文長期保存、可搜尋，並能在不同工具間重複利用。",
    items: [
      {
        title: "Claude Code memory",
        description:
          "讓 Claude Code 跨會話保留專案決策、編碼慣例與歷史修復，而不是每次都從零開始。",
      },
      {
        title: "OpenClaw memory",
        description:
          "為 OpenClaw 提供雲端持久召回、混合搜尋與共用記憶，讓 Agent 在更長時間尺度上保持一致。",
      },
      {
        title: "OpenCode memory",
        description:
          "讓 OpenCode 的上下文跨重啟、跨裝置持續存在，而不是額外搭一套自訂 memory stack。",
      },
      {
        title: "多 Agent 共用記憶",
        description:
          "當團隊需要共用上下文時，讓多個 coding agents 讀寫同一層記憶，而不是各自維護割裂的本地筆記。",
      },
      {
        title: "MCP server 與自訂工具的 memory backend",
        description:
          "如果你的 MCP server 或自訂 agent runtime 能呼叫 HTTP，mem9 就可以在後面充當持久記憶後端。",
      },
      {
        title: "帶檢索的 context engineering",
        description:
          "把長期記憶放在 prompt 之外，在任務真正需要時再透過 hybrid search 拉回正確事實。",
      },
    ],
  },
  faq: {
    kicker: "FAQ",
    title: "團隊選擇 agent memory layer 前最常問的問題",
    description:
      "這些問題通常出現在團隊拿 mem9 去和本地檔案、向量資料庫或自建 retrieval stack 比較時。",
    items: [
      {
        question: "什麼是 AI agent memory？",
        answer:
          "AI agent memory 是讓 Agent 能跨會話保留與取回上下文的儲存與檢索層，而不是程序一重啟就全部遺忘。mem9 專注於 coding agents 與 assistants 的耐久、可搜尋記憶。",
      },
      {
        question: "怎麼給 Claude Code 加上 persistent memory？",
        answer:
          "mem9 提供 Claude Code 整合，讓 Claude Code 能寫入記憶、後續檢索並重用專案上下文，不再依賴脆弱的本地檔案。",
      },
      {
        question: "mem9 能作為 OpenClaw 或 OpenCode 的 memory layer 嗎？",
        answer:
          "可以。mem9 就是為 OpenClaw、OpenCode 與類似 Agent 工具提供共用持久記憶、混合搜尋與雲端召回而設計的。",
      },
      {
        question: "能不能把 mem9 放在 MCP server 或自訂 agent runtime 後面？",
        answer:
          "可以。mem9 是 API-first 的，只要你的 MCP server 或自訂工具能透過 HTTP 讀寫，就能把 mem9 當作持久記憶後端。",
      },
      {
        question: "mem9 和向量資料庫有什麼差別？",
        answer:
          "向量資料庫負責存 embeddings。mem9 在儲存之上補齊了面向 Agent 的記憶工作流：持久 CRUD、關鍵詞加向量檢索、跨會話召回，以及更直接的 coding agent 整合路徑。",
      },
    ],
  },
};

export const discoverabilityCopy: Record<SiteLocale, DiscoverabilityDictionary> = {
  en: englishCopy,
  zh: simplifiedChineseCopy,
  "zh-Hant": traditionalChineseCopy,
  ja: englishCopy,
  ko: englishCopy,
  id: englishCopy,
  th: englishCopy,
};
