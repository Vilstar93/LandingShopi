// Portal client.
//
// The ЕИК check imports the SAME module the server uses, so the browser and the
// server can never disagree about what a valid ЕИК is.
//
// The affiliate link is never followed automatically. It is only navigated to
// by a real click on the button, in the same tab, after the form was submitted.

import { isValidEik, normalizeVatId, digitsOnly } from '/lib/eik.js';

const form = document.getElementById('form');
const eikInput = document.getElementById('eik');
const vatInput = document.getElementById('vatId');
const eikMsg = document.getElementById('eik-msg');
const vatMsg = document.getElementById('vatId-msg');
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit');
const shopifyBtn = document.getElementById('shopify-btn');
const shopifyHint = document.getElementById('shopify-hint');

let submitted = false;
let partnerUrl = null;

function setMessage(el, text, kind) {
    el.textContent = text;
    el.className = `field-msg ${kind ?? ''}`.trim();
}

function setInvalid(input, invalid) {
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
}

// --- ЕИК: instant, offline, no network round trip -------------------------

function checkEik() {
    const value = digitsOnly(eikInput.value);
    if (!value) {
        setMessage(eikMsg, '', '');
        setInvalid(eikInput, false);
        return false;
    }
    if (value.length !== 9 && value.length !== 13) {
        setMessage(eikMsg, 'ЕИК трябва да е 9 или 13 цифри.', 'err');
        setInvalid(eikInput, true);
        return false;
    }
    if (!isValidEik(value)) {
        setMessage(eikMsg, 'ЕИК не е валиден — провери цифрите.', 'err');
        setInvalid(eikInput, true);
        return false;
    }
    setMessage(eikMsg, 'ЕИК е валиден.', 'ok');
    setInvalid(eikInput, false);
    return true;
}

eikInput.addEventListener('input', () => {
    const digits = digitsOnly(eikInput.value);
    if (digits !== eikInput.value) eikInput.value = digits;
    checkEik();
});

// --- ДДС: server-side, because VIES sends no CORS header -------------------

async function checkVat() {
    const eik = digitsOnly(eikInput.value);
    const vatRaw = vatInput.value.trim();

    // Nothing to check: the company may simply not be VAT-registered.
    if (!eik && !vatRaw) {
        setMessage(vatMsg, '', '');
        return;
    }

    setMessage(vatMsg, 'Проверяваме в VIES…', 'warn');

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eik, vatId: vatRaw, country: 'BG' }),
        });
        const data = await response.json();

        if (data.code === 'VAT_VALID') {
            const label = data.name ? `Фирмата е потвърдена: ${data.name}` : 'ДДС номерът е потвърден.';
            setMessage(vatMsg, label, 'ok');
            if (data.name && !form.legalName.value.trim()) {
                form.legalName.value = data.name;
            }
            if (data.address && !form.address.value.trim()) {
                form.address.value = data.address;
            }
            return;
        }

        if (data.code === 'VAT_NOT_REGISTERED') {
            // Not an error — many companies are not VAT-registered.
            setMessage(vatMsg, 'Фирмата не е регистрирана по ДДС. Това е нормално.', 'warn');
            return;
        }

        // Unavailable is never reported as invalid.
        setMessage(vatMsg, 'VIES временно не отговаря. Ще проверим ръчно.', 'warn');
    } catch {
        setMessage(vatMsg, 'VIES временно не отговаря. Ще проверим ръчно.', 'warn');
    }
}

vatInput.addEventListener('blur', checkVat);
eikInput.addEventListener('blur', () => {
    if (checkEik()) checkVat();
});

// --- Submit ---------------------------------------------------------------

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;

    if (!checkEik()) {
        formError.textContent = 'Провери ЕИК преди да изпратиш.';
        formError.hidden = false;
        eikInput.focus();
        return;
    }
    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Изпращаме…';

    try {
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.consent = form.consent.checked;
        payload.vatId = normalizeVatId(payload.vatId ?? '');

        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Заявката не беше приета.');
        }

        submitted = true;
        partnerUrl = data.partnerUrl || null;
        form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });

        // The affiliate link is activated ONLY here, after the data was
        // gathered, and only by an explicit click. No auto-redirect.
        if (partnerUrl) {
            shopifyBtn.disabled = false;
            shopifyHint.textContent = 'Готово. Отвори Shopify и създай магазина.';
        } else {
            shopifyHint.textContent = 'Ще получиш линка по имейл.';
        }

        const ok = document.createElement('p');
        ok.className = 'field-msg ok';
        ok.setAttribute('role', 'status');
        ok.textContent = 'Заявката е приета. Ще се свържем с теб.';
        form.appendChild(ok);
    } catch (error) {
        formError.textContent = error.message;
        formError.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Изпрати заявката';
    }
});

// --- Affiliate link -------------------------------------------------------
// A normal same-tab navigation. No window.open, no popup, no iframe.

shopifyBtn.addEventListener('click', () => {
    if (!submitted || !partnerUrl) return;
    window.location.assign(partnerUrl);
});
