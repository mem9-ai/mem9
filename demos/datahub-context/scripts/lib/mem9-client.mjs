const JSON_HEADERS = { "Content-Type": "application/json" };

export class Mem9Client {
  constructor(config) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
    this.agentID = config.agentID;
    this.appID = config.appID;
  }

  async request(path, init = {}) {
    const response = await fetch(`${this.baseURL}/v1alpha2/mem9s${path}`, {
      ...init,
      headers: {
        ...JSON_HEADERS,
        "X-API-Key": this.apiKey,
        "X-Mnemo-Agent-Id": this.agentID,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`mem9 ${init.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${body}`);
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json();
  }

  async listMemories(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/memories${suffix}`);
  }

  async createPinnedMemory(memory) {
    return this.request("/memories", {
      method: "POST",
      body: JSON.stringify({
        content: memory.content,
        memory_type: "pinned",
        agent_id: this.agentID,
        appId: this.appID,
        tags: memory.tags,
        metadata: memory.metadata,
      }),
    });
  }

  async batchDelete(ids) {
    if (ids.length === 0) {
      return { deleted: 0 };
    }
    return this.request("/memories/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  }

  async recall(prompt, includeDataHub) {
    const query = new URLSearchParams({
      q: prompt,
      limit: "5",
      agent_id: this.agentID,
      appId: this.appID,
      include_datahub: includeDataHub ? "true" : "false",
    });
    return this.request(`/memories?${query.toString()}`);
  }
}

export async function listDemoMemories(client, config) {
  const pageSize = 200;
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await client.listMemories({
      limit: pageSize,
      offset,
      tags: config.demoTag,
      agent_id: config.agentID,
      memory_type: "pinned",
      sort_by: "updated_at",
      sort_dir: "desc",
    });
    const memories = Array.isArray(page.memories) ? page.memories : [];
    all.push(...memories);
    total = Number.isFinite(page.total) ? page.total : all.length;
    offset += pageSize;
    if (memories.length === 0) {
      break;
    }
  }
  return all.filter((memory) => isDemoMemory(memory, config));
}

export function isDemoMemory(memory, config) {
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  const metadata = memory.metadata && typeof memory.metadata === "object" ? memory.metadata : {};
  return (
    tags.includes(config.demoTag) &&
    memory.agent_id === config.agentID &&
    metadata.demo_slug === config.appID
  );
}
