# mem9 Troubleshooting For Hermes

Use this file for Hermes install failures, reconnect failures, provider-link issues, or inactive mem9 status after setup.

## Quick Checks

Confirm these first:

- `hermes version` works
- the mem9 Hermes plugin is installed
- the mem9 provider link exists inside the Hermes repo's `plugins/memory/` directory
- `hermes memory status` shows whether mem9 is active
- if reconnecting an existing space, the expected `MEM9_API_KEY` is available to the setup flow

Do not run `hermes memory setup` from this skill. The interactive picker only lists providers it can already detect, so when mem9 is partially installed it just selects "built-in only" and overwrites the install script's work. Repair through the install script and `link-memory-provider.sh` instead.

## Common Issues

### `hermes` Command Is Missing

- Hermes must be installed before mem9 can be installed.
- Stop and ask the user to install Hermes first.

### Official Install Script Failed

- Retry the official script first:

```bash
curl -fsSL https://raw.githubusercontent.com/mem9-ai/mem9-hermes-plugin/main/install.sh | bash
```

- If the upstream script is unavailable, use the documented manual fallback. Run the steps in order, and follow `SETUP.md` Step 3b for the API key resolution (check `.env` → ask the user → provision via mem9 API):

```bash
# 1. Install the plugin files
hermes plugins install mem9-ai/mem9-hermes-plugin

# 2. Link into the Hermes memory provider directory
bash "${HERMES_HOME:-$HOME/.hermes}/plugins/mem9/scripts/link-memory-provider.sh"

# 3. Ensure MEM9_API_KEY is set in ${HERMES_HOME:-$HOME/.hermes}/.env
#    (see SETUP.md Step 3b — do not auto-provision if a key already exists)

# 4. Set mem9 as the active memory provider
hermes config set memory.provider mem9
```

- After the manual path completes, verify with `hermes memory status`.

### mem9 Is Installed But Not Active

- Run the upstream helper script at `${HERMES_HOME:-$HOME/.hermes}/plugins/mem9/scripts/link-memory-provider.sh`.
- If Hermes cannot auto-detect the project root, rerun that helper with `HERMES_PROJECT_ROOT` set for that one command only.
- If the active provider is still wrong, set it explicitly with `hermes config set memory.provider mem9`.
- Verify again with `hermes memory status`.

### Existing API Key Did Not Reconnect Correctly

- Re-run the install or setup flow with the intended `MEM9_API_KEY`.
- Do not silently create a new mem9 space when the user asked to reconnect an existing one.
- After reconnecting, verify with `hermes memory status`.

### Connectivity Failed During Install

- The upstream README says the install script can finish plugin installation even if the final connectivity test fails.
- If that happens, re-run the install script once connectivity is restored, then `hermes memory status`.
- Re-check that the default mem9 API URL is still `https://api.mem9.ai` unless the user explicitly chose another endpoint.

### mem9 Still Does Not Work After Setup

- Re-run the official install script.
- Re-run the provider-link step (`link-memory-provider.sh`) if Hermes still does not see mem9.
- Re-run `hermes memory status`.
- If mem9 is still inactive, report the failure clearly and stop instead of claiming install succeeded.

### Need More Diagnostic Detail

- The upstream README documents that Hermes logging can be raised temporarily with:

```bash
hermes config set logging.level "DEBUG"
```

- After collecting the needed information, the user can restore the previous logging level.

## Reconnect On Another Machine

- Install the mem9 Hermes plugin with the official install flow.
- Provide the same `MEM9_API_KEY` during setup.
- Finish the provider-link step if Hermes does not activate mem9 automatically.
- Verify with `hermes memory status`.
