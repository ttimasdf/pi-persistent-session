# pi-persistent-session

A minimal Pi extension that moves project-associated session JSONL files when a workspace directory moves.

## How it works

On `session_start`, the extension optionally creates this workspace-local identity:

```text
.pi/persistent-session.json
```

```json
{
  "version": 1,
  "sessionNamespaceId": "--previous-workspace-path--",
  "observedCwd": "/previous/workspace/path"
}
```

`sessionNamespaceId` is the directory name from Pi's default `<agentDir>/sessions/<sessionNamespaceId>` mapping. Keeping that name instead of an absolute session-directory path lets the extension find a copied Pi session tree under the current agent directory.

When `observedCwd` differs from Pi's current cwd and the previous path no longer exists, the extension can migrate the old workspace's sessions. It:

1. Reconstructs the source as `<currentAgentDir>/sessions/<sessionNamespaceId>` for Pi's default storage. Custom session directories are rewritten in place.
2. Reads each `.jsonl` file from that source directory.
3. Requires a `type: "session"`, `version: 3` header.
4. Migrates only headers whose `cwd` matches `observedCwd`.
5. Rewrites the header cwd and writes the complete file to Pi's current session directory.
6. Optionally removes the original only after the destination exists completely.
7. Updates the marker with the current cwd-derived namespace after every matching file migrates without errors.

The active session file is never migrated or deleted. If it is in the source directory, start a new session from the moved workspace and run the migration there. Close other Pi processes using the source sessions before migrating; Pi does not lock inactive session files.

After migration, use `/resume` to select a migrated session. `/reload` reloads extensions and resources but does not reopen a moved session file.

If the previous cwd still exists, the extension treats the workspace as a copy and does not migrate sessions automatically.

## Installation

From this checkout:

```bash
pi install /absolute/path/to/pi-persistent-session
```

For a one-run test:

```bash
pi -e ./index.ts
```

## Settings

Pi does not expose a plugin settings registration API. This extension stores its settings in:

```text
~/.pi/agent/extension-settings/pi-persistent-session.json
```

Use `/persistent-session-settings` to edit one setting at a time.

| Setting | Values | Default |
|---|---|---|
| `sessionNamespacePolicy` | `auto`, `prompt`, `never` | `prompt` |
| `gitignorePolicy` | `auto`, `prompt`, `never` | `prompt` |
| `relocationPolicy` | `auto`, `prompt`, `warn` | `prompt` |
| `removeOriginalSessions` | boolean | `false` |

When enabled, Git handling recommends or adds an exact ignore rule for `.pi/persistent-session.json`. If the file is already tracked, the extension warns but does not alter the Git index.

## Commands

- `/persistent-session-migrate` — manually run a detected relocation migration.
- `/persistent-session-settings` — configure extension policies.

## Safety behavior

While a relocation is unresolved, normal prompts are handled without adding a user message. Tool calls are blocked. The same protection activates if the current cwd disappears while Pi is running.

Pi itself checks a saved session's cwd at startup and during session switching. Interactive mode can reopen the session with the current cwd; non-interactive modes refuse it. Pi does not continuously prevent every internal session metadata append after a directory disappears, so this extension cannot guarantee protection from built-in commands or a move during an already-running turn.

This extension intentionally reads and rewrites inactive Pi-managed session files because Pi does not expose a public relocation API. It writes the complete destination before optionally removing a source, refuses to modify the active session, and aborts on conflicting destination content.
