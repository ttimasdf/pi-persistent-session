import { promises as fs } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { GitignorePolicy } from "./config-schema.ts";

function gitignoreEntry(
	gitRoot: string,
	markerPath: string,
): { relativePath: string; pattern: string } | undefined {
	const relativePath = relative(gitRoot, markerPath);
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`)
	) {
		return undefined;
	}
	const normalized = relativePath.split(sep).join("/");
	return { relativePath: normalized, pattern: `/${normalized}` };
}

async function appendGitignorePattern(
	path: string,
	pattern: string,
): Promise<void> {
	let current = "";
	try {
		current = await fs.readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (current.split(/\r?\n/).includes(pattern)) return;
	const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
	await fs.appendFile(path, `${prefix}${pattern}\n`);
}

export async function checkGitignore(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	markerPath: string,
	policy: GitignorePolicy,
): Promise<void> {
	if (policy === "never") return;
	const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
		cwd: ctx.cwd,
		timeout: 5_000,
	});
	if (rootResult.code !== 0) return;
	const gitRoot = resolve(rootResult.stdout.trim());
	const entry = gitignoreEntry(gitRoot, markerPath);
	if (!entry) return;

	const ignored = await pi.exec(
		"git",
		["check-ignore", "--no-index", "-q", "--", entry.relativePath],
		{ cwd: gitRoot, timeout: 5_000 },
	);
	if (ignored.code === 0) return;

	let shouldAdd = policy === "auto";
	if (policy === "prompt" && ctx.hasUI) {
		shouldAdd = await ctx.ui.confirm(
			"Ignore workspace identity?",
			`Add ${entry.pattern} to ${join(gitRoot, ".gitignore")}?`,
		);
	}
	if (!shouldAdd) {
		ctx.ui.notify(
			`Recommended: add ${entry.pattern} to ${join(gitRoot, ".gitignore")}`,
			"warning",
		);
		return;
	}

	await appendGitignorePattern(join(gitRoot, ".gitignore"), entry.pattern);
	const tracked = await pi.exec(
		"git",
		["ls-files", "--error-unmatch", "--", entry.relativePath],
		{ cwd: gitRoot, timeout: 5_000 },
	);
	if (tracked.code === 0) {
		ctx.ui.notify(
			`${entry.relativePath} is already tracked; remove it from the Git index if it should remain local`,
			"warning",
		);
	}
}
