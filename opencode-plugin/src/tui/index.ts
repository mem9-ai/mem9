import path from "node:path";
import type {
  TuiCommand,
  TuiPlugin,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import {
  resolveMem9Home,
  resolveMem9Paths,
  type Mem9ResolvedPaths,
} from "../shared/platform-paths.js";
import { PLUGIN_ID } from "../shared/plugin-meta.js";
import {
  loadSetupState,
  provisionApiKey,
  writeScopeConfig,
  writeSetupFiles,
  type ScopeConfigState,
  type SetupProfileSummary,
  type SetupScope,
  type SetupState,
} from "../shared/setup-files.js";

type SetupAction =
  | "auto-api-key"
  | "manual-api-key"
  | "use-profile-in-scope"
  | "configure-scope";

type ScopeFlowMode = "profile-only" | "full-config";

interface ProfileDraft {
  profileId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

interface ScopeDraft {
  scope: SetupScope;
  profileId: string;
  debug: boolean;
  defaultTimeoutMs: number;
  searchTimeoutMs: number;
}

export interface SetupActionOption {
  title: string;
  value: SetupAction;
  description: string;
}

function getProjectDir(api: TuiPluginApi): string {
  const worktree = api.state.path.worktree.trim();
  if (worktree.length > 0) {
    return worktree;
  }

  return api.state.path.directory;
}

function getProjectName(api: TuiPluginApi): string {
  const name = path.basename(getProjectDir(api)).trim();
  return name.length > 0 ? name : "this project";
}

function resolvePaths(api: TuiPluginApi): Mem9ResolvedPaths {
  return resolveMem9Paths({
    configDir: api.state.path.config,
    dataDir: api.state.path.state,
    projectDir: getProjectDir(api),
    mem9Home: resolveMem9Home(process.env),
  });
}

function createProfileDraft(state: SetupState): ProfileDraft {
  return {
    profileId: state.suggestedNewProfileId,
    label: state.suggestedLabel,
    baseUrl: state.suggestedBaseUrl,
    apiKey: "",
  };
}

function createScopeDraft(
  state: SetupState,
  scope: SetupScope,
): ScopeDraft {
  const scopeState = state.scopeStates[scope];
  return {
    scope,
    profileId: scopeState.profileId ?? state.usableProfiles[0]?.profileId ?? "",
    debug: scopeState.debug,
    defaultTimeoutMs: scopeState.defaultTimeoutMs,
    searchTimeoutMs: scopeState.searchTimeoutMs,
  };
}

function showError(
  api: TuiPluginApi,
  error: unknown,
  retryCommand = false,
): void {
  const suffix = retryCommand ? " Run /mem9-setup again when you are ready to retry." : "";
  api.ui.toast({
    variant: "error",
    title: "mem9 setup failed",
    message: `${error instanceof Error ? error.message : String(error)}${suffix}`,
  });
}

function showProfileSavedSuccess(api: TuiPluginApi, profileId: string): void {
  api.ui.toast({
    variant: "success",
    title: "mem9 configured",
    message: `Saved profile ${profileId} and set it as the default user profile. Restart OpenCode to reload mem9.`,
  });
}

function showScopeSavedSuccess(
  api: TuiPluginApi,
  scope: SetupScope,
  profileId: string,
): void {
  const scopeLabel = scope === "user" ? "user settings" : "project settings";
  api.ui.toast({
    variant: "success",
    title: "mem9 configured",
    message: `Saved ${scopeLabel} with profile ${profileId}. Restart OpenCode to reload mem9.`,
  });
}

function isReusableProfileID(state: SetupState, profileId: string): boolean {
  return state.usableProfiles.some((profile) => profile.profileId === profileId);
}

export function buildSetupActionOptions(
  state: Pick<SetupState, "usableProfiles">,
): SetupActionOption[] {
  const options: SetupActionOption[] = [
    {
      title: "Get a mem9 API key automatically",
      value: "auto-api-key",
      description: "Request a new mem9 API key and save it as a profile.",
    },
    {
      title: "Add an existing mem9 API key",
      value: "manual-api-key",
      description: "Paste a mem9 API key and save it as a profile.",
    },
  ];

  if (state.usableProfiles.length > 0) {
    options.push(
      {
        title: "Use an existing mem9 profile in a scope",
        value: "use-profile-in-scope",
        description: "Choose a saved profile and apply it to user or project settings.",
      },
      {
        title: "Configure user/project settings",
        value: "configure-scope",
        description: "Change scope profile, debug logging, and request timeouts.",
      },
    );
  }

  return options;
}

function parsePositiveInteger(value: string, field: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

async function submitManualProfile(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  draft: ProfileDraft,
): Promise<void> {
  try {
    await writeSetupFiles({
      paths,
      profileId: draft.profileId,
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
    });
    api.ui.dialog.clear();
    showProfileSavedSuccess(api, draft.profileId);
  } catch (error) {
    showError(api, error);
  }
}

async function submitProvisionedProfile(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  draft: ProfileDraft,
): Promise<void> {
  try {
    api.ui.toast({
      variant: "info",
      title: "mem9 setup",
      message: "Requesting a new mem9 API key...",
      duration: 3000,
    });

    const apiKey = await provisionApiKey({
      baseUrl: draft.baseUrl,
    });

    await writeSetupFiles({
      paths,
      profileId: draft.profileId,
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey,
    });
    api.ui.dialog.clear();
    showProfileSavedSuccess(api, draft.profileId);
  } catch (error) {
    api.ui.dialog.clear();
    showError(api, error, true);
  }
}

async function submitScopeConfigDraft(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  draft: ScopeDraft,
): Promise<void> {
  try {
    await writeScopeConfig({
      paths,
      scope: draft.scope,
      profileId: draft.profileId,
      debug: draft.debug,
      defaultTimeoutMs: draft.defaultTimeoutMs,
      searchTimeoutMs: draft.searchTimeoutMs,
    });
    api.ui.dialog.clear();
    showScopeSavedSuccess(api, draft.scope, draft.profileId);
  } catch (error) {
    showError(api, error);
  }
}

function showActionDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
): void {
  const options = buildSetupActionOptions(state);

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<SetupAction>({
      title: "What do you want to set up?",
      current: options[0]?.value,
      options,
      onSelect: (option) => {
        if (option.value === "auto-api-key" || option.value === "manual-api-key") {
          const draft = createProfileDraft(state);
          showProfileIdDialog(api, paths, state, option.value, draft);
          return;
        }

        if (option.value === "use-profile-in-scope") {
          showScopeDialog(api, paths, state, "profile-only");
          return;
        }

        showScopeDialog(api, paths, state, "full-config");
      },
    }),
  );
}

function showProfileIdDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  action: "auto-api-key" | "manual-api-key",
  draft: ProfileDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Profile ID",
      value: draft.profileId,
      placeholder: state.suggestedNewProfileId,
      onConfirm: (value) => {
        const next = value.trim();
        if (next.length === 0) {
          api.ui.toast({
            variant: "warning",
            message: "Profile ID is required.",
          });
          return;
        }

        if (isReusableProfileID(state, next)) {
          api.ui.toast({
            variant: "warning",
            message: "That profile already has credentials. Pick a new profile ID or use the existing profile in scope settings.",
          });
          return;
        }

        draft.profileId = next;
        if (draft.label.trim().length === 0) {
          draft.label = next === "default" ? "Personal" : next;
        }
        showProfileLabelDialog(api, paths, state, action, draft);
      },
      onCancel: () => {
        showActionDialog(api, paths, state);
      },
    }),
  );
}

function showProfileLabelDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  action: "auto-api-key" | "manual-api-key",
  draft: ProfileDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Profile label",
      value: draft.label,
      placeholder: draft.profileId === "default" ? "Personal" : draft.profileId,
      onConfirm: (value) => {
        const next = value.trim();
        if (next.length === 0) {
          api.ui.toast({
            variant: "warning",
            message: "Profile label is required.",
          });
          return;
        }

        draft.label = next;
        showProfileBaseUrlDialog(api, paths, state, action, draft);
      },
      onCancel: () => {
        showProfileIdDialog(api, paths, state, action, draft);
      },
    }),
  );
}

function showProfileBaseUrlDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  action: "auto-api-key" | "manual-api-key",
  draft: ProfileDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "mem9 API URL",
      value: draft.baseUrl,
      placeholder: "https://api.mem9.ai",
      onConfirm: (value) => {
        const next = value.trim();
        if (next.length === 0) {
          api.ui.toast({
            variant: "warning",
            message: "mem9 API URL is required.",
          });
          return;
        }

        draft.baseUrl = next;
        if (action === "auto-api-key") {
          void submitProvisionedProfile(api, paths, draft);
          return;
        }

        showProfileApiKeyDialog(api, paths, state, draft);
      },
      onCancel: () => {
        showProfileLabelDialog(api, paths, state, action, draft);
      },
    }),
  );
}

function showProfileApiKeyDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  draft: ProfileDraft,
): void {
  api.ui.toast({
    variant: "warning",
    message: "The current OpenCode prompt is plain text. Your API key stays visible while typing.",
    duration: 4000,
  });

  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "mem9 API key",
      placeholder: "mk_...",
      onConfirm: (value) => {
        const next = value.trim();
        if (next.length === 0) {
          api.ui.toast({
            variant: "warning",
            message: "mem9 API key is required.",
          });
          return;
        }

        draft.apiKey = next;
        void submitManualProfile(api, paths, draft);
      },
      onCancel: () => {
        showProfileBaseUrlDialog(api, paths, state, "manual-api-key", draft);
      },
    }),
  );
}

function showScopeDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  mode: ScopeFlowMode,
): void {
  const projectName = getProjectName(api);

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<SetupScope>({
      title: "Which settings scope do you want to update?",
      current: "user",
      options: [
        {
          title: "User settings",
          value: "user",
          description: "Use the same default mem9 settings across OpenCode on this machine.",
        },
        {
          title: "Project settings",
          value: "project",
          description: `Only override mem9 settings for ${projectName}.`,
        },
      ],
      onSelect: (option) => {
        const draft = createScopeDraft(state, option.value);
        showScopeProfileDialog(api, paths, state, mode, draft);
      },
    }),
  );
}

function showScopeProfileDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  mode: ScopeFlowMode,
  draft: ScopeDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<string>({
      title: "Which mem9 profile should this scope use?",
      current: draft.profileId,
      options: state.profiles.map((profile) => ({
        title: `${profile.label} (${profile.profileId})`,
        value: profile.profileId,
        description: `${profile.baseUrl} • ${profile.hasApiKey ? "API key configured" : "API key missing"}`,
        disabled: !profile.hasApiKey,
      })),
      onSelect: (option) => {
        draft.profileId = option.value;
        if (mode === "profile-only") {
          void submitScopeConfigDraft(api, paths, draft);
          return;
        }

        showScopeDebugDialog(api, paths, state, draft);
      },
    }),
  );
}

function showScopeDebugDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  draft: ScopeDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<boolean>({
      title: "Debug logging",
      current: draft.debug,
      options: [
        {
          title: "Disabled",
          value: false,
          description: "Keep debug logging off.",
        },
        {
          title: "Enabled",
          value: true,
          description: "Write redacted debug logs to the OpenCode state directory.",
        },
      ],
      onSelect: (option) => {
        draft.debug = option.value;
        showDefaultTimeoutDialog(api, paths, state, draft);
      },
    }),
  );
}

function showDefaultTimeoutDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  draft: ScopeDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Default request timeout (ms)",
      value: String(draft.defaultTimeoutMs),
      placeholder: "8000",
      onConfirm: (value) => {
        const parsed = parsePositiveInteger(value, "defaultTimeoutMs");
        if (parsed === null) {
          api.ui.toast({
            variant: "warning",
            message: "Default timeout must be a positive integer.",
          });
          return;
        }

        draft.defaultTimeoutMs = parsed;
        showSearchTimeoutDialog(api, paths, state, draft);
      },
      onCancel: () => {
        showScopeProfileDialog(api, paths, state, "full-config", draft);
      },
    }),
  );
}

function showSearchTimeoutDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  draft: ScopeDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Search timeout (ms)",
      value: String(draft.searchTimeoutMs),
      placeholder: "15000",
      onConfirm: (value) => {
        const parsed = parsePositiveInteger(value, "searchTimeoutMs");
        if (parsed === null) {
          api.ui.toast({
            variant: "warning",
            message: "Search timeout must be a positive integer.",
          });
          return;
        }

        draft.searchTimeoutMs = parsed;
        void submitScopeConfigDraft(api, paths, draft);
      },
      onCancel: () => {
        showDefaultTimeoutDialog(api, paths, state, draft);
      },
    }),
  );
}

async function startSetup(api: TuiPluginApi): Promise<void> {
  try {
    const paths = resolvePaths(api);
    const state = await loadSetupState(paths);
    showActionDialog(api, paths, state);
  } catch (error) {
    showError(api, error);
  }
}

const tui: TuiPlugin = async (api): Promise<void> => {
  const dispose = api.command.register((): TuiCommand[] => [
    {
      title: "mem9: setup",
      value: "mem9-setup",
      category: "mem9",
      description: "Manage mem9 API keys, profiles, and scope settings.",
      slash: {
        name: "mem9-setup",
      },
      onSelect: () => {
        void startSetup(api);
      },
    },
  ]);

  api.lifecycle.onDispose(dispose);
};

export default {
  id: PLUGIN_ID,
  tui,
};
