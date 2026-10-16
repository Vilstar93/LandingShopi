import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPartnerUrl, safePartnerUrl, isPartnerConfigured, SUBID_PARAMS } from '../lib/affiliate.js';

const OPERATOR_LINK = 'https://shopify.pxf.io/7950557-link?sharedid=7950557';
const CLICK = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Regression: the reference implementation uses searchParams.set, which
// overwrites the operator's sharedid. This module must not.
test('the operator sharedid survives when the click id is appended', () => {
    const url = new URL(buildPartnerUrl(OPERATOR_LINK, CLICK));
    assert.equal(url.searchParams.get('sharedid'), '7950557');
    assert.equal(url.searchParams.get('subId1'), CLICK);
});

test('appending never overwrites an existing subId1', () => {
    const existing = 'https://shopify.pxf.io/7950557-link?sharedid=7950557&subId1=first';
    const url = new URL(buildPartnerUrl(existing, 'second'));
    assert.deepEqual(url.searchParams.getAll('subId1'), ['first', 'second']);
    assert.equal(url.searchParams.get('sharedid'), '7950557');
});

test('the path segment is never mistaken for a parameter', () => {
    // "7950557" appears in the path too, so a substring check would be wrong.
    const url = new URL(buildPartnerUrl(OPERATOR_LINK, CLICK));
    assert.equal(url.pathname, '/7950557-link');
});

test('no click id leaves the configured link untouched', () => {
    assert.equal(buildPartnerUrl(OPERATOR_LINK, ''), OPERATOR_LINK);
    assert.equal(buildPartnerUrl(OPERATOR_LINK, null), OPERATOR_LINK);
});

test('an alternate sub-ID parameter can be selected', () => {
    const url = new URL(buildPartnerUrl(OPERATOR_LINK, CLICK, { param: 'subId2' }));
    assert.equal(url.searchParams.get('subId2'), CLICK);
    assert.equal(url.searchParams.get('sharedid'), '7950557');
});

test('a malformed parameter name falls back to the untouched link', () => {
    const result = buildPartnerUrl(OPERATOR_LINK, CLICK, { param: 'bad param;drop' });
    assert.equal(result, OPERATOR_LINK);
});

test('safePartnerUrl accepts only clean https URLs', () => {
    assert.equal(safePartnerUrl('https://shopify.pxf.io/abc'), 'https://shopify.pxf.io/abc');
    for (const bad of ['http://insecure.example', 'javascript:alert(1)', 'not a url', '', null,
        'https://ok.example/?a=1\nX-Injected: yes']) {
        assert.equal(safePartnerUrl(bad), null, `${bad} should be rejected`);
    }
});

test('a misconfigured partner link yields null, never a redirect target', () => {
    assert.equal(buildPartnerUrl('javascript:alert(1)', CLICK), null);
    assert.equal(buildPartnerUrl('', CLICK), null);
});

test('isPartnerConfigured gates the public surface', () => {
    assert.equal(isPartnerConfigured(OPERATOR_LINK), true);
    assert.equal(isPartnerConfigured(''), false);
    assert.equal(isPartnerConfigured('http://insecure.example'), false);
});

test('the default sub-ID parameter is subId1', () => {
    assert.equal(SUBID_PARAMS[0], 'subId1');
});
