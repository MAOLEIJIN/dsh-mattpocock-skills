# Installation

The published package name is:

```text
@maoleijin/dsh-mattpocock-skills
```

No machine-specific filesystem path is required.

## Web profile

```powershell
npx --yes @deepseek-ai/dsh plugin --profile web add @maoleijin/dsh-mattpocock-skills
```

Verify the provider:

```powershell
npx --yes @deepseek-ai/dsh --profile web --dump-config | Select-String "mattpocock"
```

Restart `dsh web`, refresh the client, and create a new session.

## Desktop profile

The CLI cannot modify the Desktop-managed profile. In DSH Desktop:

1. Open the plugin-management window.
2. Choose the action for installing a package.
3. Enter `@maoleijin/dsh-mattpocock-skills`.
4. Wait for the registry preview and verify the exact package name and version.
5. Confirm installation.
6. Completely quit and reopen DSH Desktop.
7. Create a new session and invoke `/dsh-workflow`.

The Desktop package field accepts npm registry package names, not local paths or GitHub URLs.

## Windows helper

Run `scripts\install-web.bat`. It checks Node.js and pnpm, installs the published package into the Web profile, and verifies registration. Desktop installation remains an explicit UI operation because Electron exclusively owns that profile.

## Updating

Web profile:

```powershell
npx --yes @deepseek-ai/dsh plugin --profile web update @maoleijin/dsh-mattpocock-skills
```

For Desktop, use the update action in its plugin-management window. Restart and create a new session after upgrading.
