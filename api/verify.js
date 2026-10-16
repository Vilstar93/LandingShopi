// VIES verification endpoint.
//
// VIES sends no Access-Control-Allow-Origin header, so the browser cannot call
// it directly. This function proxies the check server-side and returns a small,
// stable shape.
//
// It deliberately distinguishes "the number is not VAT-registered" from "the
// service could not answer": a busy VIES must never be reported to the customer
// as an invalid company.

import { validateVat } from './_vies.js';
import { isValidEik, normalizeVatId, digitsOnly } from '../public/lib/eik.js';

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };
const hits = new Map();

function rateLimited(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
        hits.set(key, { start: now, count: 1 });
        return false;
    }
    entry.count += 1;
    return entry.count > RATE_LIMIT.limit;
}

function clientKey(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? '').split(',')[0].trim();
    return ip || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    }

    if (rateLimited(clientKey(req))) {
        return res.status(429).json({ code: 'RATE_LIMITED' });
    }

    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
    const eik = digitsOnly(body.eik);
    const country = String(body.country ?? 'BG').trim().toUpperCase();

    // Offline check first: a typo is caught instantly without touching the network.
    if (country === 'BG' && !isValidEik(eik)) {
        return res.status(200).json({
            code: 'EIK_INVALID',
            status: 'invalid',
            message: 'ЕИК не е валиден — провери цифрите.',
        });
    }

    const vatNumber = country === 'BG' ? eik : digitsOnly(body.vatId);
    const result = await validateVat(country, vatNumber);

    if (result.status === 'valid') {
        return res.status(200).json({
            code: 'VAT_VALID',
            status: 'valid',
            vatId: country === 'BG' ? normalizeVatId(eik) : `${country}${vatNumber}`,
            name: result.name,
            address: result.address,
        });
    }

    if (result.status === 'invalid') {
        return res.status(200).json({
            code: 'VAT_NOT_REGISTERED',
            status: 'invalid',
            // Not an error: the company may exist but not be VAT-registered.
            message: 'Фирмата не е регистрирана по ДДС в VIES.',
        });
    }

    // The service could not answer. Never call this invalid.
    return res.status(200).json({
        code: 'VIES_UNAVAILABLE',
        status: 'unavailable',
        reason: result.reason,
        message: 'Проверката в VIES временно не е достъпна. Ще я направим ръчно.',
    });
}

function safeParse(text) {
    try {
        return JSON.parse(text || '{}');
    } catch {
        return {};
    }
}
