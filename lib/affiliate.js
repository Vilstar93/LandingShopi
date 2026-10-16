// Affiliate link building for the Shopify affiliate program (Impact.com).
//
// The operator's link is:
//   https://shopify.pxf.io/7950557-link?sharedid=7950557
//
// `pxf.io` is the Impact.com network; `sharedid` is Impact's cross-visible
// parameter. It must survive untouched.
//
// The reference implementation in VZGplattform builds the outbound URL with
// `searchParams.set(subIdParam, clickId)`. `set` REPLACES an existing value, so
// configuring subIdParam as "sharedid" would overwrite the operator's own
// identifier. Verified by direct reproduction.
//
// This module therefore appends the click id to a SEPARATE parameter and never
// touches existing query values.

/** Impact's partner-only tracking parameters, in preference order. */
export const SUBID_PARAMS = ['subId1', 'subId2', 'subId3'];

/**
 * Reject anything that is not a clean https URL. A misconfigured environment
 * variable must not become a redirect target.
 *
 * Control characters are rejected explicitly rather than left to the URL
 * parser: `new URL()` silently strips newlines, so a value like
 * "https://ok.example/?a=1\nX-Injected: yes" would parse into a "valid" URL
 * instead of being refused. The intent here is that only clean values pass.
 */
export function safePartnerUrl(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

/**
 * Append a click id to a partner URL without altering any existing parameter.
 *
 * @param {string} deeplink The configured partner URL.
 * @param {string} clickId Opaque id used to reconcile the click with a payout.
 * @param {{ param?: string }} [options] Which sub-ID parameter to use.
 * @returns {string} The partner URL with the click id appended, or the original
 *   URL unchanged when no parameter is configured or the id is empty.
 */
export function buildPartnerUrl(deeplink, clickId, options = {}) {
    const base = safePartnerUrl(deeplink);
    if (!base) return null;

    const param = options.param ?? SUBID_PARAMS[0];
    const id = String(clickId ?? '').trim();
    if (!param || !id) return base;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(param)) return base;

    const url = new URL(base);
    // append, never set: an existing subId1 is preserved alongside.
    url.searchParams.append(param, id);
    return url.toString();
}

/**
 * Whether a partner link is usable at all. A product is only offered publicly
 * when a real https deeplink is configured; policy alone is not enough.
 */
export function isPartnerConfigured(deeplink) {
    return safePartnerUrl(deeplink) !== null;
}
