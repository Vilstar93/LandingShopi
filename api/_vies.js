// VIES REST client — free EU VAT validation, no API key.
//
// Endpoint: https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{CC}/vat/{number}
//
// Verified: VIES sends no Access-Control-Allow-Origin header, so a browser
// cannot call it directly. It must be called server-side (see api/verify.js).
//
// The API reports failures in two very different ways, and conflating them
// would reject legitimate companies:
//   - userError "VALID"   -> isValid true
//   - userError "INVALID" -> the number is genuinely not registered for VAT
//   - userError "MS_UNAVAILABLE" / "MS_MAX_CONCURRENT_REQ" / "GLOBAL_MAX_CONCURRENT_REQ"
//     -> the service could not answer; the result must NOT be treated as invalid
//
// Verified live against BG: valid numbers return the registered company name
// and address. The concurrent-request error was observed in practice.

const VIES_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api';

/** Errors that mean "the service could not answer", not "the number is bad". */
const TRANSIENT_ERRORS = new Set([
    'MS_UNAVAILABLE',
    'MS_MAX_CONCURRENT_REQ',
    'GLOBAL_MAX_CONCURRENT_REQ',
    'TIMEOUT',
    'SERVICE_UNAVAILABLE',
]);

// VIES returns "---" for fields it cannot disclose.
function clean(value) {
    const text = String(value ?? '').trim();
    return text === '---' ? '' : text;
}

/**
 * Validate a VAT number against VIES.
 *
 * @param {string} countryCode Two-letter member state, e.g. "BG".
 * @param {string} vatNumber Number without the country prefix.
 * @returns {Promise<
 *   | { status: 'valid', name: string, address: string, requestDate: string }
 *   | { status: 'invalid', requestDate: string }
 *   | { status: 'unavailable', reason: string }
 * >}
 * Never throws: a network failure becomes `unavailable`, so the caller can
 * decide to retry rather than reject a real customer.
 */
export async function validateVat(countryCode, vatNumber, options = {}) {
    const { timeoutMs = 10_000, fetchImpl = fetch } = options;
    const cc = String(countryCode ?? '').trim().toUpperCase();
    const number = String(vatNumber ?? '').trim().replace(/\s+/g, '').replace(/^[A-Za-z]{2}/, '');

    if (!/^[A-Z]{2}$/.test(cc) || !/^\d{8,14}$/.test(number)) {
        return { status: 'invalid', requestDate: new Date().toISOString() };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${VIES_BASE}/ms/${cc}/vat/${number}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            return { status: 'unavailable', reason: `HTTP ${response.status}` };
        }
        const data = await response.json();
        const userError = data.userError ?? '';
        const requestDate = data.requestDate ?? new Date().toISOString();

        if (TRANSIENT_ERRORS.has(userError)) {
            return { status: 'unavailable', reason: userError };
        }
        if (data.isValid === true && userError === 'VALID') {
            return { status: 'valid', name: clean(data.name), address: clean(data.address), requestDate };
        }
        return { status: 'invalid', requestDate };
    } catch (error) {
        const reason = error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
        return { status: 'unavailable', reason };
    } finally {
        clearTimeout(timer);
    }
}

/** Check whether a member state is currently answering. */
export async function viesStatus(options = {}) {
    const { timeoutMs = 10_000, fetchImpl = fetch } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${VIES_BASE}/check-status`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return { available: false, countries: {} };
        const data = await response.json();
        const countries = {};
        for (const entry of data.countries ?? []) {
            countries[entry.countryCode] = entry.availability === 'Available';
        }
        return { available: data.vow?.available === true, countries };
    } catch {
        return { available: false, countries: {} };
    } finally {
        clearTimeout(timer);
    }
}
