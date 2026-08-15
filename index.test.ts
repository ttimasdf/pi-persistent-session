import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
	migrateSessionFiles,
	rewriteSessionCwd,
} from "./src/session-migration.ts";
import {
	DEFAULT_SETTINGS,
	parsePersistentSessionConfig,
} from "./src/config-schema.ts";
import {
	defaultSessionDirForCwd,
	parseWorkspaceIdentity,
	projectWorkspacePath,
	relocationDirectories,
	sessionNamespaceIdForCwd,
	workspacePath,
} from "./src/workspace.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("configuration fills omitted settings with defaults", () => {
	assert.deepEqual(
		parsePersistentSessionConfig({ version: 1, settings: {} }).settings,
		DEFAULT_SETTINGS,
	);
});

test("configuration rejects unknown policy values", () => {
	assert.throws(() =>
		parsePersistentSessionConfig({
			version: 1,
			settings: { relocationPolicy: "delete-everything" },
		}),
	);
});

test("workspace identity requires a safe session namespace ID", () => {
	assert.throws(() =>
		parseWorkspaceIdentity({
			version: 1,
			workspaceId: "invalid-workspace-id",
			observedCwd: "/tmp/project",
		}),
	);
	assert.throws(() =>
		parseWorkspaceIdentity({
			version: 1,
			sessionNamespaceId: "../other-project",
			observedCwd: "/tmp/project",
		}),
	);
});

test("workspace marker uses .pi without Git and .git with precedence", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-persistent-session-path-"));
	cleanupPaths.push(root);

	assert.equal(workspacePath(root), projectWorkspacePath(root));
	await writeFile(join(root, ".git"), "gitdir: /tmp/worktree\n");
	assert.equal(workspacePath(root), projectWorkspacePath(root));
	await rm(join(root, ".git"));
	await mkdir(join(root, ".git"));
	assert.equal(
		workspacePath(root),
		join(root, ".git", "persistent-session.json"),
	);
});

test("Git marker takes precedence without modifying the .pi marker", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-persistent-session-precedence-"));
	cleanupPaths.push(root);
	await mkdir(join(root, ".git"));
	await mkdir(join(root, ".pi"));
	const projectPath = projectWorkspacePath(root);
	const gitPath = workspacePath(root);
	const projectContent = `${JSON.stringify({
		version: 1,
		sessionNamespaceId: "--project--",
		observedCwd: "/project",
	})}\n`;
	const gitContent = `${JSON.stringify({
		version: 1,
		sessionNamespaceId: "--git--",
		observedCwd: "/git",
	})}\n`;
	await writeFile(projectPath, projectContent);
	await writeFile(gitPath, gitContent);

	assert.equal(await readFile(workspacePath(root), "utf8"), gitContent);
	assert.equal(await readFile(projectPath, "utf8"), projectContent);
});

test("default session directory and namespace match Pi's encoded-cwd shape", () => {
	assert.equal(
		defaultSessionDirForCwd("/work/example", "/agent"),
		join("/agent", "sessions", "--work-example--"),
	);
	assert.equal(
		sessionNamespaceIdForCwd("/work/example", "/agent"),
		"--work-example--",
	);
});

test("default relocation reconstructs the source under the current agent directory", () => {
	assert.deepEqual(
		relocationDirectories(
			{
				version: 1,
				sessionNamespaceId: "--old-machine-project--",
				observedCwd: "/old-machine/project",
			},
			"/new-machine/project",
			join("/new-agent", "sessions", "--new-machine-project--"),
			"/new-agent",
		),
		{
			sourceDir: join(
				"/new-agent",
				"sessions",
				"--old-machine-project--",
			),
			targetDir: join(
				"/new-agent",
				"sessions",
				"--new-machine-project--",
			),
		},
	);
});

test("custom session directories are rewritten in place", () => {
	assert.deepEqual(
		relocationDirectories(
			{
				version: 1,
				sessionNamespaceId: "--old-project--",
				observedCwd: "/old/project",
			},
			"/new/project",
			"/custom/sessions",
			"/agent",
		),
		{
			sourceDir: "/custom/sessions",
			targetDir: "/custom/sessions",
		},
	);
});

test("session rewrite updates a v3 header and preserves the remaining lines", () => {
	const input = [
		"",
		"not-json",
		JSON.stringify({
			type: "session",
			version: 3,
			id: "id",
			timestamp: "now",
			cwd: "/old/project",
		}),
		JSON.stringify({
			type: "message",
			id: "a",
			parentId: null,
			message: { role: "user", content: "hello" },
		}),
		"",
	].join("\n");
	const result = rewriteSessionCwd(input, "/old/project", "/new/project");

	assert.equal(result.status, "rewritten");
	assert.ok(result.content?.includes('"cwd":"/new/project"'));
	assert.ok(result.content?.includes('"type":"message"'));
	assert.ok(result.content?.endsWith("\n"));
});

test("session rewrite skips unrelated cwd and rejects non-v3 sessions", () => {
	const unrelated = rewriteSessionCwd(
		JSON.stringify({ type: "session", version: 3, id: "id", cwd: "/other" }),
		"/old",
		"/new",
	);
	assert.equal(unrelated.status, "unrelated");

	const oldVersion = rewriteSessionCwd(
		JSON.stringify({ type: "session", version: 2, id: "id", cwd: "/old" }),
		"/old",
		"/new",
	);
	assert.equal(oldVersion.status, "invalid");
});

test("migration copies matching sessions, rewrites cwd, and retains sources by default", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-persistent-session-"));
	cleanupPaths.push(root);
	const sourceDir = join(root, "source");
	const targetDir = join(root, "target");
	await mkdir(sourceDir);
	const sessionName = "session.jsonl";
	const sourceContent = `${JSON.stringify({ type: "session", version: 3, id: "id", cwd: "/old" })}\n`;
	await writeFile(join(sourceDir, sessionName), sourceContent);
	await writeFile(
		join(sourceDir, "unrelated.jsonl"),
		`${JSON.stringify({ type: "session", version: 3, id: "other", cwd: "/other" })}\n`,
	);

	const result = await migrateSessionFiles({
		oldCwd: "/old",
		newCwd: "/new",
		sourceDir,
		targetDir,
		removeOriginals: false,
	});

	assert.deepEqual(result, {
		matched: 1,
		migrated: 1,
		removed: 0,
		retained: 1,
		unrelated: 1,
		errors: [],
	});
	assert.ok(
		(await readFile(join(targetDir, sessionName), "utf8")).includes(
			'"cwd":"/new"',
		),
	);
	assert.equal(
		await readFile(join(sourceDir, sessionName), "utf8"),
		sourceContent,
	);
});

test("migration removes a source only after its target is complete", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-persistent-session-remove-"));
	cleanupPaths.push(root);
	const sourceDir = join(root, "source");
	const targetDir = join(root, "target");
	await mkdir(sourceDir);
	const sourcePath = join(sourceDir, "session.jsonl");
	await writeFile(
		sourcePath,
		`${JSON.stringify({ type: "session", version: 3, id: "id", cwd: "/old" })}\n`,
	);

	const result = await migrateSessionFiles({
		oldCwd: "/old",
		newCwd: "/new",
		sourceDir,
		targetDir,
		removeOriginals: true,
	});

	assert.equal(result.removed, 1);
	await assert.rejects(readFile(sourcePath, "utf8"), { code: "ENOENT" });
	assert.ok(
		(await readFile(join(targetDir, "session.jsonl"), "utf8")).includes(
			'"cwd":"/new"',
		),
	);
});

test("migration refuses to touch the active source session", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-persistent-session-active-"));
	cleanupPaths.push(root);
	const sourceDir = join(root, "source");
	const targetDir = join(root, "target");
	await mkdir(sourceDir);
	const activeSessionFile = join(sourceDir, "active.jsonl");
	await writeFile(
		activeSessionFile,
		`${JSON.stringify({ type: "session", version: 3, id: "id", cwd: "/old" })}\n`,
	);

	const result = await migrateSessionFiles({
		oldCwd: "/old",
		newCwd: "/new",
		sourceDir,
		targetDir,
		activeSessionFile,
		removeOriginals: false,
	});

	assert.equal(result.migrated, 0);
	assert.equal(result.errors.length, 1);
	await assert.rejects(readFile(join(targetDir, "active.jsonl"), "utf8"), {
		code: "ENOENT",
	});
});
