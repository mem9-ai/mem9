export interface BenchmarkOutput {
  meta: {
    base_url: string
    data_file: string
    model: string
    tenant_id: string
    timestamp: string
  }
  results: QAResult[]
  stats: BenchmarkStats
}

export interface BenchmarkStats {
  by_category: Record<QACategory, number>
  by_category_count: Record<QACategory, number>
  by_category_llm: Record<QACategory, number>
  overall: number
  overall_llm: number
  total: number
}

export interface DialogTurn {
  blip_caption?: string
  compressed_text?: string
  dia_id: string
  img_file?: string
  search_query?: string
  speaker: string
  text: string
}

export interface LoCoMoSample {
  conversation: Record<string, DialogTurn[] | string>
  qa: QAPair[]
  sample_id: string
}

export type QACategory = 1 | 2 | 3 | 4 | 5

export interface QAPair {
  adversarial_answer: null | string
  answer: number | string
  category: QACategory
  evidence: string[]
  question: string
}

export interface QAResult {
  category: QACategory
  context_retrieved: string
  evidence: string[]
  gold_answer: string
  llm_judge_score: number
  prediction: string
  question: string
  sample_id: string
  score: number
}

export interface MnemoMemory {
  id: string
  content: string
  score?: number
  session_id?: string
  agent_id?: string
  metadata?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}
