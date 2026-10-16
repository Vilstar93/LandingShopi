import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/verify.js';

// The handler is exercised with real request/response objects. VIES itself is
// reached over the network; the ЕИК rejection path is fully offline, so those
// cases are deterministic. The live VIES cases are skipped when the service is
// unreachable, so the suite does not fail for reasons outside the code.
function mockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

async function call(body, method = 'POST') {
    const res = mockRes();
    await handler({ method, body, headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} }, res);
    return res;
}

test('rejects a non-POST request', async () => {
    const res = await call({}, 'GET');
    assert.equal(res.statusCode, 405);
    assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});

test('a malformed ЕИК is rejected offline, without calling VIES', async () => {
    const res = await call({ eik: '104532903' }); // wrong check digit
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.code, 'EIK_INVALID');
    assert.equal(res.body.status, 'invalid');
});

test('an all-zero ЕИК is rejected offline', async () => {
    const res = await call({ eik: '000000000' });
    assert.equal(res.body.code, 'EIK_INVALID');
});

test('a valid ЕИК reaches VIES and returns a usable outcome', async () => {
    // 175074752 (ПРОФИ КРЕДИТ БЪЛГАРИЯ) was confirmed VALID against the live
    // service. If VIES is unreachable the handler must report "unavailable",
    // never "invalid" — so both outcomes are acceptable here, and the shape is
    // asserted either way.
    const res = await call({ eik: '175074752' });
    assert.equal(res.statusCode, 200);
    assert.ok(
        ['VAT_VALID', 'VAT_NOT_REGISTERED', 'VIES_UNAVAILABLE'].includes(res.body.code),
        `unexpected code: ${res.body.code}`,
    );
    if (res.body.code === 'VAT_VALID') {
        assert.equal(res.body.status, 'valid');
        assert.equal(res.body.vatId, 'BG175074752');
        assert.ok(typeof res.body.name === 'string');
    }
    if (res.body.code === 'VIES_UNAVAILABLE') {
        // The critical guarantee: an unreachable service is never "invalid".
        assert.equal(res.body.status, 'unavailable');
    }
});

test('a non-BG country uses the supplied VAT number', async () => {
    const res = await call({ country: 'DE', vatId: '811907980' });
    assert.equal(res.statusCode, 200);
    assert.ok(['VAT_VALID', 'VAT_NOT_REGISTERED', 'VIES_UNAVAILABLE'].includes(res.body.code));
});

test('the response is never cached', async () => {
    const res = await call({ eik: '104532903' });
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('a malformed JSON body does not throw', async () => {
    const res = await call('{not json');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.code, 'EIK_INVALID');
});
