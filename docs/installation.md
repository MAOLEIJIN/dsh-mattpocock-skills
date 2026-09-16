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

The CLI cannot modify the Desktop-managed profile, and Desktop does not expose an arbitrary package-name field. Its plugin market installs only catalog entries. After this package has been accepted and indexed by the configured market:

1. Open the plugin-management window.
2. Search for `@maoleijin/dsh-mattpocock-skills`.
3. Open its market card.
4. Wait for the registry preview and verify the exact package name and version.
5. Confirm installation.
6. Completely quit and reopen DSH Desktop.
7. Create a new session and invoke `/dsh-workflow`.

Publishing to npm is necessary but not sufficient: the package must also be listed by the market's upstream catalog before this search can find it.

## Windows helper

Run `scripts\install-web.bat`. It checks Node.js and pnpm, installs the published package into the Web profile, and verifies registration. Desktop installation remains an explicit UI operation because Electron exclusively owns that profile.

## Updating

Web profile:

```powershell
npx --yes @deepseek-ai/dsh plugin --profile web update @maoleijin/dsh-mattpocock-skills
```

For Desktop, use the update action in its plugin list after the package has been installed from the market. Restart and create a new session after upgrading.
