# AGENTS.md

## Quick Handoff

`pi-persistent-session` is a Pi extension. Start at `index.ts`, then follow into `src/extension.ts`.

## Read First

- `README.md` for the intended user-facing behavior.
- `src/extension.ts` for Pi event flow and commands.
- `src/session-migration.ts` for migration rules.
- `src/workspace.ts` for Git-local marker migration and session-directory mapping.
- `src/config-schema.ts` and `src/config.ts` for settings.
- `index.test.ts` for the current regression shape.

## Work Rules

- Keep TypeScript erasable for Node's strip-only loader.
- Preserve active-session protection.
- Migrations are copy-first: write the full destination before removing any source.
- Resolve paths before comparing or storing them.
- Keep workspace-marker semantics stable unless the user asks to change them.
- Update tests and `README.md` when behavior changes.
- Bump versions only with `pnpm version <version> --sign-git-tag` (commits the bump and creates the signed `v<version>` tag).

## Commands

```bash
pnpm run typecheck
pnpm test
```

Do not commit unless the user asks.
