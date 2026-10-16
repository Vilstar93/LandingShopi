import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVat, viesStatus } from '../api/_vies.js';

// fetch is injected so every response branch is exercised deterministically.
// The classification logic is the real code under test; only the transport is
// replaced. Live behaviour is verified separately against the real service.
function fakeFetch(payload, { ok = true, status = 200 } = {}) {
    return async () => ({ ok, status, json: async () => payload });
}

test('valid VAT returns name and address', async () => {
    const result = await validateVat('BG', '831642181', {
        fetchImpl: fakeFetch({
            isValid: true, userError: 'VALID',
            name: 'Виваком България - ЕАД', address: 'гр. София', requestDate: '2026-10-16T00:00:00Z',
        }),
    });
    assert.equal(result.status, 'valid');
    assert.equal(result.name, 'Виваком България - ЕАД');
});

test('INVALID means the number is genuinely not VAT-registered', async () => {
    const result = await validateVat('BG', '103899112', {
        fetchImpl: fakeFetch({ isValid: false, userError: 'INVALID', name: '---', address: '---' }),
    });
    assert.equal(result.status, 'invalid');
});

test('MS_UNAVAILABLE is NOT treated as invalid', async () => {
    const result = await validateVat('DE', '811907980', {
        fetchImpl: fakeFetch({ isValid: false, userError: 'MS_UNAVAILABLE' }),
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'MS_UNAVAILABLE');
});

test('MS_MAX_CONCURRENT_REQ is NOT treated as invalid', async () => {
    const result = await validateVat('BG', '175074752', {
        fetchImpl: fakeFetch({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' }),
    });
    assert.equal(result.status, 'unavailable');
});

test('the "---" placeholder is stripped', async () => {
    const result = await validateVat('BG', '175074752', {
        fetchImpl: fakeFetch({ isValid: true, userError: 'VALID', name: '---', address: '---' }),
    });
    assert.equal(result.status, 'valid');
    assert.equal(result.name, '');
    assert.equal(result.address, '');
});

test('a non-200 response is unavailable, not invalid', async () => {
    const result = await validateVat('BG', '175074752', {
        fetchImpl: fakeFetch({}, { ok: false, status: 503 }),
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'HTTP 503');
});

test('a network failure is unavailable, never a throw', async () => {
    const result = await validateVat('BG', '175074752', {
        fetchImpl: async () => { throw new Error('socket hang up'); },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'NETWORK');
});

test('a timeout is reported as TIMEOUT', async () => {
    const result = await validateVat('BG', '175074752', {
        fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'TIMEOUT');
});

test('a malformed number is rejected without calling the service', async () => {
    let called = false;
    const result = await validateVat('BG', 'not-a-number', {
        fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; },
    });
    assert.equal(result.status, 'invalid');
    assert.equal(called, false);
});

test('a country prefix in the number is stripped before the request', async () => {
    let seenUrl = '';
    await validateVat('BG', 'BG175074752', {
        fetchImpl: async (url) => {
            seenUrl = url;
            return { ok: true, json: async () => ({ isValid: true, userError: 'VALID', name: 'x', address: 'y' }) };
        },
    });
    assert.match(seenUrl, /\/ms\/BG\/vat\/175074752$/);
});

test('viesStatus maps country availability', async () => {
    const result = await viesStatus({
        fetchImpl: fakeFetch({
            vow: { available: true },
            countries: [{ countryCode: 'BG', availability: 'Available' }, { countryCode: 'DE', availability: 'Unavailable' }],
        }),
    });
    assert.equal(result.available, true);
    assert.equal(result.countries.BG, true);
    assert.equal(result.countries.DE, false);
});
