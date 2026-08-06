import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writeJsonAtomic } from "./atomic-files.ts";
import {
	DEFAULT_SETTINGS,
	parsePersistentSessionConfig,
	type PersistentSessionConfig,
	type PersistentSessionSettings,
} from "./config-schema.ts";

const CONFIG_FILE_NAME = "pi-persistent-session.json";

export function configPath(): string {
	return join(getAgentDir(), "extension-settings", CONFIG_FILE_NAME);
}

export async function loadSettings(): Promise<PersistentSessionSettings> {
	const path = configPath();
	try {
		const parsed = JSON.parse(await fs.readFile(path, "utf8")) as unknown;
		return parsePersistentSessionConfig(parsed).settings;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { ...DEFAULT_SETTINGS };
		}
		throw new Error(
			`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function saveSettings(
	settings: PersistentSessionSettings,
): Promise<void> {
	await writeJsonAtomic(configPath(), {
		version: 1,
		settings,
	} satisfies PersistentSessionConfig);
}
