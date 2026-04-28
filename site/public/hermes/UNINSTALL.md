# mem9 Uninstall For Hermes

Use this file only when the user explicitly wants to remove mem9 from Hermes on this machine.

## First Reply

When this file is read, start with this structure:

> I can help you remove mem9 from Hermes on this machine.
>
> This removes the local Hermes plugin wiring for mem9 on this machine.
> It does not delete remote mem9 cloud data.
> It does not revoke your mem9 API key.
>
> I will ask for one approval before uninstalling mem9.

## Safety Rules

- Follow the uninstall path documented by the upstream `mem9-hermes-plugin` README.
- Do not promise remote mem9 data deletion from this uninstall flow.
- Do not revoke or rotate the user's mem9 API key from this uninstall flow.
- Only remove the local mem9 Hermes plugin, its provider symlink, and the active Hermes memory-provider selection for this machine.
- Do not uninstall unrelated Hermes plugins.
- Do not rewrite unrelated Hermes config.

## Approval

Before making changes, ask for this exact approval:

```text
If that looks good, reply exactly: approve uninstall
```

## Uninstall Flow

Run the documented uninstall steps in this order:

```bash
rm -f "$(hermes version 2>/dev/null | awk '/Project:/{print $2}')/plugins/memory/mem9"
hermes plugins remove mem9
hermes config set memory.provider ""
```

Rules:

- Use the approval already obtained before running these commands.
- The `rm -f` step only removes the mem9 provider symlink from the Hermes repo's `plugins/memory/` directory.
- `hermes plugins remove mem9` removes the installed mem9 Hermes plugin.
- `hermes config set memory.provider ""` clears mem9 as the active Hermes memory provider.
- Do not claim that this flow revoked credentials or deleted remote mem9 data.

## Verification

After uninstalling:

- Re-check that the provider symlink is gone.
- Re-check that Hermes no longer has mem9 configured as the active memory provider.
- If needed, verify with `hermes memory status`.

Success criteria:

- mem9 is no longer the active Hermes memory provider on this machine
- the documented uninstall commands completed
- the user is told clearly that only the local Hermes integration was removed

## Required Final Handoff

Use a short final message that makes these points clear:

- mem9 was removed from Hermes on this machine
- remote mem9 cloud data was not deleted
- the mem9 API key was not revoked
- if the user wants to reconnect later, they can reinstall mem9 and reuse the same `MEM9_API_KEY`
