import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordRequest, readRequests, logFile } from '../lib/store.js';
import { persist, forward } from '../api/submit.js';

const sample = {
    legalName: 'Тестова Фирма ЕООД',
    eik: '104532902',
    contactName: 'Иван Иванов',
    email: 'ivan@example.bg',
    niche: 'Играчки',
    receivedAt: new Date().toISOString(),
};

function tempDir() {
    return mkdtempSync(join(tmpdir(), 'ls-store-'));
}

test('a request is written and read back', () => {
    const dir = tempDir();
    try {
        const result = recordRequest(sample, 'ls_test1', { dir });
        assert.equal(result.stored, true);

        const back = readRequests({ file: join(dir, 'requests.jsonl') });
        assert.equal(back.length, 1);
        assert.equal(back[0].legalName, sample.legalName);
        assert.equal(back[0].clickId, 'ls_test1');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('requests accumulate rather than overwrite', () => {
    const dir = tempDir();
    try {
        recordRequest(sample, 'ls_a', { dir });
        recordRequest({ ...sample, legalName: 'Втора Фирма ЕООД' }, 'ls_b', { dir });

        const back = readRequests({ file: join(dir, 'requests.jsonl') });
        assert.equal(back.length, 2);
        assert.equal(back[0].clickId, 'ls_a');
        assert.equal(back[1].legalName, 'Втора Фирма ЕООД');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a malformed line does not destroy the readable ones', () => {
    const dir = tempDir();
    try {
        recordRequest(sample, 'ls_ok', { dir });
        writeFileSync(join(dir, 'requests.jsonl'), `${JSON.stringify({ ...sample, clickId: 'ls_ok' })}\n{not json\n`, 'utf8');

        const back = readRequests({ file: join(dir, 'requests.jsonl') });
        assert.equal(back.length, 1);
        assert.equal(back[0].clickId, 'ls_ok');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('reading a log that does not exist returns an empty list', () => {
    const dir = tempDir();
    try {
        assert.deepEqual(readRequests({ file: join(dir, 'requests.jsonl') }), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a failing write is reported, not thrown', () => {
    // A path under a regular file cannot be created.
    const dir = tempDir();
    try {
        const blocker = join(dir, 'blocker');
        writeFileSync(blocker, 'x', 'utf8');
        const result = recordRequest(sample, 'ls_x', { dir: join(blocker, 'nested') });
        assert.equal(result.stored, false);
        assert.ok(result.reason);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('persist records locally and reports a missing webhook', async () => {
    const dir = tempDir();
    const saved = process.env.REQUEST_WEBHOOK_URL;
    delete process.env.REQUEST_WEBHOOK_URL;
    try {
        const result = await persist(sample, 'ls_p', { dir });
        assert.equal(result.stored.stored, true);
        assert.equal(result.forwarded.forwarded, false);
        assert.equal(result.forwarded.reason, 'NOT_CONFIGURED');
    } finally {
        if (saved !== undefined) process.env.REQUEST_WEBHOOK_URL = saved;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a request survives a failed webhook', async () => {
    const dir = tempDir();
    const saved = process.env.REQUEST_WEBHOOK_URL;
    process.env.REQUEST_WEBHOOK_URL = 'https://intake.example/hook';
    try {
        const result = await persist(sample, 'ls_f', {
            dir,
            fetchImpl: async () => { throw new Error('network down'); },
        });
        // The webhook failed, but the request is still recorded.
        assert.equal(result.forwarded.forwarded, false);
        assert.equal(result.forwarded.reason, 'NETWORK');
        assert.equal(result.stored.stored, true);
        assert.equal(readRequests({ file: join(dir, 'requests.jsonl') }).length, 1);
    } finally {
        if (saved === undefined) delete process.env.REQUEST_WEBHOOK_URL;
        else process.env.REQUEST_WEBHOOK_URL = saved;
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a non-ok webhook response is reported as a failure', async () => {
    const saved = process.env.REQUEST_WEBHOOK_URL;
    process.env.REQUEST_WEBHOOK_URL = 'https://intake.example/hook';
    try {
        const result = await forward(sample, 'ls_h', {
            fetchImpl: async () => ({ ok: false, status: 500 }),
        });
        assert.equal(result.forwarded, false);
        assert.equal(result.reason, 'HTTP 500');
    } finally {
        if (saved === undefined) delete process.env.REQUEST_WEBHOOK_URL;
        else process.env.REQUEST_WEBHOOK_URL = saved;
    }
});

test('the default log file lives under the repository data directory', () => {
    const saved = process.env.REQUEST_LOG_DIR;
    delete process.env.REQUEST_LOG_DIR;
    try {
        assert.match(logFile(), /data[\\/]requests\.jsonl$/);
    } finally {
        if (saved !== undefined) process.env.REQUEST_LOG_DIR = saved;
    }
});
