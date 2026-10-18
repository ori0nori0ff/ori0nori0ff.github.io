/* Aurora page languages: English (source), Română, Deutsch.
   T('English text', {x: 1}) → the text in the chosen language ({x} placeholders filled in).
   i18nApply() translates the page's fixed HTML once at start: a block whose children are only inline tags
   (b, span, br, a …) is looked up by its whole HTML; anything else by each text node; plus aria-label /
   placeholder / title / alt. Dictionaries: i18n.ro.js, i18n.de.js (keys = the English text / HTML). */
(function () {
  'use strict';
  const NAMES = { en: 'EN', ro: 'RO', de: 'DE' }, LOCS = { en: 'en-GB', ro: 'ro-RO', de: 'de-DE' };
  const q = new URLSearchParams(location.search);
  let lang = (q.get('lang') || '').toLowerCase();
  if (!NAMES[lang]) { try { lang = localStorage.getItem('aurora.lang') || ''; } catch (e) { lang = ''; } }
  if (!NAMES[lang]) { const n = (navigator.language || 'en').slice(0, 2).toLowerCase(); lang = NAMES[n] ? n : 'en'; }
  window.I18N_DICT = window.I18N_DICT || {};
  window.LANG = lang; window.LOC = LOCS[lang];
  document.documentElement.lang = lang;
  const fill = (s, o) => o ? String(s).replace(/\{(\w+)\}/g, (m, k) => o[k] != null ? o[k] : m) : s;
  const norm = s => s.replace(/\s+/g, ' ').trim();
  window.T = (s, o) => {
    if (window.I18N_COLLECT) window.I18N_COLLECT.add(s);
    const d = window.I18N_DICT[lang], r = d && d[s];
    return fill(r != null && r !== '' ? r : s, o);
  };
  const INLINE = new Set(['B', 'I', 'SPAN', 'SMALL', 'BR', 'A', 'EM', 'U', 'STRONG', 'S', 'SUP', 'SUB']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'svg', 'INPUT', 'TEXTAREA', 'SELECT']);
  const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
  const look = k => { if (window.I18N_COLLECT) window.I18N_COLLECT.add(k); const d = window.I18N_DICT[lang]; return d && d[k]; };
  function attrs(el) { ATTRS.forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v)) { const t = look(norm(v)); if (t) el.setAttribute(a, t); } }); }
  function walk(el) {
    if (SKIP.has(el.tagName) || el.hasAttribute('data-noi18n')) return;
    attrs(el);
    const kids = [...el.childNodes], hasText = kids.some(n => n.nodeType === 3 && /[A-Za-z]{2}/.test(n.nodeValue));
    const allInline = kids.every(n => n.nodeType !== 1 || (INLINE.has(n.tagName) && ![...n.querySelectorAll('*')].some(c => !INLINE.has(c.tagName))));
    if (hasText && allInline && kids.some(n => n.nodeType === 1)) {   // mixed text + inline tags → the whole block
      const t = look(norm(el.innerHTML)); if (t) { el.innerHTML = t; return; }
    }
    kids.forEach(n => {
      if (n.nodeType === 3) { const v = norm(n.nodeValue); if (/[A-Za-z]{2}/.test(v)) { const t = look(v); if (t) n.nodeValue = n.nodeValue.replace(n.nodeValue.trim(), t); } }
      else if (n.nodeType === 1) walk(n);
    });
  }
  window.i18nApply = (root) => { walk(root || document.body); document.title = T(document.title); };
  window.i18nNames = NAMES;
  window.i18nSet = l => { try { localStorage.setItem('aurora.lang', l); } catch (e) {}
    // reload at the top: drop an old #anchor (e.g. #safe at the bottom) and don't let the browser restore the old scroll
    const u = new URL(location.href); u.searchParams.set('lang', l); u.hash = ''; try { sessionStorage.setItem('aurora.top', '1'); } catch (e) {} location.replace(u); };
  try { if (sessionStorage.getItem('aurora.top')) { sessionStorage.removeItem('aurora.top'); history.scrollRestoration = 'manual'; scrollTo(0, 0); addEventListener('load', () => scrollTo(0, 0)); } } catch (e) {}
})();
