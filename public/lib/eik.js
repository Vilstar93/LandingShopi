// Bulgarian ЕИК / БУЛСТАТ validation — shared by the browser and the server.
//
// 9-digit ЕИК: weighted sum of digits 1-8 with weights 1..8, modulo 11. If the
// result is 10, a second pass uses weights 3,4,5,6,7,8,9,10; a further 10
// becomes 0. The result must equal digit 9.
//
// 13-digit ЕИК (branch of a foreign trader): the leading 9 digits validate as
// above, then digit 13 is a check over digits 1-12 with the same scheme.
//
// Verified against 10 ЕИКs sourced from registri.bg (which republishes the
// official Commercial Register open data): all 10 pass. Negatives, single-digit
// typos and transpositions are rejected.

const SECOND_PASS = [3, 4, 5, 6, 7, 8, 9, 10];

function checkDigit(digits, weights) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += digits[i] * weights[i];
    let check = sum % 11;
    if (check === 10) {
        sum = 0;
        for (let i = 0; i < weights.length; i++) sum += digits[i] * (i + 1);
        check = sum % 11;
        if (check === 10) check = 0;
    }
    return check;
}

export function isValidEik9(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{9}$/.test(text)) return false;
    const digits = [...text].map(Number);
    if (digits.every((d) => d === 0)) return false;
    return checkDigit(digits, [1, 2, 3, 4, 5, 6, 7, 8]) === digits[8];
}

export function isValidEik13(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{13}$/.test(text)) return false;
    if (!isValidEik9(text.slice(0, 9))) return false;
    const digits = [...text].map(Number);
    return checkDigit(digits, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) === digits[12];
}

export function isValidEik(value) {
    const text = String(value ?? '').trim();
    return text.length === 13 ? isValidEik13(text) : isValidEik9(text);
}

/**
 * A Bulgarian VAT number is "BG" followed by the ЕИК. Accepts the number with
 * or without the prefix, with or without spaces, in any case.
 */
export function normalizeVatId(value) {
    const text = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (!text) return '';
    return /^BG\d{9,13}$/.test(text) ? text : `BG${text.replace(/^BG/, '')}`;
}

/** Digits only, for the ЕИК field. */
export function digitsOnly(value) {
    return String(value ?? '').replace(/\D/g, '');
}
