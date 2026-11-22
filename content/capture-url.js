// Captures the launch URL at document_start, before the page's own scripts run.
//
// This exists because of measured behaviour rather than caution: Facebook
// rewrites the URL roughly 1.3 seconds into page load and removes the fragment,
// which is well before DOMContentLoaded. A script at document_idle — where the
// rest of this extension runs — reads an address bar that has already been
// cleaned. Reading here is the only reliable moment.
//
// Instagram keeps the fragment indefinitely, so this is strictly necessary only
// on Facebook, but reading early is correct on both and avoids a per-site
// special case.
//
// Deliberately minimal: the DOM does not exist yet at document_start, so this
// does nothing but record a string. Content scripts from one extension share an
// isolated world, so content.js reads what is stashed here.
(() => {
  'use strict';
  try {
    // Never overwrite an earlier capture. The service worker injects into
    // already-open tabs, where the URL has long since been rewritten, and that
    // later value must not replace a good one taken at load.
    if (!window.__igVcLaunchUrl) {
      window.__igVcLaunchUrl = { href: location.href, hash: location.hash };
    }
  } catch (e) {}
})();
