/* my-handwriting - character groups. Must match GROUPS / LANG_GROUPS in
 * skill/my-handwriting/scripts/my_handwriting.py (checked by tests/py_test.py). Data files store samples by character, so groups
 * can change without breaking old exports. */
(function () {
  'use strict';
  var BASE = [
    { id: 'upper',   chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
    { id: 'lower',   chars: 'abcdefghijklmnopqrstuvwxyz' },
    { id: 'digits',  chars: '0123456789' },
    { id: 'punct',   chars: '.,;:!?-–_\'"()[]' },
    { id: 'math',    chars: '+=<>%/\\|*×÷±°²³½¼¾√≈≠≤≥→' },
    { id: 'special', chars: '&@#§$€~^{}' }
  ];
  // Extra letters and quotation marks per writing language. Each list is complete for its
  // language; a character already shown by an earlier active group is not asked twice.
  var LANG = {
    en: '£“”‘’',
    de: 'ÄÖÜẞäöüß„“‚‘»«',
    fr: 'ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ«»',
    es: 'ÁÉÍÑÓÚÜáéíñóúüªº¿¡«»',
    it: 'ÀÈÉÌÍÎÒÓÙÚàèéìíîòóùú«»',
    pl: 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż„”«»'
  };
  var LANG_ORDER = ['en', 'de', 'fr', 'es', 'it', 'pl'];
  // Core groups: needed for normal texts (the rest is optional).
  var CORE = ['upper', 'lower', 'digits', 'punct'];

  var api = { BASE: BASE, LANG: LANG, LANG_ORDER: LANG_ORDER, CORE: CORE };
  if (typeof window !== 'undefined') window.Charsets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
