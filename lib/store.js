// Local record of submitted requests.
//
// Scope: this is a development and single-server store. It appends one JSON
// object per line to data/requests.jsonl so nothing is lost while the portal is
// being tested on a plain server.
//
// IMPORTANT — this does NOT work on Vercel. Serverless filesystems are
// read-only apart from /tmp, and /tmp is per-invocation and discarded, so a
// write would appear to succeed and the data would vanish. For a deployed
// portal, set REQUEST_WEBHOOK_URL to a real intake endpoint (a form service, a
// database, a spreadsheet webhook). Both paths run, so a local file and a
// webhook can be used at the same time.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));

/** The directory requests are written to. Overridable for tests. */
export function logDir() {
    return process.env.REQUEST_LOG_DIR || DEFAULT_DIR;
}

/** The file requests are written to. */
export function logFile() {
    return join(logDir(), 'requests.jsonl');
}

/**
 * Append one request to the log.
 *
 * Never throws: losing the log must not fail a request the visitor already
 * made. The caller decides what to tell the visitor.
 *
 * @returns {{stored: boolean, reason?: string}}
 */
export function recordRequest(data, clickId, options = {}) {
    const dir = options.dir ?? logDir();
    const file = options.file ?? join(dir, 'requests.jsonl');
    try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(file, `${JSON.stringify({ ...data, clickId })}\n`, 'utf8');
        return { stored: true };
    } catch (error) {
        return { stored: false, reason: error.code || 'ERROR' };
    }
}

/** Read back every recorded request, oldest first. Malformed lines are skipped. */
export function readRequests(options = {}) {
    const file = options.file ?? logFile();
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            } catch {
                return [];
            }
        });
}
