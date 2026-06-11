const state = {
  config: null,
  story: null,
  mem9Only: null,
  enriched: null,
};

const elements = {
  modePill: document.querySelector("#mode-pill"),
  agentPill: document.querySelector("#agent-pill"),
  slackUser: document.querySelector("#slack-user"),
  slackChannel: document.querySelector("#slack-channel"),
  slackCommand: document.querySelector("#slack-command"),
  promptText: document.querySelector("#prompt-text"),
  sourceText: document.querySelector("#source-text"),
  lastRun: document.querySelector("#last-run"),
  evidenceCount: document.querySelector("#evidence-count"),
  answerMode: document.querySelector("#answer-mode"),
  memoryList: document.querySelector("#memory-list"),
  datahubList: document.querySelector("#datahub-list"),
  mem9Answer: document.querySelector("#mem9-answer"),
  enrichedAnswer: document.querySelector("#enriched-answer"),
  rawJSON: document.querySelector("#raw-json"),
  runBoth: document.querySelector("#run-both"),
  runMem9: document.querySelector("#run-mem9"),
  runEnriched: document.querySelector("#run-enriched"),
  resetSeed: document.querySelector("#reset-seed"),
};

async function init() {
  const [config, data] = await Promise.all([
    fetchJSON("/api/config"),
    fetchJSON("/fixtures/demo-data.json"),
  ]);
  state.config = config;
  state.story = data.story;
  renderStatic(config, data.story);
  renderEmpty();
  wireControls();
}

function wireControls() {
  elements.runBoth.addEventListener("click", () => runBoth());
  elements.runMem9.addEventListener("click", () => runRecall(false));
  elements.runEnriched.addEventListener("click", () => runRecall(true));
  elements.resetSeed.addEventListener("click", () => resetSeed());
}

async function runBoth() {
  setBusy(true);
  try {
    state.mem9Only = await fetchRecall(false);
    state.enriched = await fetchRecall(true);
    renderResults();
  } finally {
    setBusy(false);
  }
}

async function runRecall(includeDataHub) {
  setBusy(true);
  try {
    const result = await fetchRecall(includeDataHub);
    if (includeDataHub) {
      state.enriched = result;
    } else {
      state.mem9Only = result;
    }
    renderResults(includeDataHub);
  } finally {
    setBusy(false);
  }
}

async function resetSeed() {
  setBusy(true);
  try {
    const result = await fetchJSON("/api/reset-seed", { method: "POST" });
    elements.lastRun.textContent = result.mode === "fixture"
      ? "fixture reset"
      : `reset ${result.deleted} old, seeded ${result.created}`;
    await runBoth();
  } catch (error) {
    elements.lastRun.innerHTML = `<span class="error">${escapeHTML(error.message)}</span>`;
  } finally {
    setBusy(false);
  }
}

async function fetchRecall(includeDataHub) {
  return fetchJSON(`/api/recall?include_datahub=${includeDataHub ? "true" : "false"}`);
}

function renderStatic(config, story) {
  elements.modePill.textContent = config.mode;
  elements.agentPill.textContent = config.agent_id;
  elements.slackUser.textContent = story.slack_user;
  elements.slackChannel.textContent = story.slack_channel;
  elements.slackCommand.textContent = story.slack_command;
  elements.promptText.textContent = config.prompt;
  elements.sourceText.textContent = config.mode === "server-backed"
    ? "server-backed mem9 + DataHub MCP"
    : "fixture mode";
}

function renderEmpty() {
  elements.memoryList.innerHTML = `<div class="empty-state">No memory evidence captured.</div>`;
  elements.datahubList.innerHTML = `<div class="empty-state">No DataHub context captured.</div>`;
  elements.evidenceCount.textContent = "0 items";
  elements.rawJSON.textContent = "[]";
}

function renderResults(preferEnriched = true) {
  const active = preferEnriched && state.enriched ? state.enriched : state.mem9Only ?? state.enriched;
  if (!active) {
    renderEmpty();
    return;
  }

  const memories = active.response?.memories ?? [];
  const external = active.response?.external_context ?? [];
  elements.memoryList.innerHTML = memories.length
    ? memories.map(renderMemoryItem).join("")
    : `<div class="empty-state">No mem9 memories returned.</div>`;
  elements.datahubList.innerHTML = external.length
    ? external.map(renderDataHubItem).join("")
    : `<div class="empty-state">DataHub context was suppressed or unavailable.</div>`;

  elements.mem9Answer.textContent = state.mem9Only?.answer ?? "Run the mem9-only turn to capture the baseline answer.";
  elements.enrichedAnswer.textContent = state.enriched?.answer ?? "Run the enriched turn to capture the DataHub-backed answer.";
  elements.rawJSON.textContent = JSON.stringify(external, null, 2);
  elements.evidenceCount.textContent = `${memories.length + external.length} items`;
  elements.answerMode.textContent = active.mode;
  elements.lastRun.innerHTML = renderRunStatus(active);
}

function renderMemoryItem(memory) {
  const role = memory.metadata?.evidence_role ?? "memory";
  return `
    <article class="evidence-item memory">
      <div class="item-kicker"><span>${escapeHTML(memory.memory_type ?? "memory")}</span><span>${escapeHTML(role)}</span></div>
      <p class="item-title">${escapeHTML(memory.content)}</p>
      <p class="item-body">${escapeHTML((memory.tags ?? []).slice(0, 4).join(" / "))}</p>
    </article>
  `;
}

function renderDataHubItem(item) {
  return `
    <article class="evidence-item datahub">
      <div class="item-kicker"><span>${escapeHTML(item.provider ?? "datahub")}</span><span>${escapeHTML(item.type ?? "context")}</span></div>
      <p class="item-title">${escapeHTML(item.title ?? item.id ?? "DataHub context")}</p>
      <p class="item-body">${escapeHTML(item.snippet ?? "")}</p>
    </article>
  `;
}

function renderRunStatus(result) {
  const stamp = new Date(result.captured_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (result.fallback_error) {
    return `<span class="warning">${stamp} fixture fallback</span>`;
  }
  return `${stamp} ${escapeHTML(result.mode)}`;
}

function setBusy(isBusy) {
  for (const button of [
    elements.runBoth,
    elements.runMem9,
    elements.runEnriched,
    elements.resetSeed,
  ]) {
    button.disabled = isBusy;
  }
}

async function fetchJSON(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${url} failed with HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

init().catch((error) => {
  elements.lastRun.innerHTML = `<span class="error">${escapeHTML(error.message)}</span>`;
});
