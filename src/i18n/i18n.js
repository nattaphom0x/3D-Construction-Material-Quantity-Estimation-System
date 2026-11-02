/**
 * i18n.js — small UI-localization engine (project spec §25-§30, §65-§68).
 *
 * This module owns only the *presentation-layer* language switch. It does
 * not own persistence: the caller (script.js) reads/writes the language
 * from the app's existing `appSettings` (localStorage key `appSettings.v1`)
 * so we don't introduce a second, competing localStorage key (spec §29).
 *
 * Usage:
 *   import { t, initI18n, setLanguage, getLanguage, onLanguageChange } from './i18n.js';
 *   initI18n(appSettings.language);           // once, at startup — no persistence side-effect
 *   el.textContent = t('taskbar.tools');       // anywhere text is needed
 *   setLanguage('en');                         // on user action — persist yourself in the callback
 */
import { translations } from './translations.js';

const SUPPORTED_LANGUAGES = Object.keys(translations); // ['th', 'en']
const FALLBACK_LANGUAGE = 'th';

let currentLanguage = FALLBACK_LANGUAGE;
const changeListeners = new Set();

/**
 * Translate a key, with optional {placeholder} interpolation.
 * Falls back to the fallback language, then to the raw key itself, so a
 * missing translation never renders as blank UI.
 */
export function t(key, vars) {
    const dict = translations[currentLanguage] || {};
    let str = Object.prototype.hasOwnProperty.call(dict, key)
        ? dict[key]
        : (translations[FALLBACK_LANGUAGE]?.[key] ?? key);

    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            str = str.replaceAll(`{${k}}`, String(v));
        }
    }
    return str;
}

export function getLanguage() {
    return currentLanguage;
}

export function getSupportedLanguages() {
    return [...SUPPORTED_LANGUAGES];
}

/** Detect a reasonable default from the browser when no saved preference exists (spec §30). */
export function detectDefaultLanguage() {
    const nav = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '';
    return nav.toLowerCase().startsWith('th') ? 'th' : 'en';
}

/**
 * Set the active language and re-render all [data-i18n*] elements.
 * Does NOT persist — the caller decides how/where to save (see script.js
 * integration with appSettings), keeping this module storage-agnostic.
 */
export function setLanguage(lang) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) lang = FALLBACK_LANGUAGE;
    currentLanguage = lang;
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
    }
    applyTranslations();
    changeListeners.forEach(fn => {
        try { fn(lang); } catch (err) { console.error('[i18n] language-change listener threw:', err); }
    });
}

/** Initialize without notifying listeners or touching persistence — call once at startup. */
export function initI18n(lang) {
    currentLanguage = SUPPORTED_LANGUAGES.includes(lang) ? lang : FALLBACK_LANGUAGE;
    if (typeof document !== 'undefined') {
        document.documentElement.lang = currentLanguage;
    }
    applyTranslations();
}

/** Subscribe to language changes (e.g. to re-render dynamically-built content like the BOQ report). */
export function onLanguageChange(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
}

/**
 * Walk the DOM and apply translations to every element carrying an
 * i18n data-attribute. Supports:
 *   data-i18n="key"            → element.textContent
 *   data-i18n-html="key"       → element.innerHTML (only for the small set
 *                                 of trusted, app-authored strings that
 *                                 contain markup, e.g. quickstart steps)
 *   data-i18n-title="key"      → title attribute (tooltips)
 *   data-i18n-placeholder="key"→ placeholder attribute (inputs)
 *   data-i18n-aria-label="key" → aria-label attribute
 */
export function applyTranslations(root) {
    if (typeof document === 'undefined') return;
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach(el => {
        el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.getAttribute('data-i18n-title'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });

    if (root === undefined) {
        document.title = t('app.title');
    }
}