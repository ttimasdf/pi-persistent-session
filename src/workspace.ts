import { promises as fs, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { writeJsonAtomic } from "./atomic-files.ts";
import {
	parseWorkspaceIdentity,
	type WorkspaceIdentity,
} from "./config-schema.ts";

export { parseWorkspaceIdentity, type WorkspaceIdentity } from "./config-schema.ts";

const WORKSPACE_FILE_NAME = "persistent-session.json";

/** Match Pi's default absolute-cwd session directory mapping. */
export function defaultSessionDirForCwd(
	cwd: string,
	agentDir: string = getAgentDir(),
): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(agentDir), "sessions", safePath);
}

export function sessionNamespaceIdForCwd(
	cwd: string,
	agentDir: string = getAgentDir(),
): string {
	return basename(defaultSessionDirForCwd(cwd, agentDir));
}

export function relocationDirectories(
	identity: WorkspaceIdentity,
	currentCwd: string,
	currentSessionDir: string,
	agentDir: string = getAgentDir(),
): { sourceDir: string; targetDir: string } {
	const targetDir = resolve(currentSessionDir);
	const currentDefault = defaultSessionDirForCwd(currentCwd, agentDir);
	const sourceDir =
		targetDir === resolve(currentDefault)
			? join(resolve(agentDir), "sessions", identity.sessionNamespaceId)
			: targetDir;
	return { sourceDir: resolve(sourceDir), targetDir };
}

export function projectWorkspacePath(cwd: string): string {
	return join(resolve(cwd), CONFIG_DIR_NAME, WORKSPACE_FILE_NAME);
}

export function workspacePath(cwd: string): string {
	const gitDir = join(resolve(cwd), ".git");
	try {
		if (statSync(gitDir).isDirectory()) {
			return join(gitDir, WORKSPACE_FILE_NAME);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return projectWorkspacePath(cwd);
}

export async function loadWorkspaceIdentity(
	path: string,
): Promise<WorkspaceIdentity | undefined> {
	try {
		return parseWorkspaceIdentity(
			JSON.parse(await fs.readFile(path, "utf8")) as unknown,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error(
			`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function identityForCwd(cwd: string): WorkspaceIdentity {
	return {
		version: 1,
		sessionNamespaceId: sessionNamespaceIdForCwd(cwd),
		observedCwd: resolve(cwd),
	};
}

export async function createWorkspaceIdentity(
	path: string,
	cwd: string,
): Promise<WorkspaceIdentity> {
	const identity = identityForCwd(cwd);
	await fs.mkdir(dirname(path), { recursive: true });
	try {
		await fs.writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, {
			flag: "wx",
		});
		return identity;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await loadWorkspaceIdentity(path);
		if (!existing) {
			throw new Error(`Workspace identity disappeared while creating ${path}`);
		}
		return existing;
	}
}

export async function saveWorkspaceIdentity(
	path: string,
	cwd: string,
): Promise<void> {
	await writeJsonAtomic(path, identityForCwd(cwd));
}
