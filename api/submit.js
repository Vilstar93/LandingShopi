// Store request endpoint.
//
// Validates the submitted firm data, records the request, and returns the
// partner URL for the next step. The partner URL is built here, server-side,
// so the raw affiliate link is never hard-coded into the page.
//
// The click id lets a later payout be reconciled with the request that produced
// it. It is appended to a separate sub-ID parameter; the operator's own
// sharedid is preserved (see lib/affiliate.js).

import { partnerUrlFor, isPartnerConfigured, affiliateConfig } from '../lib/affiliate.js';
import { isValidEik, normalizeVatId, digitsOnly } from '../public/lib/eik.js';
import { recordRequest } from '../lib/store.js';
import { notifyAgent } from '../lib/openclaw.js';

const RATE_LIMIT = { limit: 10, windowMs: 60_000 };
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

function text(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

export function validateRequest(body) {
    const errors = [];

    const legalName = text(body.legalName, 200);
    if (legalName.length < 2) errors.push({ field: 'legalName', message: 'Въведи наименованието на фирмата.' });

    const eik = digitsOnly(body.eik);
    if (!isValidEik(eik)) errors.push({ field: 'eik', message: 'ЕИК не е валиден.' });

    const contactName = text(body.contactName, 120);
    if (contactName.length < 2) errors.push({ field: 'contactName', message: 'Въведи своето име.' });

    const email = text(body.email, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: 'email', message: 'Въведи валиден имейл.' });

    const niche = text(body.niche, 200);
    if (niche.length < 2) errors.push({ field: 'niche', message: 'Опиши какво ще продаваш.' });

    if (body.consent !== true) errors.push({ field: 'consent', message: 'Нужно е съгласие, за да продължим.' });

    return {
        errors,
        data: {
            legalName,
            eik,
            vatId: normalizeVatId(body.vatId),
            address: text(body.address, 300),
            contactName,
            email,
            phone: text(body.phone, 40),
            niche,
            domain: text(body.domain, 200),
            consent: body.consent === true,
            receivedAt: new Date().toISOString(),
        },
    };
}

/** Short, URL-safe id used to tie a click to the request that produced it. */
export function makeClickId() {
    return `ls_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Forward the request to the operator's intake, when configured. */
export async function forward(data, clickId, options = {}) {
    const { fetchImpl = fetch } = options;
    const url = process.env.REQUEST_WEBHOOK_URL;
    if (!url) return { forwarded: false, reason: 'NOT_CONFIGURED' };
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, clickId }),
        });
        return { forwarded: response.ok, reason: response.ok ? 'OK' : `HTTP ${response.status}` };
    } catch {
        return { forwarded: false, reason: 'NETWORK' };
    }
}

/**
 * Keep the request somewhere durable and hand it to the agent.
 *
 * All three paths run and none is allowed to fail the visitor's request: the
 * response is a record of what happened, not a gate. A lost intake is an
 * operational problem, not a reason to tell the visitor their valid request
 * was rejected.
 */
export async function persist(data, clickId, options = {}) {
    const stored = recordRequest(data, clickId, options);
    const forwarded = await forward(data, clickId, options);
    const agent = await notifyAgent(data, clickId, options);
    return { stored, forwarded, agent };
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ code: 'METHOD_NOT_ALLOWED', message: 'Методът не е позволен.' });
    }

    if (rateLimited(clientKey(req))) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: 'Твърде много заявки. Опитай по-късно.' });
    }

    const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
    const { errors, data } = validateRequest(body);

    if (errors.length) {
        return res.status(400).json({
            code: 'VALIDATION_FAILED',
            message: errors[0].message,
            errors,
        });
    }

    const clickId = makeClickId();
    const intake = await persist(data, clickId);

    // A partner link is only offered when a real https deeplink is configured.
    // The link comes from config/affiliate.json, overridden by the environment.
    const partnerUrl = partnerUrlFor(clickId);

    return res.status(200).json({
        code: 'ACCEPTED',
        clickId,
        partnerUrl,
        stored: intake.stored.stored,
        forwarded: intake.forwarded.forwarded,
        agent: intake.agent.delivered,
        message: 'Заявката е приета.',
    });
}

function safeParse(raw) {
    try {
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}
