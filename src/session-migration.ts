import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { Type, type Static } from "typebox";
import Value from "typebox/value";

import {
	replaceFileAtomic,
	writeNewFileAtomic,
} from "./atomic-files.ts";

const SessionHeaderCandidateSchema = Type.Object(
	{
		type: Type.Literal("session"),
		version: Type.Optional(Type.Unknown()),
		cwd: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);

type SessionHeaderCandidate = Static<typeof SessionHeaderCandidateSchema> &
	Record<string, unknown>;

export interface SessionRewriteResult {
	status: "rewritten" | "unrelated" | "invalid";
	content?: string;
	error?: string;
}

export interface SessionMigrationResult {
	matched: number;
	migrated: number;
	removed: number;
	retained: number;
	unrelated: number;
	errors: string[];
}

interface MigrationPlan {
	sourcePath: string;
	targetPath: string;
	content: string;
}

/** Rewrite only the session header, preserving conversation and branch entries. */
export function rewriteSessionCwd(
	content: string,
	oldCwd: string,
	newCwd: string,
): SessionRewriteResult {
	const lines = content.split("\n");
	let headerIndex = -1;
	let header: SessionHeaderCandidate | undefined;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (!line) continue;
		try {
			const parsed = JSON.parse(line) as unknown;
			if (Value.Check(SessionHeaderCandidateSchema, parsed)) {
				headerIndex = index;
				header = parsed;
				break;
			}
		} catch {
			// Pi also skips malformed physical lines while reading sessions.
		}
	}

	if (!header || headerIndex < 0) {
		return { status: "invalid", error: "session header not found" };
	}
	if (header.version !== 3) {
		return {
			status: "invalid",
			error: `unsupported session version: ${String(header.version)}`,
		};
	}
	if (typeof header.cwd !== "string" || header.cwd.length === 0) {
		return { status: "invalid", error: "session header cwd is missing" };
	}
	if (resolve(header.cwd) !== resolve(oldCwd)) {
		return { status: "unrelated" };
	}

	lines[headerIndex] = JSON.stringify({ ...header, cwd: resolve(newCwd) });
	return { status: "rewritten", content: lines.join("\n") };
}

// Migrate inactive sessions as a copy-first operation. The source remains usable
// until the rewritten destination is complete and confirmed.
export async function migrateSessionFiles(options: {
	oldCwd: string;
	newCwd: string;
	sourceDir: string;
	targetDir: string;
	activeSessionFile?: string;
	removeOriginals: boolean;
}): Promise<SessionMigrationResult> {
	const result: SessionMigrationResult = {
		matched: 0,
		migrated: 0,
		removed: 0,
		retained: 0,
		unrelated: 0,
		errors: [],
	};
	const sourceDir = resolve(options.sourceDir);
	const targetDir = resolve(options.targetDir);
	const activeSessionFile = options.activeSessionFile
		? resolve(options.activeSessionFile)
		: undefined;
	let names: string[];

	try {
		names = (await fs.readdir(sourceDir, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return result;
		throw error;
	}

	// Build every plan before writing. Reject the whole migration if the active
	// session is among the matches because Pi may append to it after this scan.
	const plans: MigrationPlan[] = [];
	for (const name of names) {
		const sourcePath = join(sourceDir, name);
		let content: string;
		try {
			content = await fs.readFile(sourcePath, "utf8");
		} catch (error) {
			result.errors.push(
				`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}

		const rewritten = rewriteSessionCwd(
			content,
			options.oldCwd,
			options.newCwd,
		);
		if (rewritten.status === "unrelated") {
			result.unrelated++;
			continue;
		}
		if (rewritten.status === "invalid" || rewritten.content === undefined) {
			result.errors.push(
				`${sourcePath}: ${rewritten.error ?? "invalid session"}`,
			);
			continue;
		}

		result.matched++;
		if (activeSessionFile === resolve(sourcePath)) {
			result.errors.push(
				`${sourcePath}: refusing to migrate the active session file`,
			);
			continue;
		}
		plans.push({
			sourcePath,
			targetPath: join(targetDir, name),
			content: rewritten.content,
		});
	}

	if (
		result.errors.some((error) =>
			error.endsWith("refusing to migrate the active session file"),
		)
	) {
		return result;
	}

	await fs.mkdir(targetDir, { recursive: true });
	for (const plan of plans) {
		try {
			if (resolve(plan.sourcePath) === resolve(plan.targetPath)) {
				await replaceFileAtomic(plan.sourcePath, plan.content);
				result.migrated++;
				continue;
			}

			const writeResult = await writeNewFileAtomic(
				plan.targetPath,
				plan.content,
			);
			if (writeResult === "exists") {
				const existing = await fs.readFile(plan.targetPath, "utf8");
				if (existing !== plan.content) {
					result.errors.push(
						`${plan.targetPath}: target already exists with different content`,
					);
					continue;
				}
			}

			result.migrated++;
			if (options.removeOriginals) {
				await fs.rm(plan.sourcePath);
				result.removed++;
			} else {
				result.retained++;
			}
		} catch (error) {
			result.errors.push(
				`${plan.sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return result;
}
