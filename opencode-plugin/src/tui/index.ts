import { resolveMem9Home, resolveMem9Paths } from "../shared/platform-paths.js";
import { PLUGIN_ID, PLUGIN_PACKAGE_NAME } from "../shared/plugin-meta.js";
import { resolveServerPluginSpec } from "../shared/plugin-spec.js";
import {
  loadSetupDefaults,
  writeSetupFiles,
  type SetupDefaults,
  type SetupScope,
} from "../shared/setup-files.js";

interface TuiCommand {
  title: string;
  value: string;
  description?: string;
  category?: string;
  slash?: {
    name: string;
    aliases?: string[];
  };
  onSelect?: () => void;
}

interface TuiDialogPromptProps {
  title: string;
  placeholder?: string;
  value?: string;
  onConfirm?: (value: string) => void;
  onCancel?: () => void;
}

interface TuiDialogSelectOption<Value> {
  title: string;
  value: Value;
  description?: string;
}

interface TuiDialogSelectProps<Value> {
  title: string;
  options: TuiDialogSelectOption<Value>[];
  current?: Value;
  onSelect?: (option: TuiDialogSelectOption<Value>) => void;
}

interface TuiPluginApi {
  command: {
    register(cb: () => TuiCommand[]): () => void;
  };
  ui: {
    DialogPrompt: (props: TuiDialogPromptProps) => unknown;
    DialogSelect: <Value>(props: TuiDialogSelectProps<Value>) => unknown;
    toast(input: {
      variant?: "info" | "success" | "warning" | "error";
      title?: string;
      message: string;
      duration?: number;
    }): void;
    dialog: {
      replace(render: () => unknown, onClose?: () => void): void;
      clear(): void;
    };
  };
  state: {
    path: {
      config: string;
      state: string;
      worktree: string;
      directory: string;
    };
  };
  lifecycle: {
    onDispose(fn: () => void | Promise<void>): () => void;
  };
}

interface TuiPluginMeta {
  spec: string;
}

interface SetupDraft {
  scope: SetupScope;
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

function showError(api: TuiPluginApi, error: unknown): void {
  api.ui.toast({
    variant: "error",
    title: "mem9 setup failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

function showScopeDialog(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  defaultsByScope: Record<SetupScope, SetupDefaults>,
  draft: SetupDraft,
): void {
  const projectDir = getProjectDir(api);
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<SetupScope>({
      title: "Enable mem9 in user or project scope?",
      current: draft.scope,
      options: [
        {
          title: "User scope",
          value: "user",
          description: "Reuse one mem9 profile across this machine.",
        },
        {
          title: "Project scope",
          value: "project",
          description: `Only enable mem9 for ${projectDir}.`,
        },
      ],
      onSelect: (option) => {
        draft.scope = option.value;
        const defaults = defaultsByScope[option.value];
        draft.profileId = defaults.profileId;
        draft.label = defaults.label;
        draft.baseUrl = defaults.baseUrl;
        showProfileDialog(api, meta, defaultsByScope, draft);
      },
    }),
  );
}

function showProfileDialog(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  defaultsByScope: Record<SetupScope, SetupDefaults>,
  draft: SetupDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Profile ID",
      value: draft.profileId,
      placeholder: "default",
      onConfirm: (value) => {
        const next = value.trim();
        if (next.length === 0) {
          api.ui.toast({
            variant: "warning",
            message: "Profile ID is required.",
          });
          return;
        }

        draft.profileId = next;
        showLabelDialog(api, meta, defaultsByScope, draft);
      },
      onCancel: () => {
        api.ui.dialog.clear();
      },
    }),
  );
}

function showLabelDialog(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  defaultsByScope: Record<SetupScope, SetupDefaults>,
  draft: SetupDraft,
): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Profile label",
      value: draft.label,
      placeholder: "Personal",
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
        showBaseUrlDialog(api, meta, defaultsByScope, draft);
      },
      onCancel: () => {
        showProfileDialog(api, meta, defaultsByScope, draft);
      },
    }),
  );
}

function showBaseUrlDialog(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  defaultsByScope: Record<SetupScope, SetupDefaults>,
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
        showApiKeyDialog(api, meta, defaultsByScope, draft);
      },
      onCancel: () => {
        showLabelDialog(api, meta, defaultsByScope, draft);
      },
    }),
  );
}

function showApiKeyDialog(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  defaultsByScope: Record<SetupScope, SetupDefaults>,
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
        void submitSetup(api, meta, draft);
      },
      onCancel: () => {
        showBaseUrlDialog(api, meta, defaultsByScope, draft);
      },
    }),
  );
}

async function submitSetup(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  draft: SetupDraft,
): Promise<void> {
  try {
    const paths = resolveMem9Paths({
      configDir: api.state.path.config,
      dataDir: api.state.path.state,
      projectDir: getProjectDir(api),
      mem9Home: resolveMem9Home(process.env),
    });

    const result = await writeSetupFiles({
      paths,
      scope: draft.scope,
      pluginSpec: resolveServerPluginSpec(meta.spec || PLUGIN_PACKAGE_NAME),
      profileId: draft.profileId,
      label: draft.label,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey,
    });

    api.ui.dialog.clear();
    api.ui.toast({
      variant: "success",
      title: "mem9 configured",
      message: `Saved ${draft.profileId} and updated ${draft.scope} scope. Restart OpenCode to reload the server plugin.`,
    });

    if (result.duplicatePluginConfigFile) {
      api.ui.toast({
        variant: "warning",
        title: "Duplicate mem9 registration",
        message: `mem9 is still registered in another scope at ${result.duplicatePluginConfigFile}. Keep one active entry.`,
        duration: 6000,
      });
    }
  } catch (error) {
    showError(api, error);
  }
}

async function startSetup(api: TuiPluginApi, meta: TuiPluginMeta): Promise<void> {
  try {
    const paths = resolveMem9Paths({
      configDir: api.state.path.config,
      dataDir: api.state.path.state,
      projectDir: getProjectDir(api),
      mem9Home: resolveMem9Home(process.env),
    });

    const [userDefaults, projectDefaults] = await Promise.all([
      loadSetupDefaults(paths, "user"),
      loadSetupDefaults(paths, "project"),
    ]);

    const draft: SetupDraft = {
      scope: "user",
      profileId: userDefaults.profileId,
      label: userDefaults.label,
      baseUrl: userDefaults.baseUrl,
      apiKey: "",
    };

    showScopeDialog(
      api,
      meta,
      {
        user: userDefaults,
        project: projectDefaults,
      },
      draft,
    );
  } catch (error) {
    showError(api, error);
  }
}

const tui = async (api: TuiPluginApi, _options: unknown, meta: TuiPluginMeta): Promise<void> => {
  const dispose = api.command.register(() => [
    {
      title: "mem9: initialize setup",
      value: "mem9-init",
      category: "mem9",
      description: "Create or update mem9 credentials and scope config.",
      slash: {
        name: "mem9-init",
      },
      onSelect: () => {
        void startSetup(api, meta);
      },
    },
  ]);

  api.lifecycle.onDispose(dispose);
};

export default {
  id: PLUGIN_ID,
  tui,
};
