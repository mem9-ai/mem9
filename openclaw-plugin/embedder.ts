import OpenAI from "openai";
import type { EmbedConfig } from "./types.js";

export interface Embedder {
  embed(text: string): Promise<number[]>;
  dims: number;
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMS = 1536;

export function createEmbedder(cfg: EmbedConfig | undefined): Embedder | null {
  if (!cfg) return null;

  const hasApiKey =
    typeof cfg.apiKey === "string" && cfg.apiKey.trim().length > 0;
  const hasBaseUrl =
    typeof cfg.baseUrl === "string" && cfg.baseUrl.trim().length > 0;
  if (!hasApiKey && !hasBaseUrl) return null;

  const model = cfg.model ?? DEFAULT_MODEL;
  const dims = cfg.dims ?? DEFAULT_DIMS;

  const client = new OpenAI({
    apiKey: cfg.apiKey ?? "local",
    baseURL: cfg.baseUrl,
  });

  return {
    dims,
    async embed(text: string): Promise<number[]> {
      const res = await client.embeddings.create({
        model,
        input: text,
        encoding_format: "float", // Required for Ollama/LM Studio; safe for OpenAI too.
      });
      return res.data[0].embedding;
    },
  };
}

export function vecToString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
