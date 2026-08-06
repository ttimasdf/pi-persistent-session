# AGENTS.md

`pi-persistent-session` is a Pi extension package with TypeBox as its only runtime dependency. Pi loads `index.ts` directly through the `pi.extensions` manifest.

## Commands

```bash
pnpm run typecheck
pnpm test
```

Use erasable TypeScript syntax compatible with Node's strip-only loader. Keep filesystem migration transactional: write the complete target first, never modify the active session file, and remove a source only after a successful destination write.
