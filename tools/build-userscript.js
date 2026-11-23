#!/usr/bin/env node
'use strict';

// Builds dist/socials-video-controls.user.js from the extension sources.
//
// Why a build step rather than a hand-written userscript: a second copy of the
// logic would drift from the first, and the test suites only cover the files in
// content/. Generating the bundle keeps one source of truth, so a passing suite
// still means something about what gets installed.
//
// The bundle differs from the extension in exactly four ways, all forced by
// there being no extension runtime:
//
//   1. One file. The CSS is carried as a string and injected at runtime.
//   2. chrome.storage.local is shimmed onto localStorage.
//   3. Everything runs at document-start, so the main init is deferred to the
//      point the manifest's document_idle would have reached.
//   4. No service worker. It only re-injected into already-open tabs on
//      install, which a userscript manager does on the next page load anyway.
//
// The sources are wrapped in functions, never eval'd or passed to
// new Function. That is deliberate: "no eval, no new Function, no remote code"
// is the strongest claim this project makes about itself, and a build step is
// not a good reason to give it up. It also means a strict page CSP cannot
// block the bundle the way it would block eval.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'socials-video-controls.user.js');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

// Indents an embedded source so the generated file stays readable. Blank lines
// are left empty rather than filled with trailing spaces.
const indent = (source, spaces) => {
  const pad = ' '.repeat(spaces);
  return source
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
};

// @match patterns come from the manifest's own host permissions, so the two
// cannot disagree about which sites this runs on.
const matches = manifest.host_permissions.map((p) => `// @match        ${p}`).join('\n');

const header = `// ==UserScript==
// @name         ${manifest.name}
// @namespace    https://github.com/nhuisman/socials-video-controls
// @version      ${manifest.version}
// @description  ${manifest.description}
// @author       Nathan Huisman
${matches}
// @run-at       document-start
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/nhuisman/socials-video-controls
// ==/UserScript==
//
// GENERATED FILE -- do not edit.
//   Built from content/ by tools/build-userscript.js
//   Run \`node tools/build-userscript.js\` after changing anything in content/.
//
// Installing: this is for a userscript manager such as Userscripts for Safari
// (iOS and macOS, App Store). The packaged extension in this repository is the
// better option anywhere that can load one; the bundle exists for iOS, where
// loading an unpacked extension is not possible without an Xcode device
// install.
//
// Clip export is unavailable under WebKit: Safari does not implement
// HTMLMediaElement.captureStream, so there is nothing to record from. The clip
// control reports itself unsupported rather than failing.`;

const bundle = `${header}

(function () {
  'use strict';

  const SETTINGS_KEY = 'igvc:settings';

  // chrome.storage.local, backed by localStorage.
  //
  // Only installed when a real one is absent, so running this bundle in a
  // browser that also has the extension loaded does not shadow the extension's
  // own storage with a second, diverging copy.
  (function installStorageShim() {
    const scope = window;
    if (scope.chrome && scope.chrome.storage && scope.chrome.storage.local) return;

    const readAll = () => {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (e) {
        return {};
      }
    };

    const local = {
      // Mirrors the real API's shape: given an object of defaults, every key is
      // present in the result, falling back to its default.
      async get(defaults) {
        const stored = readAll();
        if (!defaults || typeof defaults !== 'object') return { ...stored };
        const out = {};
        for (const key of Object.keys(defaults)) {
          out[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : defaults[key];
        }
        return out;
      },
      async set(partial) {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readAll(), ...partial }));
        } catch (e) {
          // A full or blocked store costs persistence, not function.
        }
      }
    };

    scope.chrome = scope.chrome || {};
    scope.chrome.storage = scope.chrome.storage || {};
    scope.chrome.storage.local = local;
  })();

  const STYLES = ${JSON.stringify(read('content/content.css'))};

  // The extension gets its CSS injected by the manifest, which is privileged
  // and ignores the page's CSP. A userscript has to insert it, which a strict
  // style-src can refuse -- silently, leaving an unstyled and therefore
  // invisible control bar. So the insertion is verified and falls back to a
  // constructed stylesheet, which is not an inline style as far as CSP is
  // concerned.
  function injectStyles() {
    document.getElementById('igvc-styles')?.remove();
    try {
      const style = document.createElement('style');
      style.id = 'igvc-styles';
      style.textContent = STYLES;
      (document.head || document.documentElement).appendChild(style);
      if (style.sheet && style.sheet.cssRules && style.sheet.cssRules.length > 0) return 'style-element';
      style.remove();
    } catch (e) {
      // Fall through to the constructed sheet.
    }
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return 'constructed-sheet';
    } catch (e) {
      return null;
    }
  }

  // --- content/capture-url.js ------------------------------------------------
  // Runs now, at document-start, which is the whole point of it: Facebook
  // strips the fragment about 1.3s into load, before DOMContentLoaded.
  function captureUrl() {
${indent(read('content/capture-url.js'), 4)}
  }

  // --- content/core.js -------------------------------------------------------
  function loadCore() {
${indent(read('content/core.js'), 4)}
  }

  // --- content/content.js ----------------------------------------------------
  function loadContent() {
${indent(read('content/content.js'), 4)}
  }

  captureUrl();

  // The manifest runs core and content at document_idle. Here everything
  // arrives at document-start, so the DOM-dependent half waits: content.js
  // touches document.head for styles and document.body for the theater
  // overlay. Player discovery is driven by a MutationObserver either way, so
  // arriving before the player exists is already handled.
  function start() {
    const applied = injectStyles();
    if (!applied) {
      // Without styles the bar is invisible and unclickable, so say so once
      // rather than appearing to do nothing at all.
      console.warn('[Socials Video Controls] the page blocked our stylesheet; controls will not be visible.');
    }
    loadCore();
    loadContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
`;

const kb = (bundle.length / 1024).toFixed(1);
const rel = path.relative(ROOT, OUT_FILE);

// --check compares without writing, so a stale committed bundle can actually
// fail a test. Writing first and then comparing would be a check that cannot
// fail, which is worse than no check at all.
if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
  if (existing === null) {
    console.error(`${rel} is missing. Run: node tools/build-userscript.js`);
    process.exit(1);
  }
  if (existing !== bundle) {
    console.error(`${rel} is stale. Run: node tools/build-userscript.js`);
    process.exit(1);
  }
  console.log(`${rel} is up to date  (${kb} KB, v${manifest.version})`);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, bundle);
console.log(`wrote ${rel}  (${kb} KB, v${manifest.version})`);
console.log(`  matches: ${manifest.host_permissions.join(', ')}`);

// Optionally drop a copy straight into a userscript manager's directory, so
// iterating does not need a manual copy after every build. Opt-in and taken
// from the environment or the command line, never a path committed here:
//
//   node tools/build-userscript.js --dest ~/Documents/scripts
//   IGVC_USERSCRIPT_DEST=~/Documents/scripts node tools/build-userscript.js
const destFlagIndex = process.argv.indexOf('--dest');
const destArg = destFlagIndex >= 0 ? process.argv[destFlagIndex + 1] : process.env.IGVC_USERSCRIPT_DEST;
if (destArg) {
  // A leading ~ is not expanded by the shell when the value comes from an
  // environment variable or a quoted argument.
  const dest = destArg.startsWith('~')
    ? path.join(require('os').homedir(), destArg.slice(1))
    : destArg;
  if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) {
    console.error(`  --dest is not a directory: ${dest}`);
    process.exit(1);
  }
  const copied = path.join(dest, path.basename(OUT_FILE));
  fs.writeFileSync(copied, bundle);
  console.log(`  copied to ${copied}`);
}
