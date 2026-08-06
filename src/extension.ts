import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import Value from "typebox/value";

import {
	configPath,
	loadSettings,
	saveSettings,
} from "./config.ts";
import {
	DEFAULT_SETTINGS,
	GitignorePolicySchema,
	type PersistentSessionSettings,
	RelocationPolicySchema,
	SessionNamespacePolicySchema,
} from "./config-schema.ts";
import { checkGitignore } from "./gitignore.ts";
import {
	migrateSessionFiles,
	type SessionMigrationResult,
} from "./session-migration.ts";
import {
	createWorkspaceIdentity,
	loadWorkspaceIdentity,
	relocationDirectories,
	saveWorkspaceIdentity,
	type WorkspaceIdentity,
	workspacePath,
} from "./workspace.ts";

function reportMigration(
	ctx: ExtensionContext,
	result: SessionMigrationResult,
	targetDir: string,
): void {
	if (result.errors.length > 0) {
		const details = result.errors.slice(0, 3).join("\n");
		const remainder =
			result.errors.length > 3
				? `\n...and ${result.errors.length - 3} more`
				: "";
		ctx.ui.notify(
			`Session migration incomplete:\n${details}${remainder}`,
			"error",
		);
		return;
	}
	ctx.ui.notify(
		`Migrated ${result.migrated} session file(s) to ${targetDir}. Use /resume to select a migrated session.`,
		"info",
	);
}

export default function persistentSessionExtension(pi: ExtensionAPI) {
	let settings: PersistentSessionSettings = { ...DEFAULT_SETTINGS };
	let blockedReason: string | undefined;
	let migrationRunning = false;

	async function migrateIdentity(
		identity: WorkspaceIdentity,
		ctx: ExtensionContext,
	): Promise<boolean> {
		if (migrationRunning) return false;
		migrationRunning = true;
		try {
			const markerPath = workspacePath(ctx.cwd);
			const { sourceDir, targetDir } = relocationDirectories(
				identity,
				ctx.cwd,
				ctx.sessionManager.getSessionDir(),
			);
			if (!existsSync(sourceDir)) {
				ctx.ui.notify(`Session namespace not found: ${sourceDir}`, "error");
				return false;
			}
			const result = await migrateSessionFiles({
				oldCwd: identity.observedCwd,
				newCwd: ctx.cwd,
				sourceDir,
				targetDir,
				activeSessionFile: ctx.sessionManager.getSessionFile(),
				removeOriginals: settings.removeOriginalSessions,
			});
			reportMigration(ctx, result, targetDir);
			if (result.errors.length > 0) return false;

			await saveWorkspaceIdentity(markerPath, ctx.cwd);
			blockedReason = undefined;
			return true;
		} finally {
			migrationRunning = false;
		}
	}

	async function handleRelocation(
		identity: WorkspaceIdentity,
		ctx: ExtensionContext,
	): Promise<void> {
		if (resolve(identity.observedCwd) === resolve(ctx.cwd)) return;
		// If the old path still exists, both directories are present. Treat this
		// as a copy/clone rather than guessing that sessions should be duplicated.
		if (existsSync(identity.observedCwd)) {
			ctx.ui.notify(
				`Session namespace ${identity.sessionNamespaceId} also belongs to ${identity.observedCwd}; this looks like a copy, not a move. No sessions were migrated.`,
				"warning",
			);
			return;
		}

		blockedReason = `Workspace moved from ${identity.observedCwd}; migrate sessions or restart without this extension`;
		if (settings.relocationPolicy === "warn") {
			ctx.ui.notify(
				`${blockedReason}. Run /persistent-session-migrate to migrate.`,
				"warning",
			);
			return;
		}

		let shouldMigrate = settings.relocationPolicy === "auto";
		if (settings.relocationPolicy === "prompt" && ctx.hasUI) {
			const { sourceDir } = relocationDirectories(
				identity,
				ctx.cwd,
				ctx.sessionManager.getSessionDir(),
			);
			shouldMigrate = await ctx.ui.confirm(
				"Workspace moved",
				`Move sessions from\n${sourceDir}\nto the session directory for\n${ctx.cwd}?`,
			);
		}
		if (!shouldMigrate) {
			ctx.ui.notify(
				`${blockedReason}. Run /persistent-session-migrate to migrate.`,
				"warning",
			);
			return;
		}
		await migrateIdentity(identity, ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		blockedReason = undefined;
		try {
			if (!ctx.sessionManager.getSessionFile()) return;
			settings = await loadSettings();
			if (!existsSync(ctx.cwd)) {
				blockedReason = `Current working directory no longer exists: ${ctx.cwd}`;
				ctx.ui.notify(blockedReason, "error");
				return;
			}

			const markerPath = workspacePath(ctx.cwd);
			let identity = await loadWorkspaceIdentity(markerPath);
			if (!identity) {
				let shouldCreate = settings.sessionNamespacePolicy === "auto";
				if (settings.sessionNamespacePolicy === "prompt" && ctx.hasUI) {
					shouldCreate = await ctx.ui.confirm(
						"Enable persistent sessions?",
						`Create ${markerPath} so sessions can follow this workspace when it moves?`,
					);
				}
				if (!shouldCreate) return;
				identity = await createWorkspaceIdentity(markerPath, ctx.cwd);
			}

			if (
				resolve(identity.observedCwd) !== resolve(ctx.cwd) &&
				!existsSync(identity.observedCwd)
			) {
				blockedReason = `Workspace moved from ${identity.observedCwd}; migrate sessions or restart without this extension`;
			}
			await checkGitignore(pi, ctx, markerPath, settings.gitignorePolicy);
			await handleRelocation(identity, ctx);
		} catch (error) {
			ctx.ui.notify(
				`pi-persistent-session error: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});

	// Do not let new messages or tool calls extend a session while its workspace
	// identity is unresolved; otherwise the session could be split across cwd maps.
	pi.on("input", (_event, ctx) => {
		if (!existsSync(ctx.cwd)) {
			blockedReason = `Current working directory no longer exists: ${ctx.cwd}`;
		}
		if (!blockedReason) return { action: "continue" as const };
		ctx.ui.notify(
			`${blockedReason}. Input was not added to the session.`,
			"error",
		);
		return { action: "handled" as const };
	});

	pi.on("tool_call", (_event, ctx) => {
		if (!existsSync(ctx.cwd)) {
			blockedReason = `Current working directory no longer exists: ${ctx.cwd}`;
		}
		if (blockedReason) return { block: true, reason: blockedReason };
	});

	pi.registerCommand("persistent-session-migrate", {
		description: "Migrate sessions after this workspace directory moved",
		handler: async (_args, ctx) => {
			try {
				settings = await loadSettings();
				const identity = await loadWorkspaceIdentity(workspacePath(ctx.cwd));
				if (!identity) {
					ctx.ui.notify(
						"No persistent-session workspace identity exists",
						"warning",
					);
					return;
				}
				if (resolve(identity.observedCwd) === resolve(ctx.cwd)) {
					ctx.ui.notify("Workspace path has not changed", "info");
					return;
				}
				if (existsSync(identity.observedCwd)) {
					ctx.ui.notify(
						"The previous workspace path still exists; refusing to treat this copy as a move",
						"error",
					);
					return;
				}
				await migrateIdentity(identity, ctx);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.registerCommand("persistent-session-settings", {
		description: "Configure persistent-session policies",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Persistent-session settings require UI mode", "error");
				return;
			}
			try {
				settings = await loadSettings();
				const selected = await ctx.ui.select("Persistent-session setting", [
					`Session namespace creation: ${settings.sessionNamespacePolicy}`,
					`Gitignore handling: ${settings.gitignorePolicy}`,
					`Relocation handling: ${settings.relocationPolicy}`,
					`Remove original sessions: ${settings.removeOriginalSessions ? "yes" : "no"}`,
				]);
				if (!selected) return;

				if (selected.startsWith("Session namespace")) {
					const value = await ctx.ui.select("Session namespace creation", [
						"auto",
						"prompt",
						"never",
					]);
					if (Value.Check(SessionNamespacePolicySchema, value)) {
						settings.sessionNamespacePolicy = value;
					}
				} else if (selected.startsWith("Gitignore")) {
					const value = await ctx.ui.select("Gitignore handling", [
						"auto",
						"prompt",
						"never",
					]);
					if (Value.Check(GitignorePolicySchema, value)) {
						settings.gitignorePolicy = value;
					}
				} else if (selected.startsWith("Relocation")) {
					const value = await ctx.ui.select("Relocation handling", [
						"auto",
						"prompt",
						"warn",
					]);
					if (Value.Check(RelocationPolicySchema, value)) {
						settings.relocationPolicy = value;
					}
				} else {
					const value = await ctx.ui.select("Remove original session files", [
						"no",
						"yes",
					]);
					if (value === "yes" || value === "no") {
						settings.removeOriginalSessions = value === "yes";
					}
				}

				await saveSettings(settings);
				ctx.ui.notify(`Saved ${configPath()}`, "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});
}
