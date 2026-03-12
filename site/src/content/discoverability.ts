import type { SiteLocale } from "./site";

export interface DiscoverabilityFaqItem {
  question: string;
  answer: string;
}

export interface DiscoverabilityFaqCopy {
  kicker: string;
  title: string;
  description: string;
  items: DiscoverabilityFaqItem[];
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

const englishFaq: DiscoverabilityFaqCopy = {
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
};

const simplifiedChineseFaq: DiscoverabilityFaqCopy = {
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
};

const traditionalChineseFaq: DiscoverabilityFaqCopy = {
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
};

export const faqCopy: Record<SiteLocale, DiscoverabilityFaqCopy> = {
  en: englishFaq,
  zh: simplifiedChineseFaq,
  "zh-Hant": traditionalChineseFaq,
  ja: englishFaq,
  ko: englishFaq,
  id: englishFaq,
  th: englishFaq,
};
