// @ts-check

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const DEFAULT_UPDATE_CHECK = Object.freeze({
  enabled: true,
  intervalHours: 24,
});

export const DEFAULT_REMOTE_UPGRADE_COMMAND =
  "codex plugin marketplace upgrade mem9-ai";
export const REMOTE_UPDATE_MANIFEST_URL =
  "https://raw.githubusercontent.com/mem9-ai/mem9/main/codex-plugin/.codex-plugin/plugin.json";
export const REMOTE_UPDATE_TIMEOUT_MS = 2_000;

/**
 * @typedef {{ enabled: boolean, intervalHours: number }} UpdateCheckConfig
 */

/**
 * @typedef {{
 *   schemaVersion: number,
 *   lastSeenVersion?: string,
 *   lastCheckedAt?: string,
 *   lastNotifiedVersion?: string,
 * }} UpdateState
 */

/**
 * @typedef {number | string} ParsedPrereleaseIdentifier
 */

/**
 * @typedef {{
 *   major: number,
 *   minor: number,
 *   patch: number,
 *   prerelease: ParsedPrereleaseIdentifier[],
 * }} ParsedVersion
 */

/**
 * @typedef {{
 *   latestVersion: string,
 *   upgradeCommand: string,
 * }} RemoteManifest
 */

/**
 * @typedef {{ ok?: boolean, json: () => Promise<unknown> }} FetchLikeResponse
 */

/**
 * @typedef {(url: string, init?: Record<string, unknown>) => Promise<FetchLikeResponse>} FetchLike
 */

/**
 * @typedef {{
 *   fetchImpl?: FetchLike,
 *   url?: string,
 * }} FetchRemoteManifestInput
 */

/**
 * @typedef {{
 *   pluginVersion?: string,
 *   runtime?: { updateCheck?: UpdateCheckConfig },
 *   state: UpdateState | unknown,
 *   now?: Date | string | number,
 *   manifest?: unknown,
 *   fetchImpl?: FetchLike,
 *   url?: string,
 * }} RemoteNoticeInput
 */

/**
 * @typedef {{
 *   statePath?: string,
 *   codexHome?: string,
 *   exists?: (filePath: string) => boolean,
 *   readJson?: (filePath: string) => unknown,
 * }} ReadStateInput
 */

/**
 * @typedef {{
 *   mkdir?: (dirPath: string) => void,
 *   writeText?: (filePath: string, text: string) => void,
 * }} WriteStateInput
 */

/**
 * @typedef {{
 *   pluginVersion?: string,
 *   runtime?: { updateCheck?: UpdateCheckConfig },
 *   statePath?: string,
 *   codexHome?: string,
 *   stateFile?: unknown,
 *   exists?: (filePath: string) => boolean,
 *   readJson?: (filePath: string) => unknown,
 *   mkdir?: (dirPath: string) => void,
 *   writeText?: (filePath: string, text: string) => void,
 *   now?: Date | string | number,
 *   manifest?: unknown,
 *   fetchImpl?: FetchLike,
 *   url?: string,
 * }} ResolveUpgradeNoticeInput
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * @param {Date | string | number | undefined} value
 * @returns {Date}
 */
function normalizeDate(value) {
  const candidate = value instanceof Date ? value : new Date(value ?? Date.now());

  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTimestamp(value) {
  const text = normalizeString(value);
  if (!text) {
    return "";
  }

  const time = Date.parse(text);
  if (!Number.isFinite(time)) {
    return "";
  }

  return new Date(time).toISOString();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeVersionText(value) {
  return normalizeString(value).replace(/^v/i, "");
}

/**
 * @param {unknown} value
 * @returns {UpdateState}
 */
function normalizeUpdateState(value) {
  const current = isRecord(value) ? value : {};
  const lastSeenVersion = normalizeString(current.lastSeenVersion);
  const lastCheckedAt = normalizeTimestamp(current.lastCheckedAt);
  const lastNotifiedVersion = normalizeString(current.lastNotifiedVersion);

  return {
    schemaVersion: 1,
    ...(lastSeenVersion ? { lastSeenVersion } : {}),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(lastNotifiedVersion ? { lastNotifiedVersion } : {}),
  };
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * @param {number} left
 * @param {number} right
 * @returns {-1 | 0 | 1}
 */
function compareNumbers(left, right) {
  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

/**
 * @param {unknown} version
 * @returns {ParsedVersion | null}
 */
function parseComparableVersion(version) {
  const text = normalizeVersionText(version);
  if (!text || text === "local") {
    return null;
  }

  const match = text.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split(".").map((segment) =>
        /^\d+$/.test(segment) ? Number(segment) : segment
      )
      : [],
  };
}

/**
 * @param {ParsedPrereleaseIdentifier} left
 * @param {ParsedPrereleaseIdentifier} right
 * @returns {-1 | 0 | 1}
 */
function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = typeof left === "number";
  const rightNumeric = typeof right === "number";

  if (leftNumeric && rightNumeric) {
    return compareNumbers(left, right);
  }

  if (leftNumeric) {
    return -1;
  }

  if (rightNumeric) {
    return 1;
  }

  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

/**
 * @param {ParsedVersion} left
 * @param {ParsedVersion} right
 * @returns {-1 | 0 | 1}
 */
function compareParsedVersions(left, right) {
  const majorComparison = compareNumbers(left.major, right.major);
  if (majorComparison !== 0) {
    return majorComparison;
  }

  const minorComparison = compareNumbers(left.minor, right.minor);
  if (minorComparison !== 0) {
    return minorComparison;
  }

  const patchComparison = compareNumbers(left.patch, right.patch);
  if (patchComparison !== 0) {
    return patchComparison;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }

  if (left.prerelease.length === 0) {
    return 1;
  }

  if (right.prerelease.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left.prerelease[index];
    const rightValue = right.prerelease[index];

    if (leftValue === undefined) {
      return -1;
    }

    if (rightValue === undefined) {
      return 1;
    }

    const comparison = comparePrereleaseIdentifier(leftValue, rightValue);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

/**
 * @param {unknown} value
 * @returns {RemoteManifest | null}
 */
function normalizeRemoteManifest(value) {
  const current = isRecord(value) ? value : {};
  const latestVersion = normalizeVersionText(
    typeof current.latestVersion === "string" ? current.latestVersion : current.version,
  );

  if (!latestVersion || comparePluginVersions(latestVersion, latestVersion) == null) {
    return null;
  }

  const upgradeCommand =
    normalizeString(current.upgradeCommand)
    || DEFAULT_REMOTE_UPGRADE_COMMAND;

  return {
    latestVersion,
    upgradeCommand,
  };
}

/**
 * @param {string | undefined} lastCheckedAt
 * @param {number} intervalHours
 * @param {Date} now
 * @returns {boolean}
 */
function isRemoteCheckDue(lastCheckedAt, intervalHours, now) {
  const previous = Date.parse(lastCheckedAt ?? "");
  if (!Number.isFinite(previous)) {
    return true;
  }

  return now.getTime() - previous >= intervalHours * 60 * 60 * 1_000;
}

/**
 * @param {FetchRemoteManifestInput} [input]
 * @returns {Promise<RemoteManifest | null>}
 */
async function fetchRemoteManifest(input = {}) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return null;
  }

  try {
    const response = await fetchImpl(
      input.url ?? REMOTE_UPDATE_MANIFEST_URL,
      {
        headers: {
          accept: "application/json",
        },
        signal:
          typeof AbortSignal !== "undefined"
          && typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(REMOTE_UPDATE_TIMEOUT_MS)
            : undefined,
      },
    );

    if (!response || response.ok === false || typeof response.json !== "function") {
      return null;
    }

    return normalizeRemoteManifest(await response.json());
  } catch {
    return null;
  }
}

/**
 * @param {RemoteNoticeInput} input
 * @returns {Promise<{message: string, state: UpdateState}>}
 */
async function maybeResolveRemoteUpdateNotice(input) {
  const state = normalizeUpdateState(input.state);
  const pluginVersion = normalizeVersionText(input.pluginVersion);
  const updateCheck = normalizeUpdateCheckConfig(input.runtime?.updateCheck);

  if (!updateCheck.enabled || !pluginVersion || pluginVersion === "local") {
    return {
      message: "",
      state,
    };
  }

  if (comparePluginVersions(pluginVersion, pluginVersion) == null) {
    return {
      message: "",
      state,
    };
  }

  const now = normalizeDate(input.now);
  if (!isRemoteCheckDue(state.lastCheckedAt, updateCheck.intervalHours, now)) {
    return {
      message: "",
      state,
    };
  }

  const nextState = {
    ...state,
    lastCheckedAt: now.toISOString(),
  };
  const manifest = Object.prototype.hasOwnProperty.call(input, "manifest")
    ? normalizeRemoteManifest(input.manifest)
    : await fetchRemoteManifest({
      fetchImpl: input.fetchImpl,
      url: input.url,
    });

  if (!manifest || comparePluginVersions(manifest.latestVersion, pluginVersion) !== 1) {
    return {
      message: "",
      state: nextState,
    };
  }

  if (state.lastNotifiedVersion === manifest.latestVersion) {
    return {
      message: "",
      state: nextState,
    };
  }

  return {
    message: `mem9 v${manifest.latestVersion} is available. Restart Codex or run \`${manifest.upgradeCommand}\`.`,
    state: {
      ...nextState,
      lastNotifiedVersion: manifest.latestVersion,
    },
  };
}

/**
 * @param {unknown} value
 * @returns {UpdateCheckConfig}
 */
export function normalizeUpdateCheckConfig(value) {
  const current = isRecord(value) ? value : {};

  return {
    enabled: current.enabled !== false,
    intervalHours: normalizePositiveInteger(
      current.intervalHours,
      DEFAULT_UPDATE_CHECK.intervalHours,
    ),
  };
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {-1 | 0 | 1 | null}
 */
export function comparePluginVersions(left, right) {
  const a = parseComparableVersion(left);
  const b = parseComparableVersion(right);

  if (!a || !b) {
    return null;
  }

  return compareParsedVersions(a, b);
}

/**
 * @param {string} codexHome
 * @returns {string}
 */
export function resolveUpdateStatePath(codexHome) {
  return path.join(codexHome, "mem9", "state.json");
}

/**
 * @param {ReadStateInput} [input]
 * @returns {UpdateState}
 */
export function readUpdateStateFile(input = {}) {
  const statePath = input.statePath
    ?? (input.codexHome ? resolveUpdateStatePath(input.codexHome) : "");
  const exists = input.exists ?? existsSync;
  const readJson = input.readJson ?? readJsonFile;

  if (!statePath || !exists(statePath)) {
    return normalizeUpdateState(null);
  }

  try {
    return normalizeUpdateState(readJson(statePath));
  } catch {
    return normalizeUpdateState(null);
  }
}

/**
 * @param {string} statePath
 * @param {unknown} state
 * @param {WriteStateInput} [input]
 * @returns {void}
 */
export function writeUpdateStateFile(statePath, state, input = {}) {
  if (!statePath) {
    return;
  }

  const mkdir = input.mkdir ?? ((dirPath) => {
    mkdirSync(dirPath, { recursive: true });
  });
  const writeText = input.writeText ?? ((filePath, text) => {
    writeFileSync(filePath, text);
  });
  const normalizedState = normalizeUpdateState(state);

  try {
    mkdir(path.dirname(statePath));
    writeText(
      statePath,
      `${JSON.stringify(normalizedState, null, 2)}\n`,
    );
  } catch {
    // SessionStart should stay best-effort even when the state file cannot be written.
  }
}

/**
 * @param {ResolveUpgradeNoticeInput} input
 * @returns {Promise<{message: string, state: UpdateState}>}
 */
export async function resolveUpgradeNotice(input) {
  const pluginVersion = normalizeVersionText(input.pluginVersion);
  const statePath = input.statePath
    ?? (input.codexHome ? resolveUpdateStatePath(input.codexHome) : "");
  const previousState = Object.prototype.hasOwnProperty.call(input, "stateFile")
    ? normalizeUpdateState(input.stateFile)
    : readUpdateStateFile({
      statePath,
      codexHome: input.codexHome,
      exists: input.exists,
      readJson: input.readJson,
    });
  const nextState = {
    ...previousState,
    ...(pluginVersion ? { lastSeenVersion: pluginVersion } : {}),
  };
  let localNotice = "";

  if (
    pluginVersion
    && pluginVersion !== "local"
    && previousState.lastSeenVersion
    && previousState.lastSeenVersion !== pluginVersion
  ) {
    const comparison = comparePluginVersions(
      pluginVersion,
      previousState.lastSeenVersion,
    );

    if (comparison === 1) {
      localNotice =
        `mem9 upgraded to v${pluginVersion}. Restart picked it up. Run \`$mem9:setup\` once only if this session later asks for migration.`;
    } else if (comparison == null && previousState.lastSeenVersion === "local") {
      localNotice =
        `mem9 is now running v${pluginVersion}. Restart picked it up. Run \`$mem9:setup\` once only if this session later asks for migration.`;
    }
  }

  /** @type {RemoteNoticeInput} */
  const remoteInput = {
    pluginVersion,
    runtime: input.runtime,
    state: nextState,
    now: input.now,
    fetchImpl: input.fetchImpl,
    url: input.url,
  };
  if (Object.prototype.hasOwnProperty.call(input, "manifest")) {
    remoteInput.manifest = input.manifest;
  }

  const remote = await maybeResolveRemoteUpdateNotice(remoteInput);
  const persistedState = normalizeUpdateState(remote.state);

  if (!Object.prototype.hasOwnProperty.call(input, "stateFile") && statePath) {
    writeUpdateStateFile(statePath, persistedState, {
      mkdir: input.mkdir,
      writeText: input.writeText,
    });
  }

  return {
    message: localNotice || remote.message || "",
    state: persistedState,
  };
}
