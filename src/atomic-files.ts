import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export async function writeJsonAtomic(
	path: string,
	value: unknown,
): Promise<void> {
	await fs.mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
		});
		await fs.rename(temporaryPath, path);
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}

// Create a destination without overwriting a file another process may have
// created. A hard link gives this operation create-if-absent semantics after the
// complete temporary file has been written.
export async function writeNewFileAtomic(
	path: string,
	content: string,
): Promise<"created" | "exists"> {
	await fs.mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, content, { flag: "wx" });
		try {
			await fs.link(temporaryPath, path);
			return "created";
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
			throw error;
		}
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}

export async function replaceFileAtomic(
	path: string,
	content: string,
): Promise<void> {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, content, { flag: "wx" });
		await fs.rename(temporaryPath, path);
	} finally {
		await fs.rm(temporaryPath, { force: true });
	}
}
