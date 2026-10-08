# pi-persistent-session

[中文](./README_CN.md) | English

[![pi package catalog](https://img.shields.io/badge/pi-package%20catalog-5B5BD6.svg)](https://pi.dev/packages/pi-persistent-session)
[![npm](https://img.shields.io/npm/v/pi-persistent-session.svg)](https://www.npmjs.com/package/pi-persistent-session)

A minimal Pi extension that keeps a workspace identity marker and moves project-associated session JSONL files when a workspace directory moves.

The workspace identity marker is stored in one of these locations:

| Data | Location |
|---|---|
| Workspace identity | `.git/persistent-session.json` when the workspace is a Git repository with a `.git` directory; otherwise `.pi/persistent-session.json` |

## How it works

On `session_start`, the extension optionally creates a workspace identity marker. When the workspace is a Git repository with a `.git` directory, the marker lives in Git metadata and cannot be committed:

```text
.git/persistent-session.json
```

Otherwise, including Git worktrees and submodules whose `.git` entry is a file, it falls back to:

```text
.pi/persistent-session.json
```

The extension checks only whether the workspace itself contains a `.git` directory; it does not search for an enclosing Git repository.

```json
{
  "version": 1,
  "sessionNamespaceId": "--previous-workspace-path--",
  "observedCwd": "/previous/workspace/path"
}
```

`sessionNamespaceId` is the directory name from Pi's default `<agentDir>/sessions/<sessionNamespaceId>` mapping. Keeping that name instead of an absolute session-directory path lets the extension find a copied Pi session tree under the current agent directory.

When both marker locations exist, `.git/persistent-session.json` takes precedence and `.pi/persistent-session.json` is left untouched. The `.pi` location remains the normal storage location otherwise.

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

Install from npm:

```bash
pi install npm:pi-persistent-session
```

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
| `relocationPolicy` | `auto`, `prompt`, `warn` | `prompt` |
| `removeOriginalSessions` | boolean | `false` |

The selected marker location is created only when `sessionNamespacePolicy` allows it.

## Commands

- `/persistent-session-migrate` — manually run a detected relocation migration.
- `/persistent-session-settings` — configure extension policies.

## Safety behavior

While a relocation is unresolved, normal prompts are handled without adding a user message. Tool calls are blocked. The same protection activates if the current cwd disappears while Pi is running.

Pi itself checks a saved session's cwd at startup and during session switching. Interactive mode can reopen the session with the current cwd; non-interactive modes refuse it. Pi does not continuously prevent every internal session metadata append after a directory disappears, so this extension cannot guarantee protection from built-in commands or a move during an already-running turn.

This extension intentionally reads and rewrites inactive Pi-managed session files because Pi does not expose a public relocation API. It writes the complete destination before optionally removing a source, refuses to modify the active session, and aborts on conflicting destination content.
