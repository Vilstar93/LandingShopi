// Minimal local server for development and end-to-end checks.
//
// Serves public/ as static files and routes /api/* to the same handlers that
// Vercel runs in production, so what is tested locally is the real code.
//
// Usage: node scripts/dev-server.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3000);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

// Load .env without a dependency, for local runs only.
async function loadEnv() {
    try {
        const text = await readFile(join(ROOT, '.env'), 'utf8');
        for (const line of text.split('\n')) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
            if (!match) continue;
            const value = match[2].replace(/^["']|["']$/g, '');
            if (!(match[1] in process.env)) process.env[match[1]] = value;
        }
    } catch {
        // No .env is fine.
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

// A response object shaped like the one Vercel passes to a handler.
function makeRes(res) {
    return {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) {
            this.headers['Content-Type'] = 'application/json; charset=utf-8';
            res.writeHead(this.statusCode, this.headers);
            res.end(JSON.stringify(payload));
        },
    };
}

async function serveStatic(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('not a file');
        const body = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
}

async function handleApi(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
    if (!/^[a-z0-9_-]+$/i.test(name) || name.startsWith('_')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'NOT_FOUND' }));
        return;
    }
    try {
        const module = await import(join(ROOT, 'api', `${name}.js`));
        const body = await readBody(req);
        const fakeReq = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
            socket: req.socket,
        };
        await module.default(fakeReq, makeRes(res));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'HANDLER_ERROR', message: error.message }));
    }
}

await loadEnv();

const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) return handleApi(req, res);
    return serveStatic(req, res);
}).listen(PORT, () => {
    console.log(`dev server: http://localhost:${PORT}`);
});

// A busy port is the most likely first failure when running locally. A raw
// stack trace sends people looking for a bug in the code instead of at the
// port, so say what is wrong and how to change it.
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        console.error(`Try another one:  node scripts/dev-server.mjs ${PORT + 1}`);
        process.exit(1);
    }
    if (error.code === 'EACCES') {
        console.error(`Port ${PORT} needs administrator rights. Pick one above 1024.`);
        process.exit(1);
    }
    throw error;
});
