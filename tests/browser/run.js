#!/usr/bin/env node
'use strict';

// Browser test runner.
//
// Drives a real Chrome over the DevTools Protocol against real Instagram and
// Facebook pages. Unlike tests/run.js, this needs a browser and a signed-in
// profile, and it takes minutes rather than milliseconds. It is the "release
// test" tier.
//
//   tests/browser/launch-chrome.sh          # once, in another terminal
//   node tests/browser/run.js               # everything
//   node tests/browser/run.js --site=instagram
//   node tests/browser/run.js loop          # only groups/tests matching "loop"
//   node tests/browser/run.js --list        # show what would run
//
// Exits non-zero if anything failed. Skips do not fail the run: a deleted
// fixture video or a signed-out profile is not a defect in the extension.

const path = require('path');
const fs = require('fs');
const harness = require('./harness');
const config = require('./config');
const { cdpVersion, attachToPage } = require('./cdp');

const SPEC_DIR = path.join(__dirname, 'specs');

// Order matters only for reading the output: cheap structural checks first,
// then interaction, then the slow real-time recording tests.
const SPEC_ORDER = [
  'layout.spec.js',
  'keyboard.spec.js',
  'markers.spec.js',
  'loop.spec.js',
  'url-loop.spec.js',
  'theater.spec.js',
  'clip.spec.js'
];

function parseArgs(argv) {
  const opts = { sites: null, filter: null, list: false };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg.startsWith('--site=')) opts.sites = arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--grep=')) opts.filter = arg.slice(7);
    else if (!arg.startsWith('-')) opts.filter = arg;
  }
  return opts;
}

function specFiles() {
  const present = fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.js'));
  const ordered = SPEC_ORDER.filter((f) => present.includes(f));
  // Anything new on disk runs too, so adding a spec file needs no edit here.
  const extra = present.filter((f) => !SPEC_ORDER.includes(f)).sort();
  return [...ordered, ...extra];
}

// Builds the group list for one site. The harness registry is module-level, so
// it is cleared first and the spec modules are re-required with a fresh cache,
// letting the same spec run twice for two different sites.
function collectGroups(site) {
  harness.groups.length = 0;
  for (const file of specFiles()) {
    const full = path.join(SPEC_DIR, file);
    delete require.cache[require.resolve(full)];
    const register = require(full);
    if (typeof register !== 'function') {
      throw new Error(`${file} must export a function taking the site config`);
    }
    register(site);
  }
  return harness.groups.map((g) => ({ ...g, tests: [...g.tests] }));
}

// Between tests, undo what a test did without tearing the bar down: a full
// reload per test would add ten seconds each and there are dozens of them.
async function resetBetweenTests(page) {
  await page.eval(`
    (() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      for (const el of document.querySelectorAll('.ig-vc-theater-close')) el.click();
      const v = document.querySelector('video');
      if (v) {
        v.pause();
        v.playbackRate = 1;
        v.muted = true;
        try { v.currentTime = 1; } catch (e) {}
      }
      delete window.__igvcSaves;
      delete window.__igvcWindows;
      delete window.__igvcAudio;
      document.getElementById('__igvc_probe_input')?.remove();
      for (const el of document.querySelectorAll('.ig-vc-test-target')) {
        el.classList.remove('ig-vc-test-target');
      }
      return true;
    })()
  `, { label: 'reset' }).catch(() => {});
  // Closing an overlay puts the relocated player back, and the host page needs
  // a moment to settle before the next test hovers it.
  await harness.sleep(900);
}

// A test may have navigated away, or a site re-render may have dropped the bar.
// Reload the extension when that happens rather than failing the next test for
// a reason the next test did not cause.
async function ensureLoaded(page, site) {
  const ok = await page.eval(`Boolean(document.querySelector('.ig-vc-bar'))`, { label: 'bar present' })
    .catch(() => false);
  if (ok) return null;
  return harness.loadExtension(page, site.url);
}

function format(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function runSite(siteKey, site, opts, totals) {
  const groups = collectGroups(site).filter((g) => {
    if (!opts.filter) return true;
    if (g.name.toLowerCase().includes(opts.filter.toLowerCase())) return true;
    return g.tests.some((t) => t.name.toLowerCase().includes(opts.filter.toLowerCase()));
  });
  if (!groups.length) return;

  console.log(`\n=== ${site.label} (${site.url}) ===`);

  let page;
  try {
    page = await attachToPage({ port: config.port });
  } catch (e) {
    console.log(`  ! cannot attach to the debug browser: ${e.message}`);
    totals.failed.push({ name: `${site.label}: attach`, error: e.message });
    return;
  }

  try {
    for (const group of groups) {
      const tests = group.tests.filter((t) => {
        if (!opts.filter) return true;
        const needle = opts.filter.toLowerCase();
        return group.name.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle);
      });
      if (!tests.length) continue;

      console.log(`\n  ${group.name}`);

      // One load per group, then a light reset per test.
      let groupLoadError = null;
      try {
        await harness.loadExtension(page, site.url);
      } catch (e) {
        groupLoadError = e;
      }

      for (const test of tests) {
        if (groupLoadError) {
          if (groupLoadError instanceof harness.Skip) {
            console.log(`    - ${test.name}  (${groupLoadError.message})`);
            totals.skipped.push({ name: `${group.name} > ${test.name}`, reason: groupLoadError.message });
          } else {
            console.log(`    x ${test.name}  ${groupLoadError.message}`);
            totals.failed.push({ name: `${group.name} > ${test.name}`, error: groupLoadError.message });
          }
          continue;
        }

        const started = Date.now();
        try {
          await resetBetweenTests(page);
          await ensureLoaded(page, site);
          await test.body(page);
          console.log(`    ok ${test.name}  (${format(Date.now() - started)})`);
          totals.passed++;
        } catch (e) {
          if (e instanceof harness.Skip) {
            console.log(`    -  ${test.name}  (${e.message})`);
            totals.skipped.push({ name: `${group.name} > ${test.name}`, reason: e.message });
          } else {
            console.log(`    x  ${test.name}  (${format(Date.now() - started)})`);
            console.log(`         ${e.message}`);
            totals.failed.push({ name: `${group.name} > ${test.name}`, error: e.message });
          }
        }
      }

      await harness.teardown(page).catch(() => {});
    }
  } finally {
    page.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const siteKeys = opts.sites || Object.keys(config.sites);
  const unknown = siteKeys.filter((k) => !config.sites[k]);
  if (unknown.length) {
    console.error(`unknown site(s): ${unknown.join(', ')}. Known: ${Object.keys(config.sites).join(', ')}`);
    process.exit(2);
  }

  if (opts.list) {
    for (const key of siteKeys) {
      const site = config.sites[key];
      console.log(`${site.label}  ${site.url}`);
      for (const group of collectGroups(site)) {
        console.log(`  ${group.name}`);
        for (const test of group.tests) console.log(`    ${test.name}`);
      }
    }
    return;
  }

  const version = await cdpVersion(config.port);
  if (!version) {
    console.error(
      `No debug browser on 127.0.0.1:${config.port}.\n\n` +
      `Start one first, in another terminal:\n` +
      `  tests/browser/launch-chrome.sh\n\n` +
      `It needs its own --user-data-dir (Chrome 136+ refuses remote debugging on the\n` +
      `default profile) and a signed-in session on the sites being tested.`
    );
    process.exit(1);
  }
  console.log(`Browser: ${version.Browser}`);

  const totals = { passed: 0, failed: [], skipped: [] };
  const started = Date.now();
  for (const key of siteKeys) {
    await runSite(key, config.sites[key], opts, totals);
  }

  console.log(
    `\n${totals.passed} passed, ${totals.failed.length} failed, ` +
    `${totals.skipped.length} skipped in ${format(Date.now() - started)}`
  );

  if (totals.skipped.length) {
    console.log('\nSkipped:');
    for (const s of totals.skipped) console.log(`  - ${s.name}: ${s.reason}`);
  }
  if (totals.failed.length) {
    console.log('\nFailed:');
    for (const f of totals.failed) console.log(`  x ${f.name}\n      ${f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
