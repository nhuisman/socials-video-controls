'use strict';

// Shared machinery for the browser suite: loads the extension into a real page
// and provides the helpers a spec needs to drive it.
//
// Most of what is here exists because of a mistake made while building this
// extension. Each helper's comment records the trap it removes, so the lesson
// lives in code rather than in a chat log.

const fs = require('fs');
const path = require('path');
const { attachToPage, sleep } = require('./cdp');
const config = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SOURCES = {
  captureUrl: () => read('content/capture-url.js'),
  core: () => read('content/core.js'),
  content: () => read('content/content.js'),
  css: () => read('content/content.css')
};

//#region Test registry

const groups = [];
let currentGroup = null;

function describe(name, body) {
  currentGroup = { name, tests: [] };
  groups.push(currentGroup);
  body();
  currentGroup = null;
}

function it(name, body) {
  if (!currentGroup) throw new Error(`it("${name}") outside a describe block`);
  currentGroup.tests.push({ name, body });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function close(actual, expected, epsilon, message) {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(`${message || 'values differ'}: got ${actual}, want ${expected} +/- ${epsilon}`);
  }
}

// Thrown to mark a test as skipped rather than failed: a deleted fixture or a
// signed-out profile is not a defect in the extension.
class Skip extends Error {}
function skip(reason) { throw new Skip(reason); }

//#endregion

//#region Page setup

// Loads the extension into the current page the way the manifest does:
// capture-url.js before any page script, then the stylesheet and the main
// scripts once the document is idle.
async function loadExtension(page, url, { settleMs = config.settleMs } = {}) {
  await page.clearInitScripts();
  await page.addInitScript(SOURCES.captureUrl());
  await page.goto(url, { settleMs });

  await page.eval(`
    (() => {
      document.getElementById('__igvc_test_css')?.remove();
      const style = document.createElement('style');
      style.id = '__igvc_test_css';
      style.textContent = ${JSON.stringify(SOURCES.css())};
      document.head.appendChild(style);
      return true;
    })()
  `, { label: 'inject css' });
  await page.eval(SOURCES.core(), { label: 'inject core.js' });
  await page.eval(SOURCES.content(), { label: 'inject content.js' });
  await sleep(3000);

  const state = await page.eval(`
    (() => {
      const signedOut = Boolean(document.querySelector('input[name="username"], input[name="email"]'))
        || /\\/(login|accounts\\/login)/.test(location.pathname);
      const video = document.querySelector('video');
      return {
        signedOut,
        videoCount: document.querySelectorAll('video').length,
        hasBar: Boolean(document.querySelector('.ig-vc-bar')),
        duration: video && Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null
      };
    })()
  `, { label: 'page state' });

  if (state.signedOut) skip('the debug profile is signed out of this site');
  if (!state.videoCount) skip('no video on the fixture page (it may have been removed)');
  if (!state.hasBar) skip('the extension did not attach a control bar');
  if (!state.duration) skip('video metadata never loaded');
  return state;
}

// Resets the page after a test so the next one starts clean.
async function teardown(page) {
  await page.eval(`
    (() => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      window.__igVcCleanup && window.__igVcCleanup();
      document.getElementById('__igvc_test_css')?.remove();
      for (const el of document.querySelectorAll('.ig-vc-theater, .ig-vc-bar')) el.remove();
      for (const el of document.querySelectorAll('.ig-vc-test-target')) el.classList.remove('ig-vc-test-target');
      for (const el of document.querySelectorAll('.ig-vc-player')) el.classList.remove('ig-vc-player', 'ig-vc-kb');
      const video = document.querySelector('video');
      if (video) { video.pause(); video.playbackRate = 1; video.muted = true; }
      delete window.__igvcSaves;
      return true;
    })()
  `, { label: 'teardown' }).catch(() => {});
  await page.clearInitScripts();
}

//#endregion

//#region Page-side helpers

// A page has several videos on a feed, so each with its own bar. Every query
// must be scoped to the engaged player, or a spec reads one bar while the keys
// act on another — which produced three separate false failures during
// development.
// hoverVideo tags the player it hovered, and that tag wins over everything
// else. Re-resolving by :hover or .ig-vc-kb on every call is not stable: the
// keyboard reveal lapses after 4s, Facebook grows a second player after load,
// and the fallback is "the first bar in the document" -- which is how a test
// came to read one bar while the keys acted on another, reporting a marker
// handle as missing when it was displayed on the bar it was not looking at.
const ACTIVE_BAR = `
  (() => {
    const tagged = document.querySelector('.ig-vc-test-target .ig-vc-bar');
    if (tagged) return tagged;
    const engaged = document.querySelector('.ig-vc-player.ig-vc-kb .ig-vc-bar')
      || document.querySelector('.ig-vc-player:hover .ig-vc-bar');
    return engaged || document.querySelector('.ig-vc-bar');
  })()
`;

function barExpr(inner) {
  return `(() => { const bar = ${ACTIVE_BAR}; if (!bar) return null; ${inner} })()`;
}

// Hovering the video is what reveals the bar on the correct container. Adding
// the reveal class by hand to the first .ig-vc-player picks the wrong element
// on a multi-video page, leaving the bar at opacity 0 and un-hittable.
async function hoverVideo(page) {
  const box = await page.eval(`
    (() => {
      const video = document.querySelector('video');
      if (!video) return null;
      video.pause();
      // Mark this player as the one every later query should read, so a second
      // player appearing on the page cannot redirect the assertions. This is
      // test bookkeeping only: the bar is still revealed by a real hover, not
      // by a class added here.
      for (const el of document.querySelectorAll('.ig-vc-test-target')) {
        el.classList.remove('ig-vc-test-target');
      }
      video.closest('.ig-vc-player')?.classList.add('ig-vc-test-target');
      const r = video.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `, { label: 'video box' });
  if (!box) skip('no video to hover');
  await page.mouseMove(box.x, box.y);
  await sleep(1200);
  return box;
}

// Geometry of the active bar's seek track, for drags and handle positions.
async function seekGeometry(page) {
  return page.eval(barExpr(`
    const track = bar.querySelector('.ig-vc-track');
    const a = bar.querySelector('.ig-vc-handle-a');
    const b = bar.querySelector('.ig-vc-handle-b');
    const seek = bar.querySelector('.ig-vc-seek');
    const tr = track.getBoundingClientRect();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), visible: getComputedStyle(el).display !== 'none' };
    };
    return {
      track: { left: Math.round(tr.left), width: Math.round(tr.width), y: Math.round(tr.top + tr.height / 2) },
      handleA: box(a),
      handleB: box(b),
      seekTitle: seek.title,
      seekClasses: seek.className
    };
  `), { label: 'seek geometry' });
}

async function barState(page) {
  return page.eval(barExpr(`
    const cls = (sel) => { const el = bar.querySelector(sel); return el ? el.className : null; };
    const title = (sel) => { const el = bar.querySelector(sel); return el ? el.title : null; };
    const video = document.querySelector('video');
    return {
      order: [...bar.children].map((c) => c.className.replace('ig-vc-btn ', '').replace(/ig-vc-/g, '')),
      augmentMode: bar.classList.contains('ig-vc-augment'),
      readout: bar.querySelector('.ig-vc-time').textContent,
      hint: (bar.querySelector('.ig-vc-hint') || {}).textContent || '',
      hintVisible: bar.querySelector('.ig-vc-hint').classList.contains('visible'),
      loopInTitle: title('.ig-vc-loop-in'),
      loopOutTitle: title('.ig-vc-loop-out'),
      looping: bar.querySelector('.ig-vc-loop-toggle').classList.contains('active'),
      // The bar slot holds the loop-link copy button, hidden until a loop
      // exists, so its visibility is the honest "is there a loop" signal.
      hasLoop: !bar.querySelector('.ig-vc-loop-link').classList.contains('ig-vc-hidden'),
      loopLinkHidden: bar.querySelector('.ig-vc-loop-link').classList.contains('ig-vc-hidden'),
      // Clip export is an option inside the loop menu now.
      clipUnavailable: bar.querySelector('.ig-vc-clip').classList.contains('unavailable'),
      clipLabel: bar.querySelector('.ig-vc-clip').textContent,
      restartClasses: cls('.ig-vc-loop-restart'),
      activeLoopSpeed: [...bar.querySelectorAll('.ig-vc-loop-speed')].filter((b) => b.classList.contains('active')).map((b) => b.textContent)[0] || null,
      currentTime: video ? Number(video.currentTime.toFixed(3)) : null,
      paused: video ? video.paused : null,
      muted: video ? video.muted : null,
      playbackRate: video ? video.playbackRate : null
    };
  `), { label: 'bar state' });
}

async function clickBarControl(page, selector) {
  const clicked = await page.eval(barExpr(`
    const el = bar.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  `), { label: `click ${selector}` });
  if (!clicked) throw new Error(`control not found: ${selector}`);
  await sleep(500);
}

// Clicks a control with a real mouse click rather than el.click().
//
// Facebook re-pauses a video that was not started by a genuine user gesture: a
// scripted .click() on the play button leaves paused true, and a bare
// video.play() behaves identically, so this is the site's doing and not ours.
// A dispatched mouse event carries the activation that makes playback stick.
// Use this for anything gated on user activation; el.click() is fine for the
// rest and avoids having to resolve coordinates.
async function clickBarControlReal(page, selector) {
  const box = await page.eval(barExpr(`
    const el = bar.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  `), { label: `locate ${selector}` });
  if (!box) throw new Error(`control not found or not visible: ${selector}`);
  await page.mouseMove(box.x, box.y);
  await sleep(80);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1
  });
  await sleep(60);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1
  });
  await sleep(600);
}

async function setCurrentTime(page, seconds) {
  await page.eval(`(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${Number(seconds)}; return true; })()`, { label: 'seek' });
  await sleep(900);
}

// Marks a loop using the real keyboard path, which is also what a user does.
async function markLoop(page, startSeconds, endSeconds) {
  await page.key('|');           // clear anything left from a previous test
  await setCurrentTime(page, startSeconds);
  await page.key('[');
  await setCurrentTime(page, endSeconds);
  await page.key(']');
  await sleep(500);
}

// Opens theater mode and waits for the overlay to actually exist.
//
// Pressing `t` only works when the extension considers a player engaged, and
// after a previous test closed an overlay the host page may still be settling
// the relocated player back into place. Retrying here keeps that timing out of
// every spec that needs the overlay.
async function openTheaterOverlay(page, { attempts = 3 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await hoverVideo(page);
    await page.key('t');
    for (let waited = 0; waited < 2500; waited += 250) {
      await sleep(250);
      const open = await page.eval(`Boolean(document.querySelector('.ig-vc-theater'))`, { label: 'theater open' })
        .catch(() => false);
      if (open) {
        // Give the overlay a moment to lay out before anything is measured.
        await sleep(600);
        return true;
      }
    }
  }
  throw new Error('theater mode did not open after pressing t');
}

// Waits until the video can actually play from a given time. Recording a clip
// from an unbuffered position stalls, which looks like a broken recorder.
async function waitForSeekable(page, seconds, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.eval(`
      (() => {
        const v = document.querySelector('video');
        if (!v) return false;
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= ${Number(seconds)} + 0.25 && v.buffered.end(i) >= ${Number(seconds)} + 0.5) return true;
        }
        return false;
      })()
    `, { label: 'buffered' }).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

// Stubs the download so a run does not litter the Downloads folder, and
// records what would have been saved.
async function stubDownloads(page) {
  await page.eval(`
    (() => {
      window.__igvcSaves = [];
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) { window.__igvcSaves.push(this.download); return; }
        return original.call(this);
      };
      return true;
    })()
  `, { label: 'stub downloads' });
}

async function savedFilenames(page) {
  return page.eval('(window.__igvcSaves || []).slice()', { label: 'saved files' });
}

// The viewport width reported by innerWidth includes the scrollbar, while a
// fixed element's rect does not. Comparing the two directly makes a correctly
// sized overlay look 15px too narrow.
const VIEWPORT_EXPR = '({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight })';

module.exports = {
  describe, it, assert, equal, close, skip, Skip,
  groups,
  loadExtension, teardown,
  attachToPage, sleep, config,
  hoverVideo, seekGeometry, barState, clickBarControl, clickBarControlReal, setCurrentTime, markLoop,
  openTheaterOverlay, waitForSeekable,
  stubDownloads, savedFilenames,
  barExpr, ACTIVE_BAR, VIEWPORT_EXPR
};
