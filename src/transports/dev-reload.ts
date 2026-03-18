import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WATCH_EXTENSIONS = new Set([".ts", ".js", ".mts", ".mjs"]);
const IGNORE_DIRS = new Set(["node_modules", "dist", ".git"]);
const DEBOUNCE_MS = 300;

/**
 * Check if a file path should trigger a reload.
 */
export function shouldReload(filename: string): boolean {
	// Check ignored directories
	const parts = filename.split("/");
	for (const part of parts) {
		if (IGNORE_DIRS.has(part) || part.startsWith(".")) {
			// Allow the root "." but not hidden dirs
			if (part !== ".") return false;
		}
	}

	// Check extension
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex === -1) return false;
	return WATCH_EXTENSIONS.has(filename.slice(dotIndex));
}

/**
 * Invalidate a module from the import cache so it can be re-imported fresh.
 * For ESM (used by this project), we append a cache-busting query param.
 */
export function cacheBustingUrl(filePath: string): string {
	const url = pathToFileURL(resolve(filePath));
	url.searchParams.set("t", String(Date.now()));
	return url.href;
}

export interface DevReloadOptions {
	/** Directory to watch for file changes. */
	dir: string;
	/** Called when relevant files change. */
	onChange: (changedFiles: string[]) => Promise<void>;
	/** Logger for reload messages. */
	logger: { info: (msg: string) => void };
}

export interface DevReloadHandle {
	/** Stop watching for file changes. */
	close(): void;
}

/**
 * Watch a directory for source file changes and call onChange when they occur.
 * Uses debouncing to batch rapid changes.
 */
export function watchForChanges(options: DevReloadOptions): DevReloadHandle {
	const { dir, onChange, logger } = options;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingFiles = new Set<string>();
	let reloading = false;

	const watcher: FSWatcher = watch(
		dir,
		{ recursive: true },
		(_event, filename) => {
			if (!filename || !shouldReload(filename)) return;

			pendingFiles.add(filename);

			if (debounceTimer) clearTimeout(debounceTimer);

			debounceTimer = setTimeout(async () => {
				if (reloading) return;
				reloading = true;

				const files = [...pendingFiles];
				pendingFiles = new Set();

				logger.info(`File change detected: ${files.join(", ")}. Reloading...`);

				try {
					await onChange(files);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					logger.info(`Reload failed: ${msg}`);
				} finally {
					reloading = false;
				}
			}, DEBOUNCE_MS);
		},
	);

	return {
		close() {
			if (debounceTimer) clearTimeout(debounceTimer);
			watcher.close();
		},
	};
}
