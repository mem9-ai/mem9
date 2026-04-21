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
  selectSetupProfile,
  writeSetupFiles,
  type SetupState,
} from "../shared/setup-files.js";

type SetupMode = "use-existing" | "create-new" | "manual-key";

interface SetupDraft {
  profileId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

function getProjectDir(api: TuiPluginApi): string {
  const worktree = api.state.path.worktree.trim();
  if (worktree.length > 0) {
    return worktree;
  }

  return api.state.path.directory;
}

function resolvePaths(api: TuiPluginApi): Mem9ResolvedPaths {
  return resolveMem9Paths({
    configDir: api.state.path.config,
    dataDir: api.state.path.state,
    projectDir: getProjectDir(api),
    mem9Home: resolveMem9Home(process.env),
  });
}

function createDraft(state: SetupState): SetupDraft {
  return {
    profileId: state.suggestedNewProfileId,
    label: state.suggestedLabel,
    baseUrl: state.suggestedBaseUrl,
    apiKey: "",
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

function showSelectedSuccess(api: TuiPluginApi, profileId: string): void {
  api.ui.toast({
    variant: "success",
    title: "mem9 configured",
    message: `Selected profile ${profileId} and set it as the OpenCode default. Restart OpenCode to reload mem9.`,
  });
}

function showSavedSuccess(api: TuiPluginApi, profileId: string): void {
  api.ui.toast({
    variant: "success",
    title: "mem9 configured",
    message: `Saved profile ${profileId} and set it as the OpenCode default. Restart OpenCode to reload mem9.`,
  });
}

async function submitExistingProfile(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  profileId: string,
): Promise<void> {
  try {
    await selectSetupProfile({
      paths,
      profileId,
    });
    api.ui.dialog.clear();
    showSelectedSuccess(api, profileId);
  } catch (error) {
    showError(api, error);
  }
}

async function submitManualProfile(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  draft: SetupDraft,
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
    showSavedSuccess(api, draft.profileId);
  } catch (error) {
    showError(api, error);
  }
}

async function submitProvisionedProfile(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  draft: SetupDraft,
): Promise<void> {
  try {
    api.ui.toast({
      variant: "info",
      title: "mem9 setup",
      message: "Requesting a new API key from mem9...",
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
    showSavedSuccess(api, draft.profileId);
  } catch (error) {
    api.ui.dialog.clear();
    showError(api, error, true);
  }
}

function isReusableProfileID(state: SetupState, profileId: string): boolean {
  return state.usableProfiles.some((profile) => profile.profileId === profileId);
}

function showModeDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
): void {
  const options: Array<{
    title: string;
    value: SetupMode;
    description: string;
  }> = [];

  if (state.usableProfiles.length > 0) {
    options.push({
      title: "Use existing profile",
      value: "use-existing",
      description: "Pick a saved mem9 profile and make it the default for OpenCode.",
    });
  }

  options.push(
    {
      title: "Create profile automatically",
      value: "create-new",
      description: "Request a fresh API key from mem9 and save it as a new profile.",
    },
    {
      title: "Create profile with API key",
      value: "manual-key",
      description: "Paste an existing API key and save it as a new profile.",
    },
  );

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<SetupMode>({
      title: "How should mem9 set up this OpenCode install?",
      current: state.usableProfiles.length > 0 ? "use-existing" : "create-new",
      options,
      onSelect: (option) => {
        if (option.value === "use-existing") {
          showExistingProfileDialog(api, paths, state);
          return;
        }

        const draft = createDraft(state);
        showProfileIdDialog(api, paths, state, option.value, draft);
      },
    }),
  );
}

function showExistingProfileDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
): void {
  const currentProfileId = state.usableProfiles.some(
    (profile) => profile.profileId === state.suggestedProfileId,
  )
    ? state.suggestedProfileId
    : state.usableProfiles[0]?.profileId;

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<string>({
      title: "Choose a mem9 profile",
      current: currentProfileId,
      options: state.usableProfiles.map((profile) => ({
        title: `${profile.label} (${profile.profileId})`,
        value: profile.profileId,
        description: profile.baseUrl,
      })),
      onSelect: (option) => {
        void submitExistingProfile(api, paths, option.value);
      },
    }),
  );
}

function showProfileIdDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  mode: SetupMode,
  draft: SetupDraft,
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
            message: "That profile already has credentials. Choose a new profile ID or reuse the existing profile.",
          });
          return;
        }

        draft.profileId = next;
        if (draft.label.trim().length === 0) {
          draft.label = next === "default" ? "Personal" : next;
        }
        showLabelDialog(api, paths, state, mode, draft);
      },
      onCancel: () => {
        showModeDialog(api, paths, state);
      },
    }),
  );
}

function showLabelDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  mode: SetupMode,
  draft: SetupDraft,
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
        showBaseUrlDialog(api, paths, state, mode, draft);
      },
      onCancel: () => {
        showProfileIdDialog(api, paths, state, mode, draft);
      },
    }),
  );
}

function showBaseUrlDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  mode: SetupMode,
  draft: SetupDraft,
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
        if (mode === "create-new") {
          void submitProvisionedProfile(api, paths, draft);
          return;
        }

        showApiKeyDialog(api, paths, state, draft);
      },
      onCancel: () => {
        showLabelDialog(api, paths, state, mode, draft);
      },
    }),
  );
}

function showApiKeyDialog(
  api: TuiPluginApi,
  paths: Mem9ResolvedPaths,
  state: SetupState,
  draft: SetupDraft,
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
        showBaseUrlDialog(api, paths, state, "manual-key", draft);
      },
    }),
  );
}

async function startSetup(api: TuiPluginApi): Promise<void> {
  try {
    const paths = resolvePaths(api);
    const state = await loadSetupState(paths);
    showModeDialog(api, paths, state);
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
      description: "Reuse a mem9 profile or create a new one for OpenCode.",
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
