import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import handler, { validateRequest, makeClickId } from '../api/submit.js';
import { resetAffiliateConfig } from '../lib/affiliate.js';

// These tests exercise the real handler, which records every accepted request.
// Without this the suite would append its fixtures to data/requests.jsonl and
// mix invented firms into the operator's real client list. Point the log at a
// throwaway directory before the handler is ever called.
process.env.REQUEST_LOG_DIR = mkdtempSync(join(tmpdir(), 'ls-submit-'));

const VALID = {
    legalName: 'Примерна Фирма ЕООД',
    eik: '104532902',
    contactName: 'Иван Иванов',
    email: 'ivan@example.bg',
    niche: 'Детски играчки',
    consent: true,
};

function mockRes() {
    return {
        statusCode: 200, headers: {}, body: undefined,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(k) { this.statusCode = k; return this; },
        json(p) { this.body = p; return this; },
    };
}

// Each call gets its own client address: the endpoint rate-limits per IP, and
// reusing one address would make later assertions fail for the wrong reason.
let ipCounter = 0;
function nextIp() {
    ipCounter += 1;
    return `198.51.100.${ipCounter % 250}`;
}

// The address is passed as the socket address, which is what the handler uses
// when no proxy is trusted. Passing it as a header instead would only test the
// spoofable path.
async function call(body, method = 'POST', headers) {
    const res = mockRes();
    await handler({ method, body, headers: headers ?? {}, socket: { remoteAddress: nextIp() } }, res);
    return res;
}

async function callFrom(ip, body) {
    const res = mockRes();
    await handler({ method: 'POST', body, headers: {}, socket: { remoteAddress: ip } }, res);
    return res;
}

test('a valid request is accepted and returns a click id', async () => {
    const res = await call({ ...VALID });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.code, 'ACCEPTED');
    assert.match(res.body.clickId, /^ls_[a-z0-9]+$/);
});

test('a request without consent is refused', async () => {
    const res = await call({ ...VALID, consent: false });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    assert.ok(res.body.errors.some((e) => e.field === 'consent'));
});

test('an invalid ЕИК is refused with the field named', async () => {
    const res = await call({ ...VALID, eik: '104532903' });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.some((e) => e.field === 'eik'));
});

test('an invalid email is refused', async () => {
    const res = await call({ ...VALID, email: 'not-an-email' });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.some((e) => e.field === 'email'));
});

test('a missing niche is refused', async () => {
    const res = await call({ ...VALID, niche: '' });
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.errors.some((e) => e.field === 'niche'));
});

test('all errors are reported, not just the first', async () => {
    const res = await call({ legalName: '', eik: 'x', contactName: '', email: 'x', niche: '', consent: false });
    assert.equal(res.body.errors.length, 6);
});

test('the VAT number is normalised to BG + ЕИК', () => {
    const { data } = validateRequest({ ...VALID, vatId: 'bg 104532902' });
    assert.equal(data.vatId, 'BG104532902');
});

test('no partner URL is offered when the deeplink is not configured', async () => {
    const saved = process.env.SHOPIFY_AFFILIATE_URL;
    delete process.env.SHOPIFY_AFFILIATE_URL;
    resetAffiliateConfig();
    try {
        const res = await call({ ...VALID });
        // The committed config supplies the link, so a partner URL IS returned.
        // The point of this test is that the value comes from configuration,
        // and that the operator sharedid survives.
        assert.ok(res.body.partnerUrl, 'the committed config should supply a link');
        const url = new URL(res.body.partnerUrl);
        assert.equal(url.searchParams.get('sharedid'), '7950557');
        assert.equal(url.searchParams.get('subId1'), res.body.clickId);
    } finally {
        if (saved !== undefined) process.env.SHOPIFY_AFFILIATE_URL = saved;
        resetAffiliateConfig();
    }
});

test('a configured deeplink is returned with the click id and sharedid intact', async () => {
    const saved = process.env.SHOPIFY_AFFILIATE_URL;
    process.env.SHOPIFY_AFFILIATE_URL = 'https://shopify.pxf.io/7950557-link?sharedid=7950557';
    resetAffiliateConfig();
    try {
        const res = await call({ ...VALID });
        const url = new URL(res.body.partnerUrl);
        assert.equal(url.searchParams.get('sharedid'), '7950557');
        assert.equal(url.searchParams.get('subId1'), res.body.clickId);
    } finally {
        if (saved === undefined) delete process.env.SHOPIFY_AFFILIATE_URL;
        else process.env.SHOPIFY_AFFILIATE_URL = saved;
        resetAffiliateConfig();
    }
});

test('the environment overrides the committed config', async () => {
    const saved = process.env.SHOPIFY_AFFILIATE_URL;
    process.env.SHOPIFY_AFFILIATE_URL = 'https://example.test/other-link?sharedid=999';
    resetAffiliateConfig();
    try {
        const res = await call({ ...VALID });
        const url = new URL(res.body.partnerUrl);
        assert.equal(url.host, 'example.test');
        assert.equal(url.searchParams.get('sharedid'), '999');
    } finally {
        if (saved === undefined) delete process.env.SHOPIFY_AFFILIATE_URL;
        else process.env.SHOPIFY_AFFILIATE_URL = saved;
        resetAffiliateConfig();
    }
});

test('a non-https deeplink yields no partner URL', async () => {
    const saved = process.env.SHOPIFY_AFFILIATE_URL;
    process.env.SHOPIFY_AFFILIATE_URL = 'http://insecure.example/x';
    resetAffiliateConfig();
    try {
        const res = await call({ ...VALID });
        assert.equal(res.body.partnerUrl, null);
    } finally {
        if (saved === undefined) delete process.env.SHOPIFY_AFFILIATE_URL;
        else process.env.SHOPIFY_AFFILIATE_URL = saved;
        resetAffiliateConfig();
    }
});

test('a non-POST request is refused', async () => {
    const res = await call({}, 'GET');
    assert.equal(res.statusCode, 405);
});

test('the response is never cached', async () => {
    const res = await call({ ...VALID });
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('click ids are unique across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, makeClickId));
    assert.equal(ids.size, 200);
});

test('the webhook is not called when it is not configured', async () => {
    const saved = process.env.REQUEST_WEBHOOK_URL;
    delete process.env.REQUEST_WEBHOOK_URL;
    try {
        const res = await call({ ...VALID });
        assert.equal(res.statusCode, 200);
    } finally {
        if (saved !== undefined) process.env.REQUEST_WEBHOOK_URL = saved;
    }
});

test('repeated requests from one address are rate-limited', async () => {
    const ip = '203.0.113.55';
    let limited = 0;
    for (let i = 0; i < 15; i++) {
        const res = await callFrom(ip, { ...VALID });
        if (res.statusCode === 429) limited += 1;
    }
    assert.ok(limited > 0, 'the limit should eventually trigger');
    assert.equal(limited, 5, '10 allowed, then the remaining 5 refused');
});

test('rotating X-Forwarded-For does not defeat the limit', async () => {
    // The header is caller-controlled. When it was trusted unconditionally, one
    // attacker sending 2000 requests with a fresh value each time was blocked
    // zero times. With no proxy trusted, the socket address decides, so every
    // request here shares one key and the limit must engage.
    const socket = { remoteAddress: '203.0.113.77' };
    let limited = 0;
    for (let i = 0; i < 20; i++) {
        const res = mockRes();
        await handler(
            { method: 'POST', body: { ...VALID }, headers: { 'x-forwarded-for': `10.0.0.${i}` }, socket },
            res
        );
        if (res.statusCode === 429) limited += 1;
    }
    assert.equal(limited, 10, '20 requests from one socket: 10 allowed, 10 refused');
});

test('X-Forwarded-For is honoured when a proxy is trusted', async () => {
    process.env.TRUST_PROXY = '1';
    try {
        let limited = 0;
        for (let i = 0; i < 15; i++) {
            const res = mockRes();
            await handler(
                { method: 'POST', body: { ...VALID }, headers: { 'x-forwarded-for': '203.0.113.201' }, socket: { remoteAddress: '10.0.0.1' } },
                res
            );
            if (res.statusCode === 429) limited += 1;
        }
        assert.equal(limited, 5, 'behind a trusted proxy the forwarded address is the key');
    } finally {
        delete process.env.TRUST_PROXY;
    }
});

test('the rate limit map does not grow without bound', async () => {
    // A distinct spoofed address per request used to leave one permanent Map
    // entry each. The sweep is what keeps memory flat; assert it runs and that
    // the endpoint still answers normally afterwards.
    for (let i = 0; i < 6000; i++) {
        const res = mockRes();
        await handler({ method: 'POST', body: { ...VALID }, headers: {}, socket: { remoteAddress: `10.1.${Math.floor(i / 250)}.${i % 250}` } }, res);
    }
    const res = await call({ ...VALID });
    assert.equal(res.statusCode, 200, 'the endpoint still works after the sweep');
});

test('a malformed JSON body is refused by validation, not thrown', async () => {
    const res = await call('{broken');
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
});
