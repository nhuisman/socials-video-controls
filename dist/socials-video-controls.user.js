// ==UserScript==
// @name         Socials Video Controls
// @namespace    https://github.com/nhuisman/socials-video-controls
// @version      1.18.0
// @description  Frame-accurate video navigation, A-B loop practice, clip export and theater mode for Instagram and Facebook.
// @author       Nathan Huisman
// @match        *://*.instagram.com/*
// @match        *://*.facebook.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/nhuisman/socials-video-controls
// ==/UserScript==
//
// GENERATED FILE -- do not edit.
//   Built from content/ by tools/build-userscript.js
//   Run `node tools/build-userscript.js` after changing anything in content/.
//
// Installing: this is for a userscript manager such as Userscripts for Safari
// (iOS and macOS, App Store). The packaged extension in this repository is the
// better option anywhere that can load one; the bundle exists for iOS, where
// loading an unpacked extension is not possible without an Xcode device
// install.
//
// Clip export is unavailable under WebKit: Safari does not implement
// HTMLMediaElement.captureStream, so there is nothing to record from. The clip
// control reports itself unsupported rather than failing.

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

  const STYLES = "/* Clip slide-up control bar to the video frame */\n.ig-vc-player {\n  overflow: hidden;\n}\n\n/* Keep Instagram's overlay full-height and hide its native mute button */\n.ig-vc-player [role=\"group\"][aria-label=\"Video player\"] {\n  bottom: 0 !important;\n  height: 100% !important;\n}\n\n.ig-vc-player [role=\"slider\"][aria-label=\"Adjust volume\"],\n.ig-vc-player [aria-label=\"Toggle audio\"] {\n  display: none !important;\n}\n\n/* Smoothly slide Tagged Users (Feed), bottom caption (Reels) & Watch This Series up when control bar is visible */\n.ig-vc-player [role=\"group\"][aria-label=\"Video player\"] [role=\"button\"] > div:has(> .html-div) {\n  overflow: visible !important;\n}\n\n.ig-vc-player [role=\"group\"][aria-label=\"Video player\"] > div:has(button):not(:has([role=\"button\"])),\n.ig-vc-player [role=\"group\"][aria-label=\"Video player\"] [role=\"button\"] > div > .html-div > .html-div,\n.ig-vc-series-overlay {\n  transition: transform 0.18s ease !important;\n}\n\n.ig-vc-player:is(:hover:not(:fullscreen.idle), .dragging, .ig-vc-kb),\n.ig-vc-host:has(.ig-vc-series-overlay:hover) .ig-vc-player:not(:fullscreen.idle) {\n  & .ig-vc-bar {\n    pointer-events: auto;\n    opacity: 1;\n    transform: translateY(0);\n  }\n\n  & [role=\"group\"][aria-label=\"Video player\"] > div:has(button):not(:has([role=\"button\"])),\n  & [role=\"group\"][aria-label=\"Video player\"] [role=\"button\"] > div > .html-div > .html-div {\n    transform: translateY(-28px) !important;\n  }\n}\n\n.ig-vc-host:has(.ig-vc-player:is(:hover:not(:fullscreen.idle), .dragging)) .ig-vc-series-overlay,\n.ig-vc-series-overlay:hover {\n  transform: translateY(-28px) !important;\n}\n\n/* Fullscreen layout & idle cursor hiding */\n.ig-vc-player:fullscreen {\n  background: #000 !important;\n  display: flex !important;\n  align-items: center !important;\n  justify-content: center !important;\n}\n\n.ig-vc-player:fullscreen.idle:not(.dragging, .ig-vc-kb) {\n  cursor: none !important;\n}\n\n.ig-vc-player:fullscreen video {\n  width: 100vw !important;\n  height: 100vh !important;\n  max-height: 100vh !important;\n  object-fit: contain !important;\n}\n\n/* Flush bottom vignette control bar */\n.ig-vc-bar {\n  position: absolute;\n  inset: auto 0 0 0;\n  z-index: 2147483647;\n  height: 28px;\n  padding: 0 8px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  background: linear-gradient(to top, rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.16) 60%, transparent);\n  color: #fff;\n  font: 400 11px/1 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  font-variant-numeric: tabular-nums;\n  user-select: none;\n  touch-action: none;\n  pointer-events: none;\n  opacity: 0;\n  transform: translateY(28px);\n  transition: opacity 0.18s ease, transform 0.18s ease;\n}\n\n/* The site's own control, hidden because ours occupies the same place. Applied\n   from JS, since these elements are found structurally rather than by any\n   selector that could live here. */\n.ig-vc-native-hidden {\n  display: none !important;\n}\n\n/* Augment mode: a stripped bar pinned to the top-left for a site that already\n   has a full player of its own. No site uses this now that Facebook runs in\n   replace mode; it is kept because the mode is one field in the adapter and\n   removing it would mean unpicking the augmenting branches in sync(),\n   stopLoopWatcher() and endScrub() in the same change as a behaviour switch.\n\n   It suppresses everything except the frame readout and the loop controls,\n   looping being the point of the tool on a dance video. */\n.ig-vc-bar.ig-vc-augment {\n  inset: 0 auto auto 0;\n  height: auto;\n  width: auto;\n  padding: 4px 7px;\n  gap: 6px;\n  border-radius: 0 0 6px 0;\n  background: rgba(0, 0, 0, 0.55);\n  transform: translateY(-100%);\n}\n\n.ig-vc-bar.ig-vc-augment > :not(.ig-vc-time, .ig-vc-seek, .ig-vc-loop-wrap, .ig-vc-loop-restart) {\n  display: none !important;\n}\n\n/* A compact trim timeline, not a replacement for Facebook's progress bar: it\n   exists to carry the loop handles, which their player has no equivalent for. */\n.ig-vc-bar.ig-vc-augment .ig-vc-seek {\n  flex: 0 0 150px;\n  width: 150px;\n}\n\n.ig-vc-player:is(:hover:not(:fullscreen.idle), .dragging, .ig-vc-kb) .ig-vc-bar.ig-vc-augment {\n  transform: translateY(0);\n}\n\n/* Current position. The fill's leading edge was indistinguishable against the\n   loop span, so the playhead is its own high-contrast marker with a dark\n   outline that reads against white fill, blue span and bare track alike. */\n.ig-vc-playhead {\n  position: absolute;\n  top: 50%;\n  left: var(--v, 0%);\n  width: 2px;\n  height: 16px;\n  margin-left: -1px;\n  transform: translateY(-50%);\n  background: #fff;\n  border-radius: 1px;\n  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.75), 0 0 3px rgba(0, 0, 0, 0.5);\n  pointer-events: none;\n  z-index: 1;\n}\n\n.ig-vc-player:fullscreen .ig-vc-playhead {\n  height: 20px;\n}\n\n/* Hotkey hint, floated above the bar during a drag. Absolutely positioned so it\n   cannot affect the bar's layout, which has no spare width. */\n.ig-vc-hint {\n  position: absolute;\n  bottom: calc(100% + 6px);\n  left: 50%;\n  transform: translateX(-50%);\n  padding: 3px 7px;\n  border-radius: 4px;\n  background: rgba(0, 0, 0, 0.78);\n  color: #fff;\n  font-size: 10px;\n  line-height: 1.45;\n  /* Multi-line: marker times on the first line, the hotkey hint below. */\n  white-space: pre-line;\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n  pointer-events: none;\n  opacity: 0;\n  transition: opacity 0.12s ease;\n  z-index: 3;\n}\n\n.ig-vc-hint.visible {\n  opacity: 1;\n}\n\n/* Trim handles. Children of .ig-vc-seek rather than .ig-vc-track, because the\n   track clips its overflow and would cut them off. */\n.ig-vc-handle {\n  display: none;\n  position: absolute;\n  top: 50%;\n  width: 9px;\n  height: 14px;\n  margin-left: -4.5px;\n  transform: translateY(-50%);\n  box-sizing: border-box;\n  border-radius: 2px;\n  background: rgb(120, 200, 255);\n  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);\n  cursor: ew-resize;\n  touch-action: none;\n  z-index: 2;\n  transition: height 0.12s ease;\n}\n\n.ig-vc-seek.has-a .ig-vc-handle-a {\n  display: block;\n  left: var(--la, 0%);\n}\n\n.ig-vc-seek.has-b .ig-vc-handle-b {\n  display: block;\n  left: var(--lb, 0%);\n}\n\n.ig-vc-handle:hover,\n.ig-vc-handle:active {\n  height: 18px;\n  background: #fff;\n}\n\n/* A-B loop span, drawn above the buffered range and below the playback fill */\n.ig-vc-seek.has-loop .ig-vc-loop-span {\n  display: block;\n}\n\n.ig-vc-loop-span {\n  display: none;\n  position: absolute;\n  bottom: 0;\n  left: var(--la, 0%);\n  width: max(2px, calc(var(--lb, 0%) - var(--la, 0%)));\n  height: 100%;\n  background: rgba(120, 200, 255, 0.55);\n  border-radius: 99px;\n}\n\n/* A zoomed timeline shows a slice of the video, not the whole of it, so the\n   track is marked to make that obvious rather than silently misleading. */\n.ig-vc-seek.zoomed .ig-vc-track {\n  background: rgba(120, 200, 255, 0.22);\n  box-shadow: inset 1px 0 0 rgba(120, 200, 255, 0.8), inset -1px 0 0 rgba(120, 200, 255, 0.8);\n}\n\n/* Loop controls: the toggle carries state and the rest live in a popup, so the\n   bar keeps enough slack for the cache and fullscreen buttons on a narrow\n   player. Jump-back stays out on the bar because a practice loop uses it most. */\n.ig-vc-loop-box {\n  width: auto;\n  padding: 3px;\n  gap: 1px;\n}\n\n.ig-vc-loop-in.active,\n.ig-vc-loop-out.active {\n  background: rgba(120, 200, 255, 0.3);\n  color: rgb(170, 220, 255);\n}\n\n.ig-vc-loop-toggle,\n.ig-vc-loop-restart {\n  width: 20px;\n}\n\n.ig-vc-loop-toggle.active {\n  opacity: 1;\n  color: rgb(120, 200, 255);\n}\n\n.ig-vc-loop-toggle.unavailable,\n.ig-vc-loop-restart.unavailable {\n  opacity: 0.35;\n}\n\n/* Hidden rather than disabled, for a control that is meaningless until a loop\n   exists: an unexplained greyed button is worse than no button. */\n.ig-vc-hidden {\n  display: none !important;\n}\n\n/* A bar button widened to carry short text instead of an icon: clip recording\n   progress previously, and now the loop link's ok/err feedback. */\n.ig-vc-btn.ig-vc-clip-text {\n  width: 30px;\n  font-size: 10px;\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n  text-box: trim-both cap alphabetic;\n}\n\n/* Clip export lives in the loop menu now, where it is an option like the rest. */\n.ig-vc-opt.ig-vc-clip.active {\n  opacity: 1;\n  color: rgb(255, 120, 120);\n}\n\n.ig-vc-opt.ig-vc-clip.unavailable {\n  opacity: 0.4;\n}\n\n/* Theater mode: covers the page so only the video is visible, deliberately\n   without entering browser fullscreen, so tabs and the address bar stay put. */\n.ig-vc-theater {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483647;\n  background: rgba(0, 0, 0, 0.94);\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 10px;\n  padding: 14px;\n  box-sizing: border-box;\n}\n\n/* The stage takes every row the top bar leaves, which is what gives the player\n   below a definite height to scale against. Without `flex: 1` the stage height\n   is content-based, so a percentage height inside it resolves to nothing and\n   the video is stuck at its intrinsic size in the middle of a black screen. */\n.ig-vc-theater-stage {\n  flex: 1 1 auto;\n  width: 100%;\n  min-height: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.ig-vc-theater-video {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  object-fit: contain;\n  background: #000;\n  border-radius: 4px;\n}\n\n/* An adopted player keeps its own bar, so the loop controls stay usable here.\n   It is sized to fill the stage's height, with `aspect-ratio` set from the\n   video's own dimensions when the overlay opens. That keeps the box exactly as\n   wide as the picture, so the bar pinned to its bottom edge lines up with the\n   video instead of spanning the whole screen -- and, more importantly, stays\n   inside the viewport. An intrinsically sized box taller than the window put\n   the bar below the fold, which is why the controls could not be reached. */\n.ig-vc-theater-adopted {\n  height: 100% !important;\n  width: auto !important;\n  max-width: 100% !important;\n  max-height: 100% !important;\n  margin: 0 !important;\n  padding: 0 !important;\n}\n\n.ig-vc-theater-adopted video {\n  width: 100% !important;\n  height: 100% !important;\n  max-width: none !important;\n  max-height: none !important;\n  object-fit: contain !important;\n}\n\n/* In theater mode the overlay is the whole screen, so revealing the bar only\n   when the pointer is inside the video box makes it feel broken on a portrait\n   video with wide letterboxing. Any pointer movement over the overlay counts. */\n.ig-vc-theater:hover .ig-vc-theater-adopted .ig-vc-bar {\n  pointer-events: auto;\n  opacity: 1;\n  transform: translateY(0);\n}\n\n.ig-vc-theater-bar {\n  width: 100%;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  color: rgba(255, 255, 255, 0.85);\n  font: 400 11px/1.4 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n}\n\n.ig-vc-theater-label {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.ig-vc-theater-actions {\n  display: inline-flex;\n  gap: 6px;\n  flex-shrink: 0;\n}\n\n.ig-vc-theater-bar button {\n  all: unset;\n  padding: 4px 10px;\n  border-radius: 4px;\n  background: rgba(255, 255, 255, 0.14);\n  color: #fff;\n  font: inherit;\n  cursor: pointer;\n}\n\n.ig-vc-theater-bar button:hover {\n  background: rgba(255, 255, 255, 0.26);\n}\n\n/* Buttons & thin Lucide icons */\n.ig-vc-btn {\n  all: unset;\n  width: 22px;\n  height: 22px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  cursor: pointer;\n  flex-shrink: 0;\n  opacity: 0.9;\n}\n\n.ig-vc-btn:hover {\n  opacity: 1;\n}\n\n.ig-vc-btn svg {\n  width: 16px;\n  height: 16px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.5;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  pointer-events: none;\n}\n\n.ig-vc-time {\n  color: rgba(255, 255, 255, 0.9);\n  white-space: nowrap;\n  /* Shrinks only after the seek bar has reached its minimum, so on a very\n     narrow player the readout truncates instead of pushing the buttons on the\n     right out of view. A clipped timestamp is a better failure than a missing\n     fullscreen control. */\n  flex-shrink: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  text-box: trim-both cap alphabetic;\n}\n\n/* Sliders (Horizontal Seek & Vertical Volume) */\n.ig-vc-seek {\n  flex: 1;\n  min-width: 48px;\n  height: 18px;\n  position: relative;\n  display: flex;\n  align-items: center;\n  cursor: pointer;\n  touch-action: none;\n}\n\n.ig-vc-track {\n  position: relative;\n  width: 100%;\n  height: 2px;\n  background: rgba(255, 255, 255, 0.34);\n  border-radius: 99px;\n  overflow: hidden;\n  transition: height 0.12s ease, width 0.12s ease;\n}\n\n.ig-vc-seek:hover .ig-vc-track {\n  height: 4px;\n}\n\n/* Downloaded range, drawn behind the playback fill so stepping ahead of the\n   buffer is visible rather than just feeling slow */\n.ig-vc-buffer {\n  position: absolute;\n  left: 0;\n  bottom: 0;\n  width: var(--b, 0%);\n  height: 100%;\n  background: rgba(255, 255, 255, 0.28);\n  border-radius: 99px;\n}\n\n.ig-vc-fill {\n  position: absolute;\n  left: 0;\n  bottom: 0;\n  width: var(--v, 0%);\n  height: 100%;\n  background: rgba(255, 255, 255, 0.9);\n  border-radius: 99px;\n}\n\n.ig-vc-seek:hover .ig-vc-fill,\n.ig-vc-vol:hover .ig-vc-fill {\n  background: #fff;\n}\n\n/* Hover Popups (Volume & Speed) */\n.ig-vc-wrap {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  flex-shrink: 0;\n}\n\n.ig-vc-popup {\n  position: absolute;\n  bottom: 100%;\n  left: 50%;\n  transform: translateX(-50%);\n  padding-bottom: 6px;\n  display: none;\n}\n\n.ig-vc-wrap:is(:hover, .dragging) .ig-vc-popup {\n  display: block;\n}\n\n.ig-vc-box {\n  width: 22px;\n  box-sizing: border-box;\n  background: rgba(0, 0, 0, 0.5);\n  border-radius: 5px;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n}\n\n.ig-vc-vol {\n  width: 100%;\n  height: 64px;\n  padding: 6px 0;\n  display: flex;\n  justify-content: center;\n  cursor: pointer;\n  touch-action: none;\n}\n\n.ig-vc-vol .ig-vc-track {\n  width: 2px;\n  height: 100%;\n}\n\n.ig-vc-vol:hover .ig-vc-track {\n  width: 4px;\n}\n\n.ig-vc-vol .ig-vc-fill {\n  width: 100%;\n  height: var(--v, 100%);\n}\n\n/* Speed Button & Vertical List */\n.ig-vc-speed-btn {\n  width: 28px;\n  text-align: center;\n  font-size: 11px;\n  font-weight: 400;\n  text-box: trim-both cap alphabetic;\n}\n\n.ig-vc-speed-box {\n  /* Eight speeds now that the slow end moved here from the loop menu, so they\n     wrap into two columns rather than making one very tall popup. */\n  width: auto;\n  max-height: 60vh;\n  padding: 3px;\n  gap: 1px;\n}\n\n.ig-vc-opt {\n  all: unset;\n  box-sizing: border-box;\n  width: 100%;\n  padding: 3px 6px;\n  font-size: 10px;\n  font-weight: 400;\n  color: rgba(255, 255, 255, 0.72);\n  text-align: center;\n  border-radius: 3px;\n  cursor: pointer;\n}\n\n.ig-vc-opt:hover {\n  background: rgba(255, 255, 255, 0.14);\n  color: #fff;\n}\n\n.ig-vc-opt.active {\n  background: rgba(255, 255, 255, 0.24);\n  color: #fff;\n}\n\n/* ===================================================================\n   Touch mode (iPhone / iPad Safari) — html.ig-vc-touch, set from JS when the\n   primary pointer is coarse and cannot hover. Desktop is unaffected: the extra\n   frame-step buttons and the in-menu loop on/off exist only here.\n   =================================================================== */\n.ig-vc-step,\n.ig-vc-loop-onoff {\n  display: none !important;\n}\n\n.ig-vc-touch .ig-vc-step {\n  display: inline-flex !important;\n}\n\n.ig-vc-touch .ig-vc-loop-onoff {\n  display: block !important;\n}\n\n/* Revealed: by a tap (.ig-vc-kb, timed), while paused, while dragging, or while\n   a menu is open. Sticky :hover from a previous tap must NOT keep it up. */\n/* !important because the desktop hover rule is more specific, and iOS leaves\n   :hover stuck on the last tapped element. */\n.ig-vc-touch .ig-vc-player:not(.ig-vc-kb, .ig-vc-paused, .dragging, :has(.ig-vc-open)) .ig-vc-bar {\n  opacity: 0 !important;\n  pointer-events: none !important;\n  transform: translateY(100%) !important;\n}\n\n.ig-vc-touch .ig-vc-player:is(.ig-vc-kb, .ig-vc-paused, .dragging, :has(.ig-vc-open)) .ig-vc-bar {\n  opacity: 1;\n  pointer-events: auto;\n  transform: translateY(0);\n}\n\n/* Two rows: full-width seek track with the time on top, buttons below. */\n.ig-vc-touch .ig-vc-bar {\n  height: auto;\n  flex-wrap: wrap;\n  justify-content: space-between;\n  row-gap: 2px;\n  column-gap: 0;\n  padding: 4px 6px 6px;\n  font-size: 13px;\n  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.45) 70%, transparent);\n  -webkit-touch-callout: none;\n  -webkit-tap-highlight-color: transparent;\n}\n\n.ig-vc-touch .ig-vc-seek {\n  order: -2;\n  flex: 1 1 0;\n  height: 32px;\n}\n\n.ig-vc-touch .ig-vc-time {\n  order: -1;\n  flex: 0 0 auto;\n  padding-left: 8px;\n}\n\n/* Line break between the seek row and the button row. */\n.ig-vc-touch .ig-vc-bar::after {\n  content: \"\";\n  order: -1;\n  flex-basis: 100%;\n  height: 0;\n}\n\n.ig-vc-touch .ig-vc-track,\n.ig-vc-touch .ig-vc-seek:hover .ig-vc-track {\n  height: 4px;\n}\n\n.ig-vc-touch .ig-vc-playhead {\n  width: 4px;\n  height: 22px;\n  margin-left: -2px;\n  border-radius: 2px;\n}\n\n.ig-vc-touch .ig-vc-handle {\n  width: 16px;\n  height: 26px;\n  margin-left: -8px;\n  border-radius: 4px;\n}\n\n.ig-vc-touch .ig-vc-btn {\n  width: 40px;\n  height: 40px;\n  border-radius: 8px;\n}\n\n.ig-vc-touch .ig-vc-btn:active {\n  background: rgba(255, 255, 255, 0.2);\n}\n\n.ig-vc-touch .ig-vc-btn svg {\n  width: 22px;\n  height: 22px;\n  stroke-width: 1.8;\n}\n\n.ig-vc-touch .ig-vc-speed-btn {\n  width: 44px;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n/* Menus open on tap (.ig-vc-open), not hover. Volume is read-only on iOS, so the\n   mute button keeps its tap-to-mute and its volume popup is dropped. */\n.ig-vc-touch .ig-vc-wrap:is(:hover, .dragging) .ig-vc-popup {\n  display: none;\n}\n\n.ig-vc-touch .ig-vc-wrap.ig-vc-open .ig-vc-popup {\n  display: block;\n}\n\n.ig-vc-touch .ig-vc-wrap:has(.ig-vc-vol) .ig-vc-popup {\n  display: none !important;\n}\n\n.ig-vc-touch .ig-vc-box {\n  width: auto;\n  min-width: 64px;\n  padding: 4px;\n  gap: 2px;\n  border-radius: 10px;\n  background: rgba(20, 20, 20, 0.92);\n}\n\n.ig-vc-touch .ig-vc-opt {\n  min-height: 38px;\n  padding: 9px 14px;\n  font-size: 15px;\n  border-radius: 7px;\n  color: #fff;\n}\n\n.ig-vc-touch .ig-vc-opt:hover {\n  background: none;\n}\n\n.ig-vc-touch .ig-vc-opt:active,\n.ig-vc-touch .ig-vc-opt.active {\n  background: rgba(255, 255, 255, 0.26);\n}\n\n/* The loop menu is the longest; keep it on screen near the right edge. */\n.ig-vc-touch .ig-vc-loop-wrap .ig-vc-popup {\n  left: auto;\n  right: -40px;\n  transform: none;\n}\n\n.ig-vc-touch .ig-vc-loop-box {\n  max-height: 60vh;\n  overflow-y: auto;\n}\n\n/* No captureStream on iOS: clip export cannot work, so don't offer it. */\n.ig-vc-no-clip.ig-vc-touch .ig-vc-clip {\n  display: none !important;\n}\n\n/* Loop painting (touch, Option 3): long-press the track for A, drag, lift for B.\n   While painting the track is zoomed (JS swaps the view to ±10 s around A), so it\n   is drawn taller and tinted to make the mode obvious. Handles are finger-sized\n   all the time on touch so an existing loop can be adjusted by dragging. */\n.ig-vc-touch .ig-vc-hint {\n  font-size: 13px;\n  padding: 6px 10px;\n  border-radius: 8px;\n  white-space: pre-line;\n}\n\n.ig-vc-touch .ig-vc-handle {\n  width: 22px;\n  height: 36px;\n  margin-left: -11px;\n  border-radius: 6px;\n}\n\n.ig-vc-touch .ig-vc-seek.ig-vc-painting {\n  height: 44px;\n}\n\n.ig-vc-touch .ig-vc-seek.ig-vc-painting .ig-vc-track {\n  height: 12px;\n  border-radius: 6px;\n  background: rgba(255, 255, 255, 0.3);\n  box-shadow: 0 0 0 2px rgba(80, 170, 255, 0.9);\n}\n\n.ig-vc-touch .ig-vc-seek.ig-vc-painting .ig-vc-fill {\n  background: transparent;\n}\n\n.ig-vc-touch .ig-vc-seek.ig-vc-painting .ig-vc-handle {\n  height: 44px;\n}\n\n.ig-vc-touch .ig-vc-hint {\n  width: max-content;\n  max-width: 90vw;\n}\n\n.ig-vc-touch .ig-vc-seek.ig-vc-painting .ig-vc-loop-span {\n  background: rgba(80, 170, 255, 0.95);\n}\n";

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

  }

  // --- content/core.js -------------------------------------------------------
  function loadCore() {
    // Pure logic shared by the content script and the test suite.
    //
    // Everything here is deliberately free of DOM, extension and video-element
    // access so it can be loaded and exercised under bare `node`. The invariants
    // that matter live in these functions: frame stepping must be drift-free and
    // reversible, seeks must coalesce without losing or duplicating intent, and
    // scrub pacing must stay even without banking a backlog.
    //
    // Orchestration — which seek to issue when, blob lifetime, element wiring —
    // stays in content.js, because it is inseparable from the <video> element.
    (() => {
      'use strict';

      const core = {};

      // Formats seconds as m:ss, h:mm:ss past an hour, with optional fractional
      // digits for the frame-accurate readout.
      core.formatTime = (seconds, decimals = 0) => {
        const zeroFraction = decimals ? `.${'0'.repeat(decimals)}` : '';
        if (!Number.isFinite(seconds) || seconds <= 0) return `0:00${zeroFraction}`;
        const minutes = Math.floor(seconds / 60);
        const wholeSeconds = String(Math.floor(seconds % 60)).padStart(2, '0');
        const secondsText = decimals
          ? `${wholeSeconds}.${String(Math.floor((seconds % 1) * 10 ** decimals)).padStart(decimals, '0')}`
          : wholeSeconds;
        return minutes >= 60
          ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${secondsText}`
          : `${minutes}:${secondsText}`;
      };

      // Snaps a measured frame rate to a standard one when it lands within
      // tolerance, so 29.98 is recognised as 29.97 rather than rounded to 30. An
      // unusual rate outside tolerance is returned unchanged rather than forced
      // onto the nearest candidate.
      core.snapFps = (raw, candidates, tolerance) => {
        if (!Number.isFinite(raw) || raw <= 0) return null;
        let best = raw;
        let bestError = Infinity;
        for (const candidate of candidates) {
          const error = Math.abs(candidate - raw) / candidate;
          if (error < bestError) {
            bestError = error;
            best = candidate;
          }
        }
        return bestError <= tolerance ? best : raw;
      };

      // The frame displayed at a given time. The epsilon absorbs float error from
      // a currentTime that landed a hair below a boundary.
      core.frameIndexAt = (time, fps) => Math.floor(time * fps + 1e-6);

      core.lastFrameIndexFor = (duration, fps) => Math.max(0, Math.round(duration * fps) - 1);

      // The centre of a frame, not its boundary. Seeking to a boundary lets float
      // rounding land on the neighbour; seeking to the centre cannot.
      core.frameCenter = (frame, fps) => (frame + 0.5) / fps;

      core.clampFrame = (frame, lastFrame) => Math.min(lastFrame, Math.max(0, frame));

      // Where a frame step should land. `base` is the pending intent when one
      // exists, otherwise the video's real position; `hasIntent` says which. A
      // target equal to an existing intent means there is nothing left to do.
      core.stepTarget = ({ base, pendingDelta, lastFrame, hasIntent }) => {
        const target = core.clampFrame(base + pendingDelta, lastFrame);
        if (target === base && hasIntent) return null;
        return target;
      };

      // How many frames a held-key scrub owes for the time just elapsed.
      //
      // The accumulator drains by the full owed count while only the capped count
      // is issued, which is what stops a decode stall from banking a backlog and
      // discharging it as a lurch. Falling behind makes the scrub move slower; it
      // never makes it jump.
      core.scrubSteps = ({ accumulator, elapsedMs, fps, rate, maxCatchup }) => {
        const msPerFrame = 1000 / (fps * rate);
        const total = accumulator + elapsedMs;
        const owed = Math.floor(total / msPerFrame);
        if (owed <= 0) return { steps: 0, accumulator: total };
        return { steps: Math.min(owed, maxCatchup), accumulator: total - owed * msPerFrame };
      };

      // End of the buffered range covering a time, which is how far seeking can go
      // without touching the network. `ranges` is a TimeRanges or anything with the
      // same length/start/end shape.
      core.bufferedEndNear = (ranges, time, tolerance = 0.25) => {
        if (!ranges) return 0;
        for (let i = 0; i < ranges.length; i++) {
          if (time >= ranges.start(i) - tolerance && time <= ranges.end(i)) return ranges.end(i);
        }
        return 0;
      };

      // Whether a new seek must wait. A seek into unbuffered data can pend forever
      // and never report completion, so past the stall window a new seek is allowed
      // to supersede it rather than wedging stepping and dragging permanently.
      core.isSeekBlocked = ({ inFlight, startedAt, now, stallMs }) =>
        Boolean(inFlight) && now - startedAt < stallMs;

      // What to do with a drag target. Three outcomes, not two: 'wait' leaves the
      // target pending for the next attempt, while 'redundant' consumes it without
      // seeking because the video is already there.
      core.dragSeekDecision = ({ blocked, dirty, target, currentTime, epsilon = 1e-4 }) => {
        if (blocked || !dirty || target === null || target === undefined) return 'wait';
        if (Math.abs(currentTime - target) < epsilon) return 'redundant';
        return 'seek';
      };


      // The slice of the video the seek bar should represent, as a transition from
      // the window currently in use rather than a fresh calculation each time.
      //
      // Stickiness is the point. The window changes only when it stops working:
      // when a marker falls outside it, when the loop has become too small a share
      // of it to aim at, or when the loop has grown large enough that zooming is
      // pointless. Anything else holds the current window.
      //
      // The thresholds are fractions of the bar, not absolute pixels, because an
      // absolute target can exceed the bar's own width — a 190px goal on a 150px
      // bar can never be met, which makes "needs more zoom" true forever and
      // rescales the bar on every pointer move. minGapPx only suppresses zooming on
      // a bar wide enough that the gap is already comfortable in absolute terms.
      core.nextTimelineView = ({
        current,
        loopIn,
        loopOut,
        duration,
        barWidthPx,
        minGapPx = 190,
        minFraction = 1 / 3,
        maxFraction = 0.9,
        targetFraction = 0.5,
        minWindowSeconds = 5,
        // A loop butted up against the end of the video has no room to its right:
        // the window stops at the media, so B lands exactly on the track's right
        // edge with nothing after it and cannot be grabbed. When B is within
        // endGuardSeconds of the end, the window is extended past the end of the
        // video by enough to leave endPaddingPx of empty track beyond it -- the
        // post-roll a clip trimmer leaves for the same reason.
        //
        // Widening the window in TIME instead was tried and is wrong: it pulls the
        // markers closer together (measured: 45px apart to 11px on a 150px track)
        // and still leaves B on the edge, because the window end is still the
        // media end.
        endGuardSeconds = 1,
        endPaddingPx = 20,
        disabled = false
      }) => {
        const full = {
          start: 0,
          end: Number.isFinite(duration) && duration > 0 ? duration : 0,
          zoomed: false,
          padSeconds: 0
        };
        if (disabled || !Number.isFinite(duration) || duration <= 0) return full;
        if (!Number.isFinite(loopIn) || !Number.isFinite(loopOut)) return full;
        // An unlaid-out bar has no meaningful pixel width; keep whatever is in use
        // rather than thrashing on a zero measurement.
        if (!Number.isFinite(barWidthPx) || barWidthPx <= 0) return current || full;

        const a = Math.min(loopIn, loopOut);
        const b = Math.max(loopIn, loopOut);
        const span = b - a;
        if (span <= 0) return full;

        const fractionOf = (windowWidth) => (windowWidth > 0 ? span / windowWidth : 0);
        // True when the loop sits so close to the end that the window cannot show
        // anything to its right.
        const nearEnd = duration - b < endGuardSeconds;
        // Seconds of window that render as endPaddingPx of track, given a window
        // whose own width includes that padding.
        const padFor = (unpaddedWidth) => {
          if (!nearEnd || !(barWidthPx > endPaddingPx) || !(unpaddedWidth > 0)) return 0;
          const share = endPaddingPx / barWidthPx;
          return (unpaddedWidth * share) / (1 - share);
        };
        // Zoom in only when the loop is both a small share of the bar and narrow in
        // absolute terms, so a very wide bar is left alone.
        const wantsMoreZoom = (windowWidth) => {
          const fraction = fractionOf(windowWidth);
          return fraction < minFraction && fraction * barWidthPx < minGapPx;
        };

        if (current && current.end > current.start) {
          const insideWindow = a >= current.start && b <= current.end;
          if (insideWindow) {
            // End padding is dead space past the media, so every judgement below is
            // made on the width that actually carries video. Measuring the padded
            // width instead meant a padded window could never satisfy the zoom cap
            // -- 5.77s against a 5s cap -- so a tight loop recomputed on every
            // single call and the timeline never settled.
            const pad = Number.isFinite(current.padSeconds) ? current.padSeconds : 0;
            const windowWidth = (current.end - current.start) - pad;
            if (windowWidth <= 0) return full;
            // The loop now fills the window, so the zoom is doing nothing.
            if (fractionOf(windowWidth) > maxFraction) return full;
            // A window established before B reached the end stops at the media, so
            // it has no room past B and must be recomputed rather than kept.
            const needsEndRoom = nearEnd && pad <= 0;
            // Padding that is no longer earned must go, or the timeline keeps
            // showing blank track past a loop that has moved back into the video.
            const staleEndRoom = !nearEnd && pad > 0;
            // Already comfortable, or as far in as the zoom cap allows: hold it.
            const atZoomCap = windowWidth <= minWindowSeconds + 1e-9;
            if (!needsEndRoom && !staleEndRoom && (!wantsMoreZoom(windowWidth) || atZoomCap)) return current;
          }
        } else if (!wantsMoreZoom(duration)) {
          return full;
        }

        // Size the window so the loop occupies targetFraction of it, which lands
        // comfortably above minFraction and so settles rather than zooming again.
        // minWindowSeconds caps how far in the bar will ever go.
        const width = Math.min(duration, Math.max(span / targetFraction, minWindowSeconds));
        const middle = (a + b) / 2;
        let start = middle - width / 2;
        let end = start + width;
        if (start < 0) {
          start = 0;
          end = width;
        }
        if (end > duration) {
          end = duration;
          start = Math.max(0, duration - width);
        }
        if (end - start <= 0) return full;
        // Whether this is a zoom is decided before padding, so a padded window at
        // the end of a short video does not start claiming to be zoomed.
        const zoomed = end - start < duration - 1e-9;
        // Leave grabbable track past the media end when B is up against it. The
        // amount is carried on the view so the stickiness checks above can tell
        // dead space apart from window width.
        const padSeconds = padFor(end - start);
        return { start, end: end + padSeconds, zoomed, padSeconds };
      };

      // Position within the current view, 0..1. Out-of-window times clamp to an
      // edge rather than running off it.
      core.timeToViewRatio = (time, view) => {
        const span = view.end - view.start;
        if (!(span > 0) || !Number.isFinite(time)) return 0;
        return Math.min(1, Math.max(0, (time - view.start) / span));
      };

      core.viewRatioToTime = (ratio, view) => {
        const span = view.end - view.start;
        if (!(span > 0)) return view.start || 0;
        return view.start + Math.min(1, Math.max(0, ratio)) * span;
      };

      // Chooses the first container the browser will actually record. Passing the
      // support check in keeps this testable without a MediaRecorder.
      core.pickRecorderMime = (candidates, isSupported) => {
        if (!Array.isArray(candidates) || typeof isSupported !== 'function') return null;
        for (const candidate of candidates) {
          try {
            if (isSupported(candidate)) return candidate;
          } catch (e) {
            // A malformed candidate should be skipped, not fatal.
          }
        }
        return null;
      };

      // Filename for an exported clip: site, video identifier where the path offers
      // one, and the loop bounds, so saved clips sort and identify themselves.
      core.clipFilename = (hostname, pathname, start, end, extension = 'webm') => {
        const site = core.resolveSiteKey(hostname) || 'video';
        const slug = typeof pathname === 'string'
          ? (pathname.match(/\/(?:p|reel|reels|watch|tv)\/([A-Za-z0-9_-]{3,})/) || [])[1] || ''
          : '';
        const stamp = (n) => (Number.isFinite(n) && n >= 0 ? n.toFixed(2).replace('.', 'p') : '0p00');
        const parts = [site];
        if (slug) parts.push(slug);
        parts.push(`${stamp(start)}-${stamp(end)}`);
        return `${parts.join('-')}.${extension}`;
      };

      // Reads loop times out of a URL fragment, in the form
      //   #loop=<start>,<end>[,<rate>]
      // Tolerant on purpose: accepts a bare fragment or one parameter among several,
      // accepts the markers in either order, and rejects anything it cannot read
      // rather than guessing.
      core.parseLoopFromUrl = (input) => {
        if (typeof input !== 'string' || !input) return null;
        const hashIndex = input.indexOf('#');
        const fragment = hashIndex >= 0 ? input.slice(hashIndex + 1) : input;
        if (!fragment) return null;

        let raw = null;
        for (const part of fragment.split('&')) {
          const eq = part.indexOf('=');
          if (eq < 0) continue;
          if (part.slice(0, eq).trim().toLowerCase() !== 'loop') continue;
          try {
            raw = decodeURIComponent(part.slice(eq + 1));
          } catch (e) {
            raw = part.slice(eq + 1);
          }
        }
        if (!raw) return null;

        const pieces = raw.split(',').map((piece) => Number(piece.trim()));
        const [start, end, rate] = pieces;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (start < 0 || end < 0) return null;
        const a = Math.min(start, end);
        const b = Math.max(start, end);
        if (b - a <= 0) return null;

        const parsed = { start: a, end: b };
        if (pieces.length > 2 && Number.isFinite(rate) && rate > 0) parsed.rate = rate;
        return parsed;
      };

      // Builds a shareable URL for a loop, replacing any fragment already present.
      // A rate of 1 is left out, since it is the default and only adds noise.
      core.formatLoopUrl = (href, loopIn, loopOut, rate) => {
        if (typeof href !== 'string' || !href) return null;
        if (!Number.isFinite(loopIn) || !Number.isFinite(loopOut)) return null;
        const a = Math.min(loopIn, loopOut);
        const b = Math.max(loopIn, loopOut);
        if (b - a <= 0 || a < 0) return null;
        const round = (n) => Number(n.toFixed(2));
        const parts = [round(a), round(b)];
        if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 1e-9) parts.push(round(rate));
        return `${href.split('#')[0]}#loop=${parts.join(',')}`;
      };

      // Keeps a playback rate inside what browsers accept. Assigning a rate outside
      // this range throws, so an out-of-range or malformed value falls back rather
      // than taking the player down.
      core.clampPlaybackRate = (rate, fallback = 1, min = 0.0625, max = 16) => {
        const n = Number(rate);
        if (!Number.isFinite(n) || n <= 0) return fallback;
        return Math.min(max, Math.max(min, n));
      };

      // Clamps a dragged loop marker so it stays inside the media and cannot cross
      // the other marker: an in point stops minFrames short of the out point, and
      // vice versa. Returns null when the video is not ready.
      core.clampMarker = ({ value, other, which, duration, fps, minFrames = 3 }) => {
        if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return null;
        if (!Number.isFinite(fps) || fps <= 0) return null;
        const minSpan = minFrames / fps;
        let next = value;
        if (Number.isFinite(other)) {
          next = which === 'in' ? Math.min(next, other - minSpan) : Math.max(next, other + minSpan);
        }
        return Math.max(0, Math.min(next, duration));
      };

      // Normalises a loop range. Markers can be set in either order, so these are
      // sorted rather than rejected, and clamped to the media. A range shorter than
      // minFrames is returned as null: looping over one or two frames thrashes the
      // decoder and shows nothing useful.
      core.normalizeLoop = ({ start, end, duration, fps, minFrames = 3 }) => {
        if (!Number.isFinite(duration) || duration <= 0) return null;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (!Number.isFinite(fps) || fps <= 0) return null;
        const a = Math.max(0, Math.min(Math.min(start, end), duration));
        const b = Math.max(0, Math.min(Math.max(start, end), duration));
        // Compared in frames with a tolerance, because float error makes an exactly
        // minFrames-long span measure a hair short: 5 + 3/30 - 5 is 0.0999...,
        // which would silently refuse a loop the user legitimately marked.
        if ((b - a) * fps < minFrames - 1e-6) return null;
        return { start: a, end: b };
      };

      // Whether a playing video has reached the end of its loop. The epsilon lands
      // the restart a touch early rather than overshooting past the out point, which
      // would show a frame the user excluded.
      core.loopShouldRestart = ({ currentTime, loopEnd, paused, epsilon = 0.015 }) => {
        if (paused || !Number.isFinite(currentTime) || !Number.isFinite(loopEnd)) return false;
        return currentTime >= loopEnd - epsilon;
      };

      // Whether a slider's aria-valuetext looks like a media position ("0:44 of
      // 1:45"), which is how a progress slider is told apart from a volume one
      // without depending on a localised aria-label. The timestamp format is
      // numeric, so this survives translation where an English label would not.
      core.looksLikeTimeSlider = (valueText) => {
        if (typeof valueText !== 'string') return false;
        return (valueText.match(/\d{1,2}:\d{2}/g) || []).length >= 1;
      };

      // Which site adapter a hostname belongs to, or null when unsupported.
      // Matched on exact host or a dot-prefixed suffix so that a lookalike such as
      // notinstagram.com or instagram.com.example.net never resolves.
      core.resolveSiteKey = (hostname) => {
        if (typeof hostname !== 'string' || !hostname) return null;
        const host = hostname.toLowerCase();
        if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
        if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
        return null;
      };

      if (typeof module === 'object' && module.exports) module.exports = core;
      else if (typeof window !== 'undefined') window.__igVcCore = core;
    })();

  }

  // --- content/content.js ----------------------------------------------------
  function loadContent() {
    (() => {
      'use strict';

      window.__igVcCleanup?.();
      for (const el of document.querySelectorAll('.ig-vc-bar')) el.remove();
      for (const el of document.querySelectorAll('.ig-vc-player')) el.classList.remove('ig-vc-player', 'ig-vc-kb');
      for (const el of document.querySelectorAll('.ig-vc-host')) el.classList.remove('ig-vc-host');
      for (const el of document.querySelectorAll('.ig-vc-series-overlay')) el.classList.remove('ig-vc-series-overlay');

      // Touch mode (iPhone/iPad Safari): there is no hover to reveal the bar and no
      // keyboard for frame stepping, so on a coarse pointer without hover the bar is
      // revealed by tapping the player, stays up while paused, gets finger-sized
      // targets, opens its popups on tap, and gains on-screen frame-step buttons
      // (tap = one frame, hold = scrub, mirroring the arrow keys).
      const TOUCH = Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches);
      document.documentElement.classList.toggle('ig-vc-touch', TOUCH);
      // iOS Safari has no HTMLMediaElement.captureStream, so clip export cannot work.
      document.documentElement.classList.toggle('ig-vc-no-clip', typeof HTMLMediaElement.prototype.captureStream !== 'function');

      const DEFAULT_SETTINGS = { volume: 1, muted: false, playbackRate: 1 };
      // One speed control, not two. The loop used to carry its own slow-biased menu
      // and its own rate, which meant two speed menus a step apart in the same bar.
      // The slow end moved here so nothing is out of reach: 0.1x and 0.25x were
      // only ever available inside the loop menu, and they are the whole point on a
      // fast dance move.
      const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

      // Frame stepping
      const DEFAULT_FPS = 30;
      const FPS_CANDIDATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
      const FPS_SNAP_TOLERANCE = 0.02;
      const FPS_MIN_SAMPLES = 4;
      const FPS_MAX_SAMPLES = 24;
      const KEYBOARD_REVEAL_MS = 4000;
      const SEEK_STALL_MS = 1000;

      // A-B loop, for practising a single move
      const LOOP_MIN_FRAMES = 3;
      // ~2 inches at 96dpi: the point below which two handles are too close to aim
      // at individually. Unzoom only once they are much further apart, so the bar
      // does not flip back and forth around a single threshold.
      const ZOOM_MIN_GAP_PX = 190;
      // The trigger sits well below the target so each zoom buys a factor of 2.5 in
      // span before another is needed, which keeps the number of discrete steps
      // across a long drag small. At 20% of a 150px bar the handles are still ~30px
      // apart, comfortably aimable for 9px handles.
      const ZOOM_MIN_FRACTION = 0.2;
      const ZOOM_MAX_FRACTION = 0.9;
      const ZOOM_TARGET_FRACTION = 0.5;
      const ZOOM_MIN_WINDOW_SECONDS = 5;
      // A B marker within this much of the end of the video would sit exactly on the
      // track's right edge, where it cannot be grabbed. The timeline is extended
      // past the end of the video by enough to leave this many pixels of track
      // beyond it, the way a clip trimmer leaves post-roll.
      // Long enough that dragging a handle writes once on settling rather than on
      // every pointer move.
      const URL_WRITE_DEBOUNCE_MS = 400;
      const ZOOM_END_GUARD_SECONDS = 1;
      const ZOOM_END_PADDING_PX = 20;
      const KEYS_LOOP_IN = new Set(['[', '{']);
      const KEYS_LOOP_OUT = new Set([']', '}']);
      const KEYS_LOOP_TOGGLE = new Set(['\\']);
      const KEYS_LOOP_RESTART = new Set(['Home']);
      const KEYS_LOOP_CLEAR = new Set(['|']);
      const KEYS_THEATER = new Set(['t', 'T']);
      const SHIFT_FRAME_MULTIPLIER = 10;
      const KEYS_FRAME_BACK = new Set(['ArrowLeft']);
      const KEYS_FRAME_FORWARD = new Set(['ArrowRight']);
      const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

      // Held-key scrubbing
      const HOLD_DELAY_MS = 180;
      // Touch loop painting on the seek track: long-press sets A under the finger,
      // the track zooms to ±PAINT_WINDOW_SECONDS around it, dragging previews frames
      // and lifting the finger sets B and starts the loop.
      // Dragging a handle to the edge of a zoomed window used to stop dead. The view
      // is frozen during a drag -- deliberately, because recomputing it mid-drag made
      // the handle chase the pointer -- so the furthest B could reach was the
      // window's right edge. Measured: held at the edge for 2.4s, B stayed put at
      // 0:23.51 in an 0:18-0:23 window on a 105s video.
      //
      // Holding near an edge now pans the window that way. The pan is driven by
      // ELAPSED TIME, not by the pointer's position, which is what keeps it out of
      // the feedback loop that made freezing necessary in the first place.
      const EDGE_PAN_ZONE_PX = 24;
      const EDGE_PAN_PER_SEC = 0.6;      // fraction of the visible window per second
      const EDGE_PAN_MIN_PER_SEC = 1.5;  // seconds of media per second, floor for a tight window
      const LONG_PRESS_MS = 450;
      const LONG_PRESS_SLOP_PX = 10;
      const PAINT_WINDOW_SECONDS = 10;
      // A long-press alone makes a loop of this length starting under the finger;
      // dragging before lifting replaces the default B with the finger's position.
      const DEFAULT_LOOP_SECONDS = 5;
      const SCRUB_RATE_NORMAL = 0.5;
      const SCRUB_RATE_FAST = 2;
      const SCRUB_MAX_CATCHUP_FRAMES = 3;


      // Official Lucide v1.61.0 icon paths
      const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
      const SPEAKER = `<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>`;
      const ICONS = {
        play: svg(`<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>`),
        pause: svg(`<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>`),
        volumeX: svg(`${SPEAKER}<path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>`),
        volume: svg(SPEAKER),
        volume1: svg(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/>`),
        volume2: svg(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`),
        maximize: svg(`<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`),
        minimize: svg(`<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>`),
        // Original thin-stroke glyph for the clip export control, matching the set above
        download: svg(`<path d="M12 4v11"/><path d="m7 12 5 5 5-5"/><path d="M5 20h14"/>`),
        loop: svg(`<path d="M3 11V9a4 4 0 0 1 4-4h11"/><path d="m15 2 3 3-3 3"/><path d="M21 13v2a4 4 0 0 1-4 4H6"/><path d="m9 22-3-3 3-3"/>`),
        link: svg(`<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>`),
        restart: svg(`<path d="M6 5v14"/><path d="M20 5 9 12l11 7z"/>`)
      };

      let settings = { ...DEFAULT_SETTINGS };
      const controllers = new Map();

      // Pure logic lives in content/core.js, loaded as the first content script, so
      // the code the extension runs is the same code the test suite exercises.
      const core = window.__igVcCore;

      const formatTime = (s, decimals = 0) => core.formatTime(s, decimals);

      const snapFps = (raw) => core.snapFps(raw, FPS_CANDIDATES, FPS_SNAP_TOLERANCE);

      // Learns a video's true frame rate from presented-frame metadata, since HTML5
      // video exposes no frame rate of its own. requestVideoFrameCallback only fires
      // when a frame is actually painted, so samples arrive during playback and after
      // each seek; until enough land, callers fall back to DEFAULT_FPS.
      function createFrameClock(video) {
        const supported = typeof video.requestVideoFrameCallback === 'function';
        let deltas = [];
        let fps = null;
        let handle = null;
        let prevMediaTime = null;
        let prevPresentedFrames = null;
        let stopped = false;

        const schedule = () => {
          if (stopped || !supported || handle !== null) return;
          try { handle = video.requestVideoFrameCallback(onFrame); } catch (e) {}
        };

        function onFrame(_now, metadata) {
          handle = null;
          const mediaTime = metadata?.mediaTime;
          const presentedFrames = metadata?.presentedFrames;
          // Only frames painted during real playback describe the frame grid. A seek
          // presents a single frame however far it jumped, so sampling while paused or
          // seeking would confirm whatever rate we already assumed instead of the truth.
          const trustworthy = !video.paused && !video.seeking;
          if (trustworthy && Number.isFinite(mediaTime) && Number.isFinite(presentedFrames) && prevMediaTime !== null) {
            // presentedFrames jumps by more than 1 when frames are dropped, so divide
            // the elapsed media time by the frames actually covered.
            const frameSpan = presentedFrames - prevPresentedFrames;
            const timeSpan = mediaTime - prevMediaTime;
            // Only short forward gaps are usable; stalls and leftover seeks are not.
            if (frameSpan > 0 && timeSpan > 1e-4 && timeSpan < 0.5) {
              deltas.push(timeSpan / frameSpan);
              if (deltas.length > FPS_MAX_SAMPLES) deltas.shift();
              if (deltas.length >= FPS_MIN_SAMPLES) {
                const sorted = [...deltas].sort((a, b) => a - b);
                const median = sorted[sorted.length >> 1];
                if (median > 0) fps = snapFps(1 / median);
              }
            }
          }
          prevMediaTime = trustworthy && Number.isFinite(mediaTime) ? mediaTime : null;
          prevPresentedFrames = trustworthy && Number.isFinite(presentedFrames) ? presentedFrames : null;
          schedule();
        }

        schedule();

        return {
          get fps() { return fps || DEFAULT_FPS; },
          get measured() { return fps !== null; },
          // Instagram recycles <video> elements across posts, so a new source
          // invalidates everything learned about the previous one.
          reset() {
            deltas = [];
            fps = null;
            prevMediaTime = null;
            prevPresentedFrames = null;
            schedule();
          },
          stop() {
            stopped = true;
            if (handle !== null) {
              try { video.cancelVideoFrameCallback(handle); } catch (e) {}
              handle = null;
            }
          }
        };
      }

      async function saveSettings(partial) {
        settings = { ...settings, ...partial };
        for (const ctrl of controllers.values()) ctrl.sync();
        try { await chrome.storage.local.set(partial); } catch (e) {}
      }

      const NATIVE_CONTROLS_SELECTOR = [
        '[aria-label="Video progress"]',
        '[role="slider"][aria-valuetext]',
        '[aria-label="Enter fullscreen"]',
        '[aria-label="Exit fullscreen"]'
      ].join(', ');

      // Per-site adapters. Everything site-specific lives here; the rest of the file
      // reads policy off the resolved adapter and otherwise does not care which site
      // it is on.
      //
      // 'replace' mode mounts the full control bar, because Instagram ships almost no
      // controls and there is nothing to compete with. 'augment' mode leaves the
      // site's own controls alone and contributes only what they lack — frame
      // stepping, jog scrubbing and the frame readout — which is the right posture on
      // Facebook, where a full player already exists.
      // A loop shared by URL belongs to the video the link was opened for, so it is
      // consumed by the first player able to accept it rather than applied to every
      // video in a feed. The launch URL is read from the document_start capture,
      // falling back to the live location where the site has not rewritten it.
      let pendingUrlLoop = core.parseLoopFromUrl(window.__igVcLaunchUrl?.hash || location.hash);

      // Exported loop clips. Recording is real time and captures the element's
      // rendered output, since both sites stream through MediaSource and there is no
      // file to slice. Verified on a live Reel: captureStream yields live audio and
      // video tracks, and MediaRecorder produces a decodable 540x960 WebM.
      const CLIP_MIME_CANDIDATES = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      const CLIP_MAX_SECONDS = 60;
      const CLIP_LEAD_IN_MS = 350;
      const CLIP_TITLES = {
        idle: 'Record this loop and save it as a clip',
        recording: 'Recording the loop in real time — click to cancel',
        unavailable: 'Set both A and B to export a clip',
        unsupported: 'This browser cannot record from a video element',
        error: 'Recording failed — click to retry'
      };

      // Theater overlay: covers the page so only the video is visible, while leaving
      // the browser's own chrome alone. Requested in preference to real fullscreen,
      // which hides the tabs and address bar; this is a page-level overlay, so the
      // browser stays exactly as it is. Also where a freshly recorded clip opens.
      let theaterEl = null;
      // When the overlay adopts the live player instead of playing a standalone
      // file, this records where to put it back.
      let theaterAdopted = null;

      const downloadUrl = (url, filename) => {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
      };

      const onTheaterKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        closeTheater();
      };

      function closeTheater() {
        if (!theaterEl) return;
        // Put an adopted player back exactly where it was, before the overlay goes.
        if (theaterAdopted) {
          const { element, parent, nextSibling } = theaterAdopted;
          element.classList.remove('ig-vc-theater-adopted');
          // The overlay set this to make the box track the picture; the page's own
          // layout must not inherit it.
          element.style.removeProperty('aspect-ratio');
          if (parent && parent.isConnected) parent.insertBefore(element, nextSibling || null);
          theaterAdopted = null;
        }
        const held = theaterEl.querySelector('.ig-vc-theater-video');
        if (held) {
          held.pause();
          held.removeAttribute('src');
          held.load();
        }
        // Leaving real fullscreen first, or the browser is left in fullscreen with
        // nothing in it.
        if (document.fullscreenElement === theaterEl) document.exitFullscreen().catch(() => {});
        // Only a blob we created gets revoked; a page URL must be left alone.
        const revoke = theaterEl.dataset.revokeUrl;
        theaterEl.remove();
        theaterEl = null;
        document.removeEventListener('keydown', onTheaterKey, true);
        document.removeEventListener('fullscreenchange', onTheaterFullscreenChange);
        if (revoke) URL.revokeObjectURL(revoke);
      }

      function onTheaterFullscreenChange() {
        if (!theaterEl) return;
        const button = theaterEl.querySelector('.ig-vc-theater-fs');
        if (!button) return;
        const isFull = document.fullscreenElement === theaterEl;
        button.textContent = isFull ? 'exit fullscreen' : 'fullscreen';
        button.title = isFull
          ? 'Leave real fullscreen and go back to covering the page'
          : 'Enter real browser fullscreen, hiding the tabs and address bar too';
      }

      // Two modes. `adopt` relocates the live player into the overlay, which is the
      // only way to show a MediaSource-backed video: its blob URL can be attached
      // to exactly one element, so a second <video> pointed at the same URL loads
      // nothing. `src` plays a standalone file, which is how a recorded clip opens.
      function openTheater({ adopt = null, src = null, revokeUrl = null, filename = null, label = '' }) {
        closeTheater();
        theaterEl = document.createElement('div');
        theaterEl.className = 'ig-vc-theater';
        if (revokeUrl) theaterEl.dataset.revokeUrl = revokeUrl;
        theaterEl.innerHTML = `
          <div class="ig-vc-theater-bar">
            <span class="ig-vc-theater-label"></span>
            <span class="ig-vc-theater-actions">
              <button type="button" class="ig-vc-theater-save"></button>
              <button type="button" class="ig-vc-theater-fs">fullscreen</button>
              <button type="button" class="ig-vc-theater-close">close</button>
            </span>
          </div>
          <div class="ig-vc-theater-stage"></div>
        `;
        theaterEl.querySelector('.ig-vc-theater-label').textContent = label;
        const stage = theaterEl.querySelector('.ig-vc-theater-stage');
        const saveBtn = theaterEl.querySelector('.ig-vc-theater-save');
        if (filename && src) {
          saveBtn.textContent = 'save again';
          saveBtn.addEventListener('click', () => downloadUrl(src, filename));
        } else {
          saveBtn.remove();
        }
        // Real fullscreen lives here rather than on the bar. A click inside the
        // overlay is a fresh user gesture, which is what requestFullscreen needs —
        // and what a recording several seconds long no longer has when it finishes.
        theaterEl.querySelector('.ig-vc-theater-fs').addEventListener('click', () => {
          if (document.fullscreenElement === theaterEl) document.exitFullscreen().catch(() => {});
          else theaterEl.requestFullscreen().catch(() => {});
        });
        theaterEl.querySelector('.ig-vc-theater-close').addEventListener('click', closeTheater);
        // Clicking the backdrop dismisses, but a click on the stage must not.
        theaterEl.addEventListener('click', (e) => {
          if (e.target === theaterEl) closeTheater();
        });
        document.body.appendChild(theaterEl);

        if (adopt) {
          // Relocating the player brings our own control bar with it, so the loop
          // controls stay available in theater mode.
          theaterAdopted = { element: adopt, parent: adopt.parentElement, nextSibling: adopt.nextSibling };
          adopt.classList.add('ig-vc-theater-adopted');
          stage.appendChild(adopt);
          // The stylesheet fills the stage's height; this supplies the width, by
          // giving the box the video's own proportions. Without it the box is as
          // wide as the stage, so the bar stretches across the letterboxing
          // instead of sitting under the picture.
          const fitAdoptedBox = () => {
            if (!theaterAdopted || theaterAdopted.element !== adopt) return false;
            const media = adopt.querySelector('video');
            const w = media ? media.videoWidth : 0;
            const h = media ? media.videoHeight : 0;
            if (!w || !h) return false;
            adopt.style.aspectRatio = `${w} / ${h}`;
            return true;
          };
          // Dimensions are zero until the first frame is decoded, which on a paused
          // video that was never played has not happened yet.
          if (!fitAdoptedBox()) {
            const media = adopt.querySelector('video');
            if (media) {
              const onReady = () => {
                // Stop listening once the box is sized, and also if the overlay
                // closed first: the video outlives the overlay, so a listener left
                // on it would leak one pair per open.
                const stale = !theaterAdopted || theaterAdopted.element !== adopt;
                if (fitAdoptedBox() || stale) {
                  media.removeEventListener('loadedmetadata', onReady);
                  media.removeEventListener('resize', onReady);
                }
              };
              media.addEventListener('loadedmetadata', onReady);
              media.addEventListener('resize', onReady);
            }
          }
        } else if (src) {
          const held = document.createElement('video');
          held.className = 'ig-vc-theater-video';
          held.controls = true;
          held.loop = true;
          held.playsInline = true;
          held.src = src;
          stage.appendChild(held);
          held.play().catch(() => {});
        }

        document.addEventListener('keydown', onTheaterKey, true);
        document.addEventListener('fullscreenchange', onTheaterFullscreenChange);
        onTheaterFullscreenChange();
      }

      const SITE_ADAPTERS = {
        instagram: {
          mode: 'replace',
          // Walks up until the subtree would cover more than one video, stopping at
          // Instagram's own player markers.
          playerContainer(video) {
            let cur = video.parentElement;
            let best = cur;
            for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
              if (cur.querySelectorAll('video').length > 1) break;
              best = cur;
              if (cur.querySelector('[data-instancekey], [role="group"][aria-label="Video player"]')) break;
              cur = cur.parentElement;
            }
            return best;
          },
          // A player that already has its own seek or fullscreen affordance is left
          // untouched, so the bar never doubles up on Instagram's native controls.
          hasNativeControls(video, root) {
            const scope = root || video.closest('article, [role="dialog"], [role="presentation"]') || video.parentElement;
            if (!scope) return false;
            return Boolean(scope.querySelector(NATIVE_CONTROLS_SELECTOR))
              || scope.querySelectorAll('[role="slider"]').length > 1;
          },
          skipPath: (pathname) => pathname.startsWith('/stories/'),
          findSeriesOverlay,
          nativeSeekSlider: () => null
        },

        facebook: {
          // Replace mode, same as Instagram: the full bar at the bottom of the
          // player with Facebook's own progress slider hidden. This was augment
          // mode -- a stripped bar pinned to the top-left, leaving their controls
          // alone -- which kept the loop tools available without fighting the site
          // but left Facebook feeling like a second-class citizen.
          //
          // The reason augment mode was chosen no longer holds. Facebook used to
          // revert `volume` within about a second, which would have made our volume
          // slider look broken; re-measured on a live Reel it now holds 0.3 across
          // twelve samples over three seconds, and `playbackRate` and `muted` stick
          // as they always did.
          mode: 'replace',
          // Verified against a live Reel: data-video-id is the stable per-video
          // anchor, it is already position:relative, it contains exactly one video
          // and — unlike the ancestors above it — none of Facebook's own sliders.
          // Walking further up the way Instagram does reaches Facebook's progress
          // slider and would wrongly look like a competing player.
          playerContainer(video) {
            return video.closest('[data-video-id]') || video.parentElement;
          },
          // Augment mode never suppresses itself: Facebook's controls are expected to
          // be present and are deliberately left in place alongside the readout.
          hasNativeControls: () => false,
          skipPath: (pathname) => pathname.startsWith('/stories/'),
          findSeriesOverlay: () => null,
          // Facebook's progress slider lives just outside the data-video-id anchor,
          // so this walks up a few levels from the container. Identified by a
          // position-looking aria-valuetext rather than its English aria-label, with
          // "the only slider in scope" as the structural fallback.
          nativeSeekSlider(video, container) {
            let cur = container;
            for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
              if (cur.querySelectorAll('video').length > 1) break;
              const sliders = [...cur.querySelectorAll('[role="slider"]')];
              const byValueText = sliders.find((s) => core.looksLikeTimeSlider(s.getAttribute('aria-valuetext')));
              if (byValueText) return byValueText;
              if (sliders.length === 1) return sliders[0];
              cur = cur.parentElement;
            }
            return null;
          },

          // Our bar sits at the bottom of the player, which is exactly where
          // Facebook draws its progress slider -- measured at the video's last
          // 20px -- so the two would overlap. Theirs is hidden.
          //
          // Found structurally rather than by aria-label, so it survives a
          // non-English UI: from the time-like slider, walk up while the ancestor
          // contains no buttons and no video. On a live Reel that stops at a
          // 654x20 strip holding nothing but the progress bar; one level higher is
          // the whole 670x1191 player with 29 buttons in it, which must not be
          // touched.
          //
          // Their mute button is deliberately left alone: it is a 44x44 overlay in
          // the TOP-left corner, so it does not collide with our bar, and the only
          // handle on it is its English label.
          nativeControlsToHide(video, container) {
            const slider = this.nativeSeekSlider(video, container);
            if (!slider) return [];
            // Only ascend while the ancestor is still plainly just the progress
            // strip. The height ceiling is the load-bearing guard: the strip is
            // 20px of a 1191px player (measured), so anything approaching the
            // player's own height is not a control strip whatever else it contains.
            const videoHeight = video.getBoundingClientRect().height || 0;
            const ceiling = videoHeight > 0 ? videoHeight * 0.25 : Infinity;
            let outermost = slider;
            let cur = slider.parentElement;
            for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
              if (cur.contains(video)) break;
              if (cur.querySelector('video')) break;
              if (cur.querySelector('[role="button"], button')) break;
              if (cur.getBoundingClientRect().height > ceiling) break;
              outermost = cur;
              cur = cur.parentElement;
            }
            return [outermost];
          }
        }
      };

      const siteKey = core.resolveSiteKey(location.hostname);
      const site = SITE_ADAPTERS[siteKey];
      const augmenting = site?.mode === 'augment';

      function resolvePlayerContainer(video) {
        return site.playerContainer(video);
      }

      function hasNativeControls(video, root = resolvePlayerContainer(video)) {
        return site.hasNativeControls(video, root);
      }

      function ensureRelativeContainer(container) {
        if (container && getComputedStyle(container).position === 'static') container.style.position = 'relative';
        return container;
      }

      function findSeriesOverlay(container) {
        let cur = container;
        for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
          if (cur.querySelectorAll('video').length > 1) break;
          for (const link of cur.querySelectorAll('a[href*="/series/"][href*="/watch"]')) {
            if (!/\/series\/[^/]+\/watch\b/.test(link.getAttribute('href') || '')) continue;
            let overlay = link;
            while (overlay.parentElement && overlay.parentElement !== cur) {
              overlay = overlay.parentElement;
            }
            const pos = getComputedStyle(overlay).position;
            if (pos !== 'absolute' && pos !== 'fixed') continue;
            return { host: cur, overlay };
          }
          cur = cur.parentElement;
        }
        return null;
      }

      function bindSlider(el, isVertical, onInput, onStart, onEnd) {
        const track = el.querySelector('.ig-vc-track') || el;
        const calc = (e) => {
          const r = track.getBoundingClientRect();
          const raw = isVertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width;
          return Math.min(1, Math.max(0, raw || 0));
        };
        const setDrag = (active) => {
          el.closest('.ig-vc-player')?.classList.toggle('dragging', active);
          el.closest('.ig-vc-wrap')?.classList.toggle('dragging', active);
        };
        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          el.setPointerCapture(e.pointerId);
          setDrag(true);
          onStart?.();
          onInput(calc(e));
        });
        el.addEventListener('pointermove', (e) => {
          if (el.hasPointerCapture(e.pointerId)) onInput(calc(e));
        });
        for (const evt of ['pointerup', 'pointercancel']) {
          el.addEventListener(evt, (e) => {
            if (!el.hasPointerCapture(e.pointerId)) return;
            el.releasePointerCapture(e.pointerId);
            setDrag(false);
            onEnd?.();
          });
        }
        return () => el.closest('.ig-vc-player')?.classList.contains('dragging');
      }

      function attachVideo(video) {
        if (hasNativeControls(video)) {
          if (controllers.has(video)) {
            controllers.get(video).destroy();
            controllers.delete(video);
          }
          return;
        }
        if (controllers.has(video)) return controllers.get(video).mount();

        const ac = new AbortController();
        const { signal } = ac;
        const bar = document.createElement('div');
        bar.className = augmenting ? 'ig-vc-bar ig-vc-augment' : 'ig-vc-bar';
        bar.innerHTML = `
          <button type="button" class="ig-vc-btn ig-vc-loop-restart"></button>
          <button type="button" class="ig-vc-btn ig-vc-play"></button>
          <button type="button" class="ig-vc-btn ig-vc-step ig-vc-step-back" title="Back one frame (hold to scrub)">${svg('<path d="M6 5v14"/><path d="M18 6l-8 6 8 6z"/>')}</button>
          <button type="button" class="ig-vc-btn ig-vc-step ig-vc-step-fwd" title="Forward one frame (hold to scrub)">${svg('<path d="M18 5v14"/><path d="M6 6l8 6-8 6z"/>')}</button>
          <span class="ig-vc-time">0:00 / 0:00</span>
          <div class="ig-vc-seek"><div class="ig-vc-track"><div class="ig-vc-buffer"></div><div class="ig-vc-loop-span"></div><div class="ig-vc-fill"></div></div><div class="ig-vc-playhead"></div><div class="ig-vc-handle ig-vc-handle-a"></div><div class="ig-vc-handle ig-vc-handle-b"></div><div class="ig-vc-hint"></div></div>
          <div class="ig-vc-wrap">
            <button type="button" class="ig-vc-btn ig-vc-mute"></button>
            <div class="ig-vc-popup"><div class="ig-vc-box">
              <div class="ig-vc-vol"><div class="ig-vc-track"><div class="ig-vc-fill"></div></div></div>
            </div></div>
          </div>
          <div class="ig-vc-wrap">
            <button type="button" class="ig-vc-btn ig-vc-speed-btn">1x</button>
            <div class="ig-vc-popup"><div class="ig-vc-box ig-vc-speed-box">
              ${SPEEDS.map((s) => `<button type="button" class="ig-vc-opt" data-speed="${s}">${s}x</button>`).join('')}
            </div></div>
          </div>
          <div class="ig-vc-wrap ig-vc-loop-wrap">
            <button type="button" class="ig-vc-btn ig-vc-loop-toggle"></button>
            <div class="ig-vc-popup"><div class="ig-vc-box ig-vc-loop-box">
              <button type="button" class="ig-vc-opt ig-vc-loop-onoff">loop</button>
              <button type="button" class="ig-vc-opt ig-vc-loop-in">A</button>
              <button type="button" class="ig-vc-opt ig-vc-loop-out">B</button>
              <button type="button" class="ig-vc-opt ig-vc-loop-clear">clr</button>
              <button type="button" class="ig-vc-opt ig-vc-clip">clip</button>
              <button type="button" class="ig-vc-opt ig-vc-loop-zoom">fit</button>
            </div></div>
          </div>
          <button type="button" class="ig-vc-btn ig-vc-loop-link"></button>
          <button type="button" class="ig-vc-btn ig-vc-fs"></button>
        `;

        const [loopRestartBtn, playBtn, timeEl, seekEl, muteBtn, volEl, speedBtn, loopInBtn, loopOutBtn, loopToggleBtn, clipBtn, fsBtn] = [
          '.ig-vc-loop-restart', '.ig-vc-play', '.ig-vc-time', '.ig-vc-seek', '.ig-vc-mute', '.ig-vc-vol', '.ig-vc-speed-btn',
          '.ig-vc-loop-in', '.ig-vc-loop-out', '.ig-vc-loop-toggle', '.ig-vc-clip', '.ig-vc-fs'
        ].map((sel) => bar.querySelector(sel));
        const loopClearBtn = bar.querySelector('.ig-vc-loop-clear');
        const loopOnOffBtn = bar.querySelector('.ig-vc-loop-onoff');
        const stepBackBtn = bar.querySelector('.ig-vc-step-back');
        const stepFwdBtn = bar.querySelector('.ig-vc-step-fwd');
        const loopZoomBtn = bar.querySelector('.ig-vc-loop-zoom');
        // Promoted to the bar: sharing a loop is the common action, exporting a
        // clip the rare one, so the bar slot the clip button held is now the link.
        const loopLinkBtn = bar.querySelector('.ig-vc-loop-link');
        const hintEl = bar.querySelector('.ig-vc-hint');
        const handleA = bar.querySelector('.ig-vc-handle-a');
        const handleB = bar.querySelector('.ig-vc-handle-b');
        const seekTrack = seekEl.querySelector('.ig-vc-track');
        // Only the general speed options, which are the ones carrying data-speed.
        // Matching every .ig-vc-opt also caught the loop popup's buttons -- A, B,
        // clr, link, fit and the loop speeds -- so clicking any of them ran
        // saveSettings({ playbackRate: Number(undefined) }) and persisted NaN,
        // silently resetting the user's chosen speed to 1x.
        const speedOpts = bar.querySelectorAll('.ig-vc-opt[data-speed]');

        for (const evt of ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart']) {
          bar.addEventListener(evt, (e) => { e.stopPropagation(); e.preventDefault(); });
        }

        const frameClock = createFrameClock(video);
        let frameMode = false;
        let revealTimer = null;
        // Held-key stepping collapses into one in-flight seek at a time, so intent has
        // to be tracked separately from video.currentTime, which lags behind it.
        let intendedFrame = null;
        let pendingDelta = 0;
        let seekInFlight = false;
        let preloadNudged = false;
        // Dragging the seek bar wants the newest pointer position, not every position
        // it passed through. dragTargetTime holds the last one asked for and doubles as
        // the "a seek drag is in progress" flag; dragDirty says it has not been honoured.
        let dragTargetTime = null;
        let dragDirty = false;
        let seekStartedAt = 0;

        // A seek into unbuffered data can pend indefinitely and its `seeked` may never
        // arrive. Without this, one stalled seek would freeze stepping and dragging
        // permanently, so after a grace period a new seek is allowed to supersede it.
        const seekBlocked = () => core.isSeekBlocked({
          inFlight: seekInFlight,
          startedAt: seekStartedAt,
          now: performance.now(),
          stallMs: SEEK_STALL_MS
        });

        const beginSeek = (t) => {
          seekInFlight = true;
          seekStartedAt = performance.now();
          video.currentTime = t;
        };

        const currentFrameIndex = () => core.frameIndexAt(video.currentTime, frameClock.fps);

        const lastFrameIndex = () => core.lastFrameIndexFor(video.duration, frameClock.fps);


        // Held-key scrubbing state. Forward motion plays the video slowly; backward
        // motion steps on a timed schedule, because no browser implements reverse
        // playback. While scrubbing, sync() must not fight the rate and mute we set.
        let scrubbing = false;
        let scrubDirection = 0;
        let scrubRate = SCRUB_RATE_NORMAL;
        let scrubRafHandle = null;
        let scrubLastTick = 0;
        let scrubAccumulator = 0;
        let preScrubRate = 1;

        // Keyboard navigation is silent. Stepping and jog scrubbing both move the
        // video in ways that make audio useless or unpleasant (a half-speed
        // soundtrack, or a frame's worth of a sample), so the first keyboard move
        // mutes and it stays muted until playback is deliberately resumed.
        let keyboardMuted = false;
        let preKeyboardMuted = false;

        const enterKeyboardSilence = () => {
          if (!keyboardMuted) {
            keyboardMuted = true;
            preKeyboardMuted = video.muted;
          }
          // Re-asserted on every keyboard move, not just the first. The host site or
          // the user can unmute in between, and a jog scrub that then plays with the
          // sound on is exactly what this exists to prevent.
          video.muted = true;
        };

        // Restoring on an actual play covers every way playback can resume: Space,
        // our own play button, and the host site's.
        const exitKeyboardSilence = () => {
          if (!keyboardMuted) return;
          keyboardMuted = false;
          video.muted = preKeyboardMuted;
        };

        // A-B loop. Markers are held in seconds and snapped to frame centres when
        // set, so they line up with the frame-stepping grid and can be nudged by
        // stepping to the right frame and setting the marker again.
        let loopIn = null;
        let loopOut = null;
        let looping = false;
        let loopRafHandle = null;
        let zoomDisabled = false;
        let linkFeedbackTimer = null;
        let urlWriteTimer = null;

        // Reflects the current loop in the address bar, so the page can be
        // bookmarked or copied from the browser rather than only through the link
        // button. Debounced because dragging a handle changes the loop on every
        // pointer move, and replaceState is not free.
        //
        // replaceState rather than assigning location.hash: assigning would push a
        // history entry per edit and bury the back button under dozens of them.
        // history.state is passed through untouched so neither site's router loses
        // the state it put there.
        //
        // Facebook rewrites its own address bar and may strip this again; that is
        // its prerogative and the link button remains the reliable route. On
        // Instagram the fragment persists.
        const writeLoopToUrl = () => {
          clearTimeout(urlWriteTimer);
          urlWriteTimer = setTimeout(() => {
            urlWriteTimer = null;
            try {
              const range = loopRange();
              const href = location.href;
              const next = range
                ? core.formatLoopUrl(href, range.start, range.end, settings.playbackRate)
                : href.split('#')[0];
              if (!next || next === href) return;
              history.replaceState(history.state, '', next);
            } catch (e) {
              // A site may forbid history access, or the URL may be rejected. The
              // loop still works; only its reflection in the address bar is lost.
            }
          }, URL_WRITE_DEBOUNCE_MS);
        };

        // Clip export state.
        let clipState = 'idle'; // idle | recording | unsupported | error
        let clipProgress = 0;
        let clipPercentShown = -1;
        let clipRecorder = null;
        let clipStream = null;
        let clipRafHandle = null;
        let clipCancelled = false;

        const loopRange = () => core.normalizeLoop({
          start: loopIn,
          end: loopOut,
          duration: video.duration,
          fps: frameClock.fps,
          minFrames: LOOP_MIN_FRAMES
        });

        // The window the seek bar currently represents. Held as state rather than
        // derived fresh each time, so nudging a marker does not rescale the bar.
        let timelineView = null;
        // Frozen for the duration of a drag. Without this, moving a marker changes
        // the window, which changes the pointer-to-time mapping mid-drag, which
        // makes the handle jump away from the pointer: a feedback loop that reads as
        // the bar resetting and skipping around. The window is re-evaluated once on
        // release instead.
        let frozenView = null;

        const currentView = () => {
          if (frozenView) return frozenView;
          timelineView = core.nextTimelineView({
            current: timelineView,
            loopIn,
            loopOut,
            duration: video.duration,
            barWidthPx: seekTrack.getBoundingClientRect().width,
            minGapPx: ZOOM_MIN_GAP_PX,
            minFraction: ZOOM_MIN_FRACTION,
            maxFraction: ZOOM_MAX_FRACTION,
            targetFraction: ZOOM_TARGET_FRACTION,
            minWindowSeconds: ZOOM_MIN_WINDOW_SECONDS,
            endGuardSeconds: ZOOM_END_GUARD_SECONDS,
            endPaddingPx: ZOOM_END_PADDING_PX,
            disabled: zoomDisabled
          });
          return timelineView;
        };

        const freezeView = () => {
          frozenView = currentView();
        };

        const thawView = () => {
          stopEdgePan();
          frozenView = null;
        };

        // End of the buffered range covering a given time, which is how far stepping
        // can go without touching the network.
        const bufferedEndNear = (t) => core.bufferedEndNear(video.buffered, t);

        function sync() {
          video.controls = false;
          const vol = Math.min(1, Math.max(0, Number(settings.volume) ?? 1));
          const rate = Number(settings.playbackRate) || 1;
          // In augment mode the host site owns volume, mute and speed — it has its
          // own controls for them, and asserting ours here fights them. Verified on
          // Facebook: a volume written by us is reverted by their player within a
          // second, so this would be a losing battle as well as a wrong one.
          //
          // While scrubbing, rate and mute belong to the scrub: enforcing the saved
          // preferences would cancel it instantly.
          //
          // Looping used to be excluded here too, because the loop carried its own
          // rate and sync would have fought it. With one speed control the loop
          // plays at the bar's speed, so excluding it meant the speed buttons did
          // nothing at all while a loop ran -- measured as the rate staying at 1
          // after clicking 0.25x.
          if (!augmenting && !scrubbing) {
            if (Math.abs(video.volume - vol) > 0.005) video.volume = vol;
            if (!video.paused && video.muted !== Boolean(settings.muted)) video.muted = Boolean(settings.muted);
            if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
          }

          playBtn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
          if (TOUCH) currentContainer?.classList.toggle('ig-vc-paused', video.paused);
          const effVol = settings.muted ? 0 : vol;
          volEl.style.setProperty('--v', `${(effVol * 100).toFixed(1)}%`);
          muteBtn.innerHTML = effVol === 0 ? ICONS.volumeX : effVol < 0.25 ? ICONS.volume : effVol < 0.65 ? ICONS.volume1 : ICONS.volume2;

          speedBtn.textContent = `${Number(rate.toFixed(2))}x`;
          for (const opt of speedOpts) opt.classList.toggle('active', Math.abs(Number(opt.dataset.speed) - rate) < 0.01);


          const range = loopRange();
          loopInBtn.classList.toggle('active', loopIn !== null);
          loopOutBtn.classList.toggle('active', loopOut !== null);
          loopInBtn.title = loopIn === null
            ? 'Set loop start at the current frame  [ '
            : `Loop start ${formatTime(loopIn, 2)} — press [ again to move it`;
          loopOutBtn.title = loopOut === null
            ? 'Set loop end at the current frame  ] '
            : `Loop end ${formatTime(loopOut, 2)} — press ] again to move it`;
          loopToggleBtn.innerHTML = ICONS.loop;
          loopToggleBtn.classList.toggle('active', looping);
          loopOnOffBtn.classList.toggle('active', looping);
          loopOnOffBtn.classList.toggle('unavailable', !range);
          loopToggleBtn.classList.toggle('unavailable', !range);
          loopToggleBtn.title = range
            ? (looping
              ? `Looping at ${Number(core.clampPlaybackRate(settings.playbackRate, 1))}x — click to stop  \\`
              : `Loop ${formatTime(range.start)}–${formatTime(range.end)} at ${Number(core.clampPlaybackRate(settings.playbackRate, 1))}x  \\`)
            : 'Set both A and B to enable looping';
          loopRestartBtn.innerHTML = ICONS.restart;
          loopRestartBtn.classList.toggle('unavailable', loopIn === null);
          loopRestartBtn.title = loopIn === null
            ? 'Set A first, then this jumps back to it'
            : `Jump back to ${formatTime(loopIn, 2)}  Home`;

          const view = currentView();
          loopZoomBtn.textContent = view.zoomed ? 'full' : 'fit';
          loopZoomBtn.classList.toggle('active', zoomDisabled);
          loopZoomBtn.title = view.zoomed
            ? `Timeline zoomed to ${formatTime(view.start)}–${formatTime(view.end)} — show the whole video instead`
            : 'Zoom the timeline around a tight loop so the markers are easier to aim at';

          // A loop link only exists once a segment is marked, so the bar button is
          // hidden rather than shown disabled when there is nothing to share. The
          // feedback timer owns the label while it is reporting ok/err.
          if (linkFeedbackTimer === null) {
            loopLinkBtn.innerHTML = ICONS.link;
            loopLinkBtn.classList.remove('ig-vc-clip-text');
            loopLinkBtn.title = 'Copy a link to this video that opens at this loop';
          }
          loopLinkBtn.classList.toggle('ig-vc-hidden', !range);

          // Clip export moved into the loop menu: it is a rare action and it costs
          // a bar slot the loop link uses far more often.
          if (clipState === 'recording') {
            clipBtn.textContent = clipProgress > 0 ? `${Math.round(clipProgress * 100)}%` : 'rec';
          } else {
            clipBtn.textContent = 'clip';
          }
          clipBtn.classList.toggle('active', clipState === 'recording');
          clipBtn.classList.toggle('unavailable',
            !range || clipState === 'unsupported' || clipState === 'error');
          clipBtn.title = range ? (CLIP_TITLES[clipState] || CLIP_TITLES.idle) : CLIP_TITLES.unavailable;

          fsBtn.innerHTML = document.fullscreenElement?.contains(video) ? ICONS.minimize : ICONS.maximize;
          fsBtn.title = document.fullscreenElement?.contains(video)
            ? 'Leave fullscreen  ·  right-click or  t  for theater mode'
            : 'Fullscreen  ·  right-click or  t  for theater mode, which covers the page but keeps the browser visible';
        }

        const renderTime = (t) => (frameMode
          ? `${formatTime(t, 2)} · f${Math.floor(t * frameClock.fps + 1e-6)}`
          : `${formatTime(t)} / ${formatTime(video.duration)}`);

        // Issues at most one drag seek at a time and always aims at the newest pointer
        // position, discarding whatever it passed through. Writing currentTime on every
        // pointermove instead aborts the in-flight seek each time, so none ever
        // completes and the picture stays frozen until the drag stops.
        const flushDragSeek = () => {
          const decision = core.dragSeekDecision({
            blocked: seekBlocked(),
            dirty: dragDirty,
            target: dragTargetTime,
            currentTime: video.currentTime
          });
          // 'wait' leaves the target pending for the next attempt; 'redundant'
          // consumes it without seeking, because the video is already there.
          if (decision === 'wait') return;
          dragDirty = false;
          if (decision === 'redundant') return;
          // fastSeek trades precision for speed, which is the right trade mid-drag.
          // Firefox implements it; Chrome does not, hence the exact-seek fallback.
          if (typeof video.fastSeek === 'function') {
            seekInFlight = true;
            seekStartedAt = performance.now();
            video.fastSeek(dragTargetTime);
          } else {
            beginSeek(dragTargetTime);
          }
        };

        // Marker positions and visibility, split out so a trim drag can repaint them
        // at pointer rate without the cost of a full sync() on every move.
        const paintLoopMarks = () => {
          if (!Number.isFinite(video.duration) || video.duration <= 0) return;
          const view = currentView();
          seekEl.style.setProperty('--la', `${(core.timeToViewRatio(loopIn ?? 0, view) * 100).toFixed(2)}%`);
          seekEl.style.setProperty('--lb', `${(core.timeToViewRatio(loopOut ?? 0, view) * 100).toFixed(2)}%`);
          seekEl.classList.toggle('has-a', loopIn !== null);
          seekEl.classList.toggle('has-b', loopOut !== null);
          seekEl.classList.toggle('has-loop', Boolean(loopRange()));
          seekEl.classList.toggle('zoomed', view.zoomed);
          seekEl.title = view.zoomed
            ? `Timeline zoomed to ${formatTime(view.start)}–${formatTime(view.end)} for marker precision`
            : '';
        };

        const updateTime = () => {
          if (!Number.isFinite(video.duration) || video.duration <= 0) return;
          const view = currentView();
          seekEl.style.setProperty('--b', `${(core.timeToViewRatio(bufferedEndNear(video.currentTime), view) * 100).toFixed(1)}%`);
          paintLoopMarks();
          // Mid-drag the pointer owns the fill and the readout, so leave both alone;
          // overwriting them here would snap the bar back to the lagging decoder.
          if (dragTargetTime !== null) return;
          if (!isSeeking()) seekEl.style.setProperty('--v', `${(core.timeToViewRatio(video.currentTime, view) * 100).toFixed(1)}%`);
          timeEl.textContent = renderTime(video.currentTime);
        };

        let wasPlaying = false;

        const requestPlay = () => {
          if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.2) {
            video.currentTime = 0;
          }
          video.play().catch(() => {});
        };

        const requestPause = () => video.pause();

        const isSeeking = bindSlider(
          seekEl,
          false,
          (ratio) => {
            // The fill and readout follow the pointer directly. Only the decoder is
            // paced, so the bar stays responsive even when the picture lags behind it.
            seekEl.style.setProperty('--v', `${(ratio * 100).toFixed(1)}%`);
            if (Number.isFinite(video.duration) && video.duration > 0) {
              // Through the view window, so dragging is fine-grained while zoomed.
              dragTargetTime = core.viewRatioToTime(ratio, currentView());
              dragDirty = true;
              timeEl.textContent = renderTime(dragTargetTime);
              flushDragSeek();
            }
          },
          () => {
            wasPlaying = !video.paused;
            if (wasPlaying) requestPause();
            // A drag supersedes any queued frame steps.
            pendingDelta = 0;
            intendedFrame = null;
            freezeView();
            showHint('playhead');
            // Dragging is the most seek-heavy thing the bar does, so ask for the file.
            if (!preloadNudged) {
              preloadNudged = true;
              try { video.preload = 'auto'; } catch (e) {}
            }
          },
          () => {
            // The last paced seek landed wherever the pointer happened to be while it
            // was in flight, and may have been approximate, so finish on an exact
            // frame-aligned seek to the real release position.
            if (dragTargetTime !== null && Number.isFinite(video.duration) && video.duration > 0) {
              const frame = core.clampFrame(core.frameIndexAt(dragTargetTime, frameClock.fps), lastFrameIndex());
              intendedFrame = frame;
              beginSeek(core.frameCenter(frame, frameClock.fps));
            }
            dragTargetTime = null;
            dragDirty = false;
            thawView();
            showHint(null);
            if (wasPlaying) requestPlay();
            updateTime();
          }
        );

        // Loop painting (touch). Registered after bindSlider so these listeners run
        // after the scrub's own: the scrub keeps doing the seeking and frame preview
        // through currentView(), and painting only swaps in a zoomed view and turns
        // the drag's start and end into A and B.
        if (TOUCH) {
          let pressTimer = null;
          let pressX = 0;
          let pressY = 0;
          let painting = false;
          let dragged = false;
          let anchor = null;
          let paintX = 0;
          const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
          const placeMarkers = (t) => {
            loopIn = Math.min(anchor, t);
            loopOut = Math.max(anchor, t);
            if (loopOut - loopIn < 1e-6) loopOut = null;
          };
          seekEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            cancelPress();
            pressX = e.clientX;
            pressY = e.clientY;
            pressTimer = setTimeout(() => {
              pressTimer = null;
              if (!seekEl.hasPointerCapture(e.pointerId) || !Number.isFinite(video.duration) || video.duration <= 0) return;
              painting = true;
              dragged = false;
              paintX = e.clientX;
              anchor = markerTimeNow();
              loopIn = anchor;
              // Default B: DEFAULT_LOOP_SECONDS later, frame-aligned, clamped to the end.
              loopOut = core.frameCenter(
                core.clampFrame(core.frameIndexAt(Math.min(video.duration, anchor + DEFAULT_LOOP_SECONDS), frameClock.fps), lastFrameIndex()),
                frameClock.fps
              );
              if (loopOut <= loopIn) loopOut = null;
              looping = false;
              stopLoopWatcher();
              // Zoom the drag mapping to a window around A, so a few seconds fill the
              // whole track. The scrub froze the view on press; this replaces it.
              // Positioned so A stays under the finger: the finger's fraction of the
              // track maps to A in the new window (clamped at the media's ends).
              const span = Math.min(video.duration, PAINT_WINDOW_SECONDS * 2);
              const tr = seekTrack.getBoundingClientRect();
              const fingerRatio = tr.width > 0 ? Math.min(1, Math.max(0, (e.clientX - tr.left) / tr.width)) : 0.5;
              const start = Math.min(Math.max(0, anchor - fingerRatio * span), video.duration - span);
              frozenView = { start, end: start + span, zoomed: span < video.duration, padSeconds: 0 };
              seekEl.classList.add('ig-vc-painting');
              showHint('paint');
              sync();
              updateTime();
            }, LONG_PRESS_MS);
          }, { signal });
          seekEl.addEventListener('pointermove', (e) => {
            if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > LONG_PRESS_SLOP_PX) cancelPress();
            if (!painting || dragTargetTime === null) return;
            // Until the finger actually moves, keep the default 5 s loop on screen.
            if (!dragged && Math.abs(e.clientX - paintX) <= LONG_PRESS_SLOP_PX) return;
            dragged = true;
            placeMarkers(markerTimeNow());
            showHint('paint');
            updateTime();
          }, { signal });
          const finishPaint = () => {
            cancelPress();
            if (!painting) return;
            painting = false;
            seekEl.classList.remove('ig-vc-painting');
            // Dragged: the scrub's release has just issued an exact frame-aligned
            // seek to the lift point, so the video's position is B. Not dragged:
            // keep the default loop set on long-press.
            if (dragged) placeMarkers(markerTimeNow());
            if (loopRange()) {
              looping = true;
              startLoopWatcher();
              beginSeek(loopIn);
              requestPlay();
            } else {
              loopIn = anchor;
              loopOut = null;
            }
            anchor = null;
            showHint(null);
            revealBar(true);
            sync();
            updateTime();
            writeLoopToUrl();
          };
          seekEl.addEventListener('pointerup', finishPaint, { signal });
          seekEl.addEventListener('pointercancel', finishPaint, { signal });
        }

        bindSlider(volEl, true, (ratio) => {
          saveSettings({ volume: ratio, muted: ratio === 0 });
          video.muted = ratio === 0;
        });

        let currentContainer = null;
        let currentHost = null;
        let currentSeriesOverlay = null;
        const clearSeriesOverlay = () => {
          currentHost?.classList.remove('ig-vc-host');
          currentSeriesOverlay?.classList.remove('ig-vc-series-overlay');
          currentHost = null;
          currentSeriesOverlay = null;
        };
        const mount = () => {
          const container = video.isConnected && resolvePlayerContainer(video);
          if (hasNativeControls(video, container)) {
            destroy();
            controllers.delete(video);
            return;
          }
          if (ensureRelativeContainer(container)) {
            if (currentContainer && currentContainer !== container) {
              currentContainer.classList.remove('ig-vc-player');
            }
            currentContainer = container;
            if (bar.parentElement !== container) {
              container.classList.add('ig-vc-player');
              container.appendChild(bar);
            }
            const series = site.findSeriesOverlay(container);
            if (series?.host !== currentHost || series?.overlay !== currentSeriesOverlay) {
              clearSeriesOverlay();
              if (series) {
                currentHost = series.host;
                currentSeriesOverlay = series.overlay;
                currentHost.classList.add('ig-vc-host');
                currentSeriesOverlay.classList.add('ig-vc-series-overlay');
              }
            }
            bindNativeSlider();
            hideNativeControls();
          }
        };

        const destroy = () => {
          ro.disconnect();
          ac.abort();
          frameClock.stop();
          revealNativeControls();
          clearTimeout(revealTimer);
          clearTimeout(linkFeedbackTimer);
          linkFeedbackTimer = null;
          clearTimeout(urlWriteTimer);
          urlWriteTimer = null;
          stopClipRecording();
          clipState = 'idle';
          stopLoopWatcher();
          pendingDelta = 0;
          seekInFlight = false;
          intendedFrame = null;
          dragTargetTime = null;
          dragDirty = false;
          scrubbing = false;
          scrubDirection = 0;
          if (scrubRafHandle !== null) {
            cancelAnimationFrame(scrubRafHandle);
            scrubRafHandle = null;
          }
          bar.remove();
          clearSeriesOverlay();
          const container = currentContainer || (video.isConnected && resolvePlayerContainer(video));
          container?.classList.remove('ig-vc-player', 'ig-vc-kb', 'ig-vc-paused');
          currentContainer = null;
        };

        // Keyboard actions happen without the pointer over the player, so the bar has
        // to be revealed deliberately and then released back to hover control. Bar
        // visibility doubles as the engagement signal that gates the keyboard.
        const revealBar = (withFrameInfo) => {
          frameMode = withFrameInfo;
          currentContainer?.classList.add('ig-vc-kb');
          currentContainer?.classList.remove('idle');
          clearTimeout(revealTimer);
          revealTimer = setTimeout(() => {
            // A long hold must not time the bar out from under an active scrub.
            if (scrubbing) {
              revealBar(withFrameInfo);
              return;
            }
            frameMode = false;
            currentContainer?.classList.remove('ig-vc-kb');
            updateTime();
          }, KEYBOARD_REVEAL_MS);
          updateTime();
        };

        // Issues at most one seek at a time and collapses everything queued behind it
        // into the next one. Assigning currentTime while a seek is still running makes
        // the browser abandon and restart it, which is what makes a held key stutter.
        const flushSeek = () => {
          if (seekBlocked() || pendingDelta === 0) return;
          if (!Number.isFinite(video.duration) || video.duration <= 0) {
            pendingDelta = 0;
            return;
          }
          const base = intendedFrame ?? currentFrameIndex();
          const target = core.stepTarget({
            base,
            pendingDelta,
            lastFrame: lastFrameIndex(),
            hasIntent: intendedFrame !== null
          });
          pendingDelta = 0;
          if (target === null) return;
          intendedFrame = target;
          // Seeks to the centre of the target frame rather than its boundary, so float
          // rounding cannot land on the neighbour and stepping stays reversible.
          beginSeek(core.frameCenter(target, frameClock.fps));
        };

        const queueFrames = (delta) => {
          // A fresh burst starts from where the video actually is; anything queued
          // mid-burst accumulates against the pending target, not the stale position.
          if (!seekInFlight && pendingDelta === 0) intendedFrame = currentFrameIndex();
          pendingDelta += delta;
          flushSeek();
        };

        const stepFrames = (delta) => {
          if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
          if (!video.paused) requestPause();
          enterKeyboardSilence();
          // Ask for the whole file once the user starts stepping, so a held key walks
          // through buffered data instead of waiting on a range request per frame.
          // No-op for Instagram's MSE-backed players, which buffer on their own terms.
          if (!preloadNudged) {
            preloadNudged = true;
            try { video.preload = 'auto'; } catch (e) {}
          }
          queueFrames(delta);
          revealBar(true);
          return true;
        };

        const togglePlay = () => {
          intendedFrame = null;
          pendingDelta = 0;
          if (video.paused) requestPlay();
          else requestPause();
          revealBar(false);
          return true;
        };

        // Restarting is paced like any other seek, so a tight loop cannot thrash the
        // decoder by issuing a new seek before the last one landed.
        // Trim handles. Dragging one moves that marker and previews the video at the
        // new position, which is how a clip trimmer behaves: you see the frame you
        // are trimming to. Previews go through the same paced seek path as any other
        // drag, so a fast drag cannot thrash the decoder.
        let trimDrag = null;

        const moveTrim = (clientX) => {
          if (!trimDrag || !Number.isFinite(video.duration) || video.duration <= 0) return;
          const rect = seekTrack.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
          // Snapped to a frame centre so a marker always sits on the arrow keys' grid.
          // Read through the view window, which is what makes a tight loop editable.
          const snapped = core.frameCenter(
            core.frameIndexAt(core.viewRatioToTime(ratio, currentView()), frameClock.fps),
            frameClock.fps
          );
          const clamped = core.clampMarker({
            value: snapped,
            other: trimDrag === 'in' ? loopOut : loopIn,
            which: trimDrag,
            duration: video.duration,
            fps: frameClock.fps,
            minFrames: LOOP_MIN_FRAMES
          });
          if (clamped === null) return;
          if (trimDrag === 'in') loopIn = clamped;
          else loopOut = clamped;
          dragTargetTime = clamped;
          dragDirty = true;
          timeEl.textContent = renderTime(clamped);
          // Both marker times must track the drag, not show where they started.
          refreshHint();
          paintLoopMarks();
          flushDragSeek();
        };

        let edgePanDir = 0;
        let edgePanX = 0;
        let edgePanRaf = null;
        let edgePanPrev = 0;

        const stopEdgePan = () => {
          if (edgePanRaf !== null) cancelAnimationFrame(edgePanRaf);
          edgePanRaf = null;
          edgePanDir = 0;
        };

        const edgePanTick = (now) => {
          edgePanRaf = null;
          if (!trimDrag || !edgePanDir || !frozenView) return;
          // Clamped so a stalled frame cannot jump the window a long way.
          const dt = Math.min(0.1, Math.max(0, (now - edgePanPrev) / 1000));
          edgePanPrev = now;
          const width = frozenView.end - frozenView.start;
          const pad = frozenView.padSeconds || 0;
          const step = Math.max(width * EDGE_PAN_PER_SEC, EDGE_PAN_MIN_PER_SEC) * dt * edgePanDir;
          // The media stays inside the window: panning is for reaching more of the
          // video, never for scrolling off the end of it.
          const limit = Math.max(0, video.duration - (width - pad));
          const start = Math.min(Math.max(0, frozenView.start + step), limit);
          if (Math.abs(start - frozenView.start) > 1e-9) {
            frozenView = { ...frozenView, start, end: start + width };
            // Re-read the same pointer position through the panned window, so the
            // marker keeps moving while the finger or mouse holds still.
            moveTrim(edgePanX);
          }
          edgePanRaf = requestAnimationFrame(edgePanTick);
        };

        // Called from the drag handlers rather than from moveTrim, which the tick
        // itself calls.
        const updateEdgePan = (clientX) => {
          if (!trimDrag || !frozenView) return stopEdgePan();
          const rect = seekTrack.getBoundingClientRect();
          if (rect.width <= 0) return stopEdgePan();
          const dir = clientX >= rect.right - EDGE_PAN_ZONE_PX ? 1
            : clientX <= rect.left + EDGE_PAN_ZONE_PX ? -1
              : 0;
          if (!dir) return stopEdgePan();
          edgePanX = clientX;
          if (edgePanDir === dir && edgePanRaf !== null) return;
          edgePanDir = dir;
          edgePanPrev = performance.now();
          if (edgePanRaf === null) edgePanRaf = requestAnimationFrame(edgePanTick);
        };

        const bindTrimHandle = (handle, which) => {
          handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            // Stop the press reaching the seek bar underneath, which would otherwise
            // start a playhead scrub at the same time.
            e.stopPropagation();
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            trimDrag = which;
            wasPlaying = !video.paused;
            if (wasPlaying) requestPause();
            pendingDelta = 0;
            intendedFrame = null;
            freezeView();
            showHint(which);
            revealBar(true);
            moveTrim(e.clientX);
            updateEdgePan(e.clientX);
          });
          handle.addEventListener('pointermove', (e) => {
            if (trimDrag !== which || !handle.hasPointerCapture(e.pointerId)) return;
            moveTrim(e.clientX);
            updateEdgePan(e.clientX);
          });
          for (const evt of ['pointerup', 'pointercancel']) {
            handle.addEventListener(evt, (e) => {
              if (trimDrag !== which || !handle.hasPointerCapture(e.pointerId)) return;
              handle.releasePointerCapture(e.pointerId);
              trimDrag = null;
              dragTargetTime = null;
              dragDirty = false;
              thawView();
              showHint(null);
              // Trimming while looping should resume inside the new range, not from
              // wherever the handle was dropped.
              if (wasPlaying) requestPlay();
              sync();
              updateTime();
              writeLoopToUrl();
            });
          }
        };

        bindTrimHandle(handleA, 'in');
        bindTrimHandle(handleB, 'out');

        // The hotkey hint shown while dragging, so the marker shortcuts are
        // discoverable at the moment they are useful rather than only in the README.
        let hintMode = null;

        // Both marker times, always both, so the relationship between them is
        // visible while either is moving and a lone marker still shows where it is.
        const renderMarkers = () => {
          const a = loopIn === null ? '—' : formatTime(loopIn, 2);
          const b = loopOut === null ? '—' : formatTime(loopOut, 2);
          const span = loopIn !== null && loopOut !== null
            ? `  (${(loopOut - loopIn).toFixed(2)}s)`
            : '';
          return `A ${a}   B ${b}${span}`;
        };

        const showHint = (mode) => {
          hintMode = mode;
          const lines = [];
          // Marker times lead, since they are what the eye needs while trimming.
          if (loopIn !== null || loopOut !== null) lines.push(renderMarkers());
          if (mode === 'in') lines.push('moving A');
          else if (mode === 'out') lines.push('moving B');
          else if (mode === 'paint') lines.push('drag to move B · lift to loop');
          else if (mode === 'playhead') {
            if (TOUCH) lines.push(loopIn === null ? 'hold to start a loop here' : 'hold to paint a new loop');
            else if (loopIn === null) lines.push('press  [  to set A here');
            else if (loopOut === null) lines.push('press  ]  to set B here');
            else lines.push('press  [  or  ]  to move A or B here');
          }
          hintEl.textContent = lines.join('\n');
          hintEl.classList.toggle('visible', lines.length > 0);
        };

        // Setting a marker mid-drag changes both the times shown and which hotkey is
        // useful next, so the hint is re-rendered rather than left stale.
        const refreshHint = () => showHint(hintMode);

        // While dragging, a marker belongs at the pointer, not at the video's
        // position: paced seeking means currentTime lags behind the pointer, so
        // reading it would place the marker a few frames off where it looks.
        const markerTimeNow = () => core.frameCenter(
          core.frameIndexAt(dragTargetTime ?? video.currentTime, frameClock.fps),
          frameClock.fps
        );

        // Applies a loop carried in the launch URL, once, to the first player that
        // can take it. Clamped to the media, since a shared link may name times past
        // the end of a different or re-encoded video.
        const applyUrlLoop = () => {
          if (!pendingUrlLoop) return;
          if (!Number.isFinite(video.duration) || video.duration <= 0) return;
          const wanted = pendingUrlLoop;
          pendingUrlLoop = null;
          const fps = frameClock.fps;
          const snap = (t) => core.frameCenter(
            core.clampFrame(core.frameIndexAt(Math.min(t, video.duration), fps), core.lastFrameIndexFor(video.duration, fps)),
            fps
          );
          loopIn = snap(wanted.start);
          loopOut = snap(wanted.end);
          if (Number.isFinite(wanted.rate)) saveSettings({ playbackRate: core.clampPlaybackRate(wanted.rate, 1) });
          if (loopRange()) {
            looping = true;
            startLoopWatcher();
            // A shared loop link is an invitation to watch that passage, so open on
            // it. Without this the video sat wherever the site had left it, and the
            // loop only engaged once playback happened to wander into range.
            intendedFrame = null;
            pendingDelta = 0;
            beginSeek(loopIn);
          } else {
            loopIn = null;
            loopOut = null;
          }
          revealBar(true);
          refreshHint();
          sync();
          updateTime();
        };

        // Records the marked loop and saves it. Real time by necessity: both sites
        // stream through MediaSource, so there is no file to slice and the only
        // source is the element's rendered output. Recorded at 1x regardless of the
        // practice speed, so the clip is the move as filmed; any player can slow it.
        const stopClipRecording = () => {
          if (clipRafHandle !== null) {
            cancelAnimationFrame(clipRafHandle);
            clipRafHandle = null;
          }
          if (clipRecorder && clipRecorder.state !== 'inactive') {
            try { clipRecorder.stop(); } catch (e) {}
          }
          if (clipStream) {
            for (const track of clipStream.getTracks()) track.stop();
            clipStream = null;
          }
        };

        const recordClip = async () => {
          if (clipState === 'recording') {
            clipCancelled = true;
            stopClipRecording();
            return;
          }
          const range = loopRange();
          if (!range) return;
          if (typeof video.captureStream !== 'function' || typeof window.MediaRecorder !== 'function') {
            clipState = 'unsupported';
            sync();
            return;
          }
          const mimeType = core.pickRecorderMime(CLIP_MIME_CANDIDATES, (m) => window.MediaRecorder.isTypeSupported(m));
          if (!mimeType) {
            clipState = 'unsupported';
            sync();
            return;
          }

          // The recording borrows playback, so remember what to give back.
          const priorRate = video.playbackRate;
          const priorMuted = video.muted;
          const priorLooping = looping;
          const priorPaused = video.paused;
          looping = false;
          stopLoopWatcher();

          clipCancelled = false;
          clipState = 'recording';
          clipProgress = 0;
          clipPercentShown = -1;
          revealBar(true);
          sync();

          const chunks = [];
          try {
            clipStream = video.captureStream();
            clipRecorder = new window.MediaRecorder(clipStream, { mimeType });
          } catch (e) {
            clipState = 'error';
            clipStream = null;
            clipRecorder = null;
            sync();
            return;
          }
          clipRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size) chunks.push(e.data);
          };

          const finished = new Promise((resolve) => { clipRecorder.onstop = resolve; });

          // Park at A and let the decoder settle before the recorder opens, or the
          // first frames are whatever was on screen beforehand.
          video.playbackRate = 1;
          // Unmuted so the clip carries the music, which is the point for a dance
          // move. Keyboard navigation may well have muted it.
          video.muted = false;
          intendedFrame = null;
          pendingDelta = 0;
          video.currentTime = range.start;
          await new Promise((r) => setTimeout(r, CLIP_LEAD_IN_MS));
          await video.play().catch(() => {});

          clipRecorder.start(200);
          const endAt = Math.min(range.end, range.start + CLIP_MAX_SECONDS);
          const tick = () => {
            clipRafHandle = null;
            if (clipState !== 'recording') return;
            const span = endAt - range.start;
            clipProgress = span > 0 ? Math.min(1, Math.max(0, (video.currentTime - range.start) / span)) : 0;
            const percent = Math.round(clipProgress * 100);
            if (percent !== clipPercentShown) {
              clipPercentShown = percent;
              sync();
            }
            if (video.currentTime >= endAt || video.ended) {
              stopClipRecording();
              return;
            }
            clipRafHandle = requestAnimationFrame(tick);
          };
          clipRafHandle = requestAnimationFrame(tick);

          await finished;
          video.pause();
          video.playbackRate = priorRate;
          video.muted = priorMuted;
          if (priorLooping) {
            looping = true;
            startLoopWatcher();
          }
          if (!priorPaused && !priorLooping) video.play().catch(() => {});

          clipRecorder = null;
          clipState = 'idle';
          clipProgress = 0;

          if (clipCancelled || !chunks.length) {
            sync();
            return;
          }

          const blob = new Blob(chunks, { type: mimeType });
          const filename = core.clipFilename(location.hostname, location.pathname, range.start, range.end);
          const url = URL.createObjectURL(blob);
          downloadUrl(url, filename);
          // Then show it, so the move can be studied immediately. The overlay owns
          // the blob URL from here and revokes it when dismissed.
          openTheater({
            src: url,
            revokeUrl: url,
            filename,
            label: `${filename}  ·  ${formatTime(range.end - range.start, 2)}  ·  ${(blob.size / 1048576).toFixed(1)} MB`
          });
          sync();
        };

        // Theater mode: a page overlay showing only the video, leaving the browser's
        // own chrome in place. Reached with `t` or by right-clicking fullscreen.
        const openVideoTheater = () => {
          // Adopt the player container so the video and our own bar move together,
          // keeping the loop controls usable in theater mode. Pointing a second
          // <video> at the page's blob URL would load nothing, since a MediaSource
          // URL can only ever be attached to one element.
          const container = currentContainer || resolvePlayerContainer(video);
          if (!container) return false;
          openTheater({ adopt: container, label: 'theater mode  ·  Esc or click outside to close' });
          return true;
        };

        const loopTick = () => {
          loopRafHandle = null;
          if (!looping) return;
          const range = loopRange();
          if (range && !seekBlocked()
              && core.loopShouldRestart({ currentTime: video.currentTime, loopEnd: range.end, paused: video.paused })) {
            intendedFrame = null;
            pendingDelta = 0;
            beginSeek(range.start);
          }
          loopRafHandle = requestAnimationFrame(loopTick);
        };

        const startLoopWatcher = () => {
          // The loop plays at the speed the bar is set to; it no longer keeps a rate
          // of its own, so there is nothing to borrow or hand back.
          if (loopRafHandle === null) loopRafHandle = requestAnimationFrame(loopTick);
        };

        const stopLoopWatcher = () => {
          if (loopRafHandle !== null) {
            cancelAnimationFrame(loopRafHandle);
            loopRafHandle = null;
          }
        };

        // Markers snap to the current frame's centre so they sit on the same grid the
        // arrow keys step along. Set either one at any time, in any order, while
        // playing or paused — refine by stepping to the frame you want and setting
        // it again.
        const setLoopIn = () => {
          if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
          loopIn = markerTimeNow();
          if (loopOut !== null && loopOut <= loopIn) loopOut = null;
          revealBar(true);
          refreshHint();
          sync();
          writeLoopToUrl();
          return true;
        };

        const setLoopOut = () => {
          if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
          loopOut = markerTimeNow();
          if (loopIn !== null && loopIn >= loopOut) loopIn = null;
          // Marking the end of a move is the natural moment to start practising it.
          if (loopIn !== null && loopRange()) {
            looping = true;
            startLoopWatcher();
          }
          revealBar(true);
          refreshHint();
          sync();
          writeLoopToUrl();
          return true;
        };

        const toggleLoop = () => {
          if (!loopRange()) {
            revealBar(true);
            sync();
            return false;
          }
          looping = !looping;
          if (looping) startLoopWatcher();
          else stopLoopWatcher();
          revealBar(true);
          sync();
          return true;
        };

        const restartLoop = () => {
          if (loopIn === null || !Number.isFinite(video.duration) || video.duration <= 0) return false;
          intendedFrame = null;
          pendingDelta = 0;
          beginSeek(loopIn);
          revealBar(true);
          return true;
        };

        const clearLoop = () => {
          loopIn = null;
          loopOut = null;
          looping = false;
          stopLoopWatcher();
          revealBar(true);
          refreshHint();
          sync();
          updateTime();
          // Clearing the loop strips the fragment, so a copied URL does not carry
          // a loop the page is no longer showing.
          writeLoopToUrl();
          return true;
        };

        // Reverse motion, paced in wall-clock time rather than run as fast as the
        // decoder allows. Even spacing is what reads as smooth; "every frame, whenever
        // it lands" is what reads as stutter.
        const scrubTick = (now) => {
          scrubRafHandle = null;
          if (!scrubbing) return;
          const elapsed = now - scrubLastTick;
          scrubLastTick = now;
          scrubAccumulator += elapsed;
          const paced = core.scrubSteps({
            accumulator: scrubAccumulator,
            elapsedMs: elapsed,
            fps: frameClock.fps,
            rate: scrubRate,
            maxCatchup: SCRUB_MAX_CATCHUP_FRAMES
          });
          scrubAccumulator = paced.accumulator;
          if (paced.steps > 0) {
            // While a seek is still decoding, drop the backlog rather than bank it.
            // Catching up later would lurch, and during a scrub smooth motion matters
            // more than an exact frame count: falling behind just moves slower.
            if (!seekBlocked()) queueFrames(-paced.steps);
          }
          if (video.currentTime <= 0) {
            endScrub();
            return;
          }
          scrubRafHandle = requestAnimationFrame(scrubTick);
        };

        const beginScrub = (direction, fast) => {
          if (scrubbing || !Number.isFinite(video.duration) || video.duration <= 0) return;
          scrubbing = true;
          scrubDirection = direction;
          scrubRate = fast ? SCRUB_RATE_FAST : SCRUB_RATE_NORMAL;
          // Remember what the scrub is about to borrow. In augment mode the saved
          // preferences are not authoritative — the host site's controls are — so the
          // only correct thing to restore is whatever was actually in effect.
          preScrubRate = video.playbackRate;
          revealBar(true);
          if (direction > 0) {
            // Forward motion hands the work back to the decoder's normal playback
            // path. No seeking at all, frames presented on schedule: the only way to
            // get genuinely smooth output. Audio at a scrub rate is just noise.
            enterKeyboardSilence();
            video.playbackRate = scrubRate;
            video.play().catch(() => {});
          } else {
            scrubLastTick = performance.now();
            scrubAccumulator = 0;
            scrubRafHandle = requestAnimationFrame(scrubTick);
          }
        };

        const endScrub = () => {
          if (!scrubbing) return;
          scrubbing = false;
          if (scrubRafHandle !== null) {
            cancelAnimationFrame(scrubRafHandle);
            scrubRafHandle = null;
          }
          if (scrubDirection > 0) video.pause();
          scrubDirection = 0;
          // currentTime is left wherever playback stopped; frame indices derive from
          // it, so a following tap is still exact without a corrective seek.
          // Mute is deliberately NOT restored here — keyboard navigation stays
          // silent until playback is actually resumed.
          video.playbackRate = augmenting ? preScrubRate : (Number(settings.playbackRate) || 1);
          revealBar(true);
          sync();
        };

        // Facebook's own progress slider is scrub-on-release: during a drag it moves
        // its thumb but leaves the video pinned. Verified on a live Reel —
        // currentTime held at a single value across 29 samples of a 1.4s drag, then
        // jumped only on release. This adds the live picture updates it omits,
        // routed through the same paced-seek path as our own slider.
        //
        // Propagation is deliberately NOT stopped: Facebook's handler must keep
        // running so its thumb still tracks the pointer and its own release-seek
        // remains the final word on where the video lands.
        let nativeSlider = null;
        let nativeDragPointer = null;

        const nativeDragTo = (clientX) => {
          if (!nativeSlider || !Number.isFinite(video.duration) || video.duration <= 0) return;
          const rect = nativeSlider.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
          dragTargetTime = Math.min(video.duration, Math.max(0, ratio * video.duration));
          dragDirty = true;
          timeEl.textContent = renderTime(dragTargetTime);
          flushDragSeek();
        };

        const onNativePointerDown = (e) => {
          if (e.button !== 0 || nativeDragPointer !== null) return;
          nativeDragPointer = e.pointerId;
          wasPlaying = !video.paused;
          if (wasPlaying) requestPause();
          // A slider drag supersedes any queued frame steps.
          pendingDelta = 0;
          intendedFrame = null;
          revealBar(false);
          nativeDragTo(e.clientX);
        };

        const onNativePointerMove = (e) => {
          if (nativeDragPointer === null || e.pointerId !== nativeDragPointer) return;
          nativeDragTo(e.clientX);
        };

        const onNativePointerEnd = (e) => {
          if (nativeDragPointer === null || e.pointerId !== nativeDragPointer) return;
          nativeDragPointer = null;
          // Facebook issues its own exact seek on release. Ours would race it, so the
          // pending target is dropped rather than contested.
          dragTargetTime = null;
          dragDirty = false;
          if (wasPlaying) requestPlay();
          updateTime();
        };

        // Hides the site's own controls where ours take their place. Re-run on every
        // mount for the same reason bindNativeSlider is: Facebook mounts these
        // lazily and swaps the elements out, so a one-shot hide at startup is
        // undone the first time it re-renders.
        let hiddenNative = [];
        const hideNativeControls = () => {
          if (augmenting || !site.nativeControlsToHide) return;
          // Never recompute while ANY theater overlay is open. A relocated player
          // leaves its original ancestors momentarily empty, so every structural
          // guard below reads clean on elements that are about to have a video put
          // back inside them. Measured: this hid the player itself, and closing
          // the overlay restored the video into a display:none parent, collapsing
          // it to 0x0.
          //
          // The check is deliberately global rather than "is MY container
          // adopted". Facebook's page carries two players, and the second one's
          // walk normally stops at the ancestor holding both videos -- but with
          // the first player lifted into the overlay that ancestor holds only one,
          // so the walk climbs past its own boundary and hides something belonging
          // to the other player.
          if (theaterEl) return;
          const found = (site.nativeControlsToHide(video, currentContainer || resolvePlayerContainer(video)) || [])
            // A control strip never contains the video, our own bar, or the whole
            // player's worth of buttons. Re-checked here rather than trusted from
            // the walk, because the walk can only see the DOM as it is at the time.
            .filter((el) => el
              && el.isConnected
              && !el.querySelector('video')
              && !el.querySelector('.ig-vc-bar')
              && !el.contains(video));
          // Nothing found usually means they have not mounted yet, so anything
          // already hidden is left hidden rather than being revealed and re-hidden
          // on the next mount, which would flicker their progress bar back.
          if (!found.length) return;
          for (const el of hiddenNative) {
            if (!found.includes(el)) el.classList.remove('ig-vc-native-hidden');
          }
          for (const el of found) el.classList.add('ig-vc-native-hidden');
          hiddenNative = found;
        };

        const revealNativeControls = () => {
          for (const el of hiddenNative) el.classList.remove('ig-vc-native-hidden');
          hiddenNative = [];
        };

        // Facebook mounts the slider lazily and can replace the element, so this is
        // re-checked on every mount and rebinds when the element actually changes.
        const bindNativeSlider = () => {
          if (!augmenting || !site.nativeSeekSlider) return;
          const found = site.nativeSeekSlider(video, currentContainer || resolvePlayerContainer(video));
          if (!found || found === nativeSlider) return;
          nativeSlider = found;
          found.addEventListener('pointerdown', onNativePointerDown, { signal, capture: true });
        };

        window.addEventListener('pointermove', onNativePointerMove, { signal, capture: true });
        for (const evt of ['pointerup', 'pointercancel']) {
          window.addEventListener(evt, onNativePointerEnd, { signal, capture: true });
        }



        playBtn.addEventListener('click', () => (video.paused ? requestPlay() : requestPause()));
        muteBtn.addEventListener('click', () => {
          const muted = !settings.muted;
          saveSettings({ volume: !muted && settings.volume === 0 ? 0.5 : settings.volume, muted });
          video.muted = muted;
        });
        for (const opt of speedOpts) {
          opt.addEventListener('click', () => {
            saveSettings({ playbackRate: Number(opt.dataset.speed) });
            // The speed is part of a shared loop link, so the address bar follows
            // it. This used to hang off the loop menu's own speed buttons, which
            // are gone.
            writeLoopToUrl();
          });
        }
        speedBtn.addEventListener('contextmenu', () => saveSettings({ playbackRate: 1 }));
        loopInBtn.addEventListener('click', setLoopIn);
        loopOutBtn.addEventListener('click', setLoopOut);
        // A tap-opened menu replaces the hover popups on touch. The speed and loop
        // buttons open theirs; the loop button's own toggle moves into its menu as
        // "loop", since a tap cannot both open the menu and toggle looping.
        const toggleMenu = (btn) => {
          const wrap = btn.closest('.ig-vc-wrap');
          const open = !wrap.classList.contains('ig-vc-open');
          for (const w of bar.querySelectorAll('.ig-vc-wrap.ig-vc-open')) w.classList.remove('ig-vc-open');
          wrap.classList.toggle('ig-vc-open', open);
          revealBar(frameMode);
        };
        if (TOUCH) {
          loopToggleBtn.addEventListener('click', () => toggleMenu(loopToggleBtn));
          speedBtn.addEventListener('click', () => toggleMenu(speedBtn));
        } else {
          loopToggleBtn.addEventListener('click', toggleLoop);
        }
        loopOnOffBtn.addEventListener('click', toggleLoop);

        // Frame-step buttons: the arrow keys' tap-to-step / hold-to-scrub, on a finger.
        for (const [btn, direction] of [[stepBackBtn, -1], [stepFwdBtn, 1]]) {
          let hold = null;
          let scrubbingHere = false;
          const release = () => {
            clearTimeout(hold);
            hold = null;
            if (scrubbingHere) endScrub();
            scrubbingHere = false;
          };
          btn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            release();
            if (!stepFrames(direction)) return;
            hold = setTimeout(() => {
              hold = null;
              scrubbingHere = true;
              beginScrub(direction, false);
            }, HOLD_DELAY_MS);
          }, { signal });
          for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(evt, release, { signal });
        }
        if (TOUCH) bar.addEventListener('pointerdown', () => revealBar(frameMode), { signal });
        loopToggleBtn.addEventListener('contextmenu', clearLoop);
        clipBtn.addEventListener('click', recordClip);
        // Theater mode on the fullscreen button's right-click: a page overlay that
        // shows only the video while leaving the browser's tabs and address bar in
        // place, unlike real fullscreen on the left-click.
        // Theater mode is the default for this button: it covers the page but leaves
        // the browser's tabs and address bar visible. Real fullscreen lives inside
        // the overlay, where a click is a fresh gesture requestFullscreen accepts.
        fsBtn.addEventListener('click', () => {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            return;
          }
          openVideoTheater();
        });
        fsBtn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openVideoTheater();
        });
        loopLinkBtn.addEventListener('click', async () => {
          const range = loopRange();
          if (!range) {
            revealBar(true);
            sync();
            return;
          }
          const url = core.formatLoopUrl(location.href, range.start, range.end, settings.playbackRate);
          if (!url) return;
          let copied = false;
          try {
            await navigator.clipboard.writeText(url);
            copied = true;
          } catch (e) {
            // The async clipboard API needs a trusted gesture and a focused
            // document, and refuses otherwise. Fall back to the older selection
            // route, which succeeds in some of those cases.
            try {
              const scratch = document.createElement('textarea');
              scratch.value = url;
              scratch.setAttribute('readonly', '');
              scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
              document.body.appendChild(scratch);
              scratch.select();
              copied = document.execCommand('copy');
              scratch.remove();
            } catch (err) {
              // Both routes refused; the URL is still offered in the tooltip so the
              // loop is not lost.
            }
          }
          loopLinkBtn.textContent = copied ? 'ok' : 'err';
          // The bar button is a 22px icon slot, so short feedback text needs the
          // same widened treatment the clip progress label used.
          loopLinkBtn.classList.add('ig-vc-clip-text');
          loopLinkBtn.title = copied ? `Copied ${url}` : `Could not reach the clipboard. The link is: ${url}`;
          clearTimeout(linkFeedbackTimer);
          linkFeedbackTimer = setTimeout(() => {
            linkFeedbackTimer = null;
            sync();
          }, 1600);
          revealBar(true);
        });
        loopClearBtn.addEventListener('click', clearLoop);
        loopZoomBtn.addEventListener('click', () => {
          zoomDisabled = !zoomDisabled;
          revealBar(true);
          sync();
          updateTime();
        });
        loopRestartBtn.addEventListener('click', restartLoop);

        for (const evt of ['play', 'playing', 'pause', 'volumechange', 'ratechange']) {
          video.addEventListener(evt, sync, { signal });
        }
        // Any genuine resume ends keyboard silence. The scrub's own play() is
        // excluded, since that motion is exactly what should stay quiet.
        for (const evt of ['play', 'playing']) {
          video.addEventListener(evt, () => {
            if (!scrubbing) exitKeyboardSilence();
          }, { signal });
        }
        video.addEventListener('loadedmetadata', () => {
          frameClock.reset();
          intendedFrame = null;
          pendingDelta = 0;
          seekInFlight = false;
          dragTargetTime = null;
          dragDirty = false;
          preloadNudged = false;
          // Loop markers belong to the video that was playing, not to a recycled
          // element showing something else.
          loopIn = null;
          loopOut = null;
          looping = false;
          stopLoopWatcher();
          keyboardMuted = false;
          mount();
          sync();
          updateTime();
          applyUrlLoop();
        }, { signal });
        video.addEventListener('timeupdate', updateTime, { signal });
        video.addEventListener('progress', updateTime, { signal });
        // Pacing: the next queued step or drag target only goes out once this seek has
        // landed. A drag supersedes queued frame steps, so it is flushed first.
        video.addEventListener('seeked', () => {
          seekInFlight = false;
          flushDragSeek();
          flushSeek();
          updateTime();
        }, { signal });

        const ro = new ResizeObserver(mount);
        ro.observe(video);
        mount();
        sync();
        updateTime();
        applyUrlLoop();
        if (TOUCH) revealBar(false);

        controllers.set(video, {
          mount, sync, destroy, stepFrames, togglePlay, beginScrub, endScrub,
          setLoopIn, setLoopOut, toggleLoop, restartLoop, clearLoop,
          openTheater: openVideoTheater,
          reveal: () => revealBar(false),
          container: () => currentContainer
        });
      }

      let fsIdleTimer = null;
      const onFsMove = (e) => {
        const fs = document.fullscreenElement;
        if (!fs || !fs.classList.contains('ig-vc-player')) return;
        fs.classList.remove('idle');
        clearTimeout(fsIdleTimer);
        if (!e.target?.closest?.('.ig-vc-bar')) {
          fsIdleTimer = setTimeout(() => fs.classList.add('idle'), 2000);
        }
      };
      const onFsClick = (e) => {
        const fs = document.fullscreenElement;
        if (fs && fs.classList.contains('ig-vc-player') && !e.target.closest('.ig-vc-bar')) {
          e.stopPropagation();
          e.preventDefault();
          const v = fs.querySelector('video');
          if (v) {
            if (v.paused) {
              if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.2) {
                v.currentTime = 0;
              }
              v.play().catch(() => {});
            } else {
              v.pause();
            }
          }
        }
      };
      const onFsSync = () => {
        clearTimeout(fsIdleTimer);
        for (const el of document.querySelectorAll('.ig-vc-player.idle')) el.classList.remove('idle');
        for (const a of document.querySelectorAll('a[data-ig-href]')) {
          a.setAttribute('href', a.dataset.igHref);
          delete a.dataset.igHref;
        }
        const fs = document.fullscreenElement;
        if (fs?.classList.contains('ig-vc-player')) {
          const fsLink = fs.closest('a[href]');
          if (fsLink) {
            fsLink.dataset.igHref = fsLink.getAttribute('href');
            fsLink.removeAttribute('href');
          }
        }
        for (const ctrl of controllers.values()) ctrl.sync();
      };
      const isTypingContext = (el) =>
        Boolean(el?.isContentEditable) || Boolean(el?.closest?.(TYPING_SELECTOR));

      // Arrows move Instagram's carousels and Space scrolls the feed, so the keyboard
      // is claimed only for a player that is visibly engaged: fullscreen, under the
      // pointer, or still in keyboard mode from a recent press. Everywhere else
      // Instagram's own handling is left completely untouched.
      function resolveActiveVideo() {
        const fs = document.fullscreenElement;
        if (fs) {
          for (const video of controllers.keys()) {
            if (fs === video || fs.contains(video)) return video;
          }
        }
        let hovered = null;
        let keyboardActive = null;
        for (const [video, ctrl] of controllers.entries()) {
          if (!video.isConnected) continue;
          const container = ctrl.container();
          if (!container?.isConnected) continue;
          if (!hovered && container.matches(':hover')) hovered = video;
          if (!keyboardActive && container.classList.contains('ig-vc-kb')) keyboardActive = video;
        }
        // The pointer is a present-tense signal, so it outranks a lapsing keyboard
        // session; without it, stepping survives the mouse drifting off the player.
        return hovered || keyboardActive;
      }

      // A tap and a hold want different mechanisms: a tap wants one precise seek, a
      // hold wants continuous motion. The first press steps once, then this timer
      // decides the press became a hold and switches to scrubbing. Driving it from our
      // own timer rather than the OS key-repeat avoids the ~300-500ms repeat delay and
      // the arbitrary repeat rate that varies per machine.
      let holdTimer = null;
      let holdVideo = null;

      const stopHold = () => {
        clearTimeout(holdTimer);
        holdTimer = null;
        if (holdVideo) {
          controllers.get(holdVideo)?.endScrub();
          holdVideo = null;
        }
      };

      const onKeyDown = (e) => {
        // Leave browser and OS shortcuts and IME composition alone.
        if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        const space = e.key === ' ' || e.code === 'Space';
        const back = KEYS_FRAME_BACK.has(e.key);
        const forward = KEYS_FRAME_FORWARD.has(e.key);
        const loopIn = KEYS_LOOP_IN.has(e.key);
        const loopOut = KEYS_LOOP_OUT.has(e.key);
        const loopToggle = KEYS_LOOP_TOGGLE.has(e.key);
        const loopRestart = KEYS_LOOP_RESTART.has(e.key);
        const loopClear = KEYS_LOOP_CLEAR.has(e.key);
        const theater = KEYS_THEATER.has(e.key);
        const isLoopKey = loopIn || loopOut || loopToggle || loopRestart || loopClear;
        if (!space && !back && !forward && !isLoopKey && !theater) return;
        if (isTypingContext(e.target) || isTypingContext(document.activeElement)) return;
        const video = resolveActiveVideo();
        const ctrl = controllers.get(video);
        if (!ctrl) return;

        if (theater) {
          if (!e.repeat) ctrl.openTheater();
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (space) {
          stopHold();
          ctrl.togglePlay();
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Loop keys act once per press; holding one repeats harmlessly but is not
        // motion, so repeats are simply swallowed along with the key.
        if (isLoopKey) {
          if (!e.repeat) {
            if (loopIn) ctrl.setLoopIn();
            else if (loopOut) ctrl.setLoopOut();
            else if (loopToggle) ctrl.toggleLoop();
            else if (loopRestart) ctrl.restartLoop();
            else ctrl.clearLoop();
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // OS key-repeat is swallowed: motion is driven by the scrub, not by repeats.
        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const direction = back ? -1 : 1;
        // Tear down any scrub already running before the new press takes effect, so
        // the old one cannot restore rate and mute on top of the new motion.
        stopHold();
        // Only claim the key once the video actually acted on it.
        if (!ctrl.stepFrames(direction * (e.shiftKey ? SHIFT_FRAME_MULTIPLIER : 1))) return;
        holdVideo = video;
        const fast = e.shiftKey;
        holdTimer = setTimeout(() => {
          holdTimer = null;
          controllers.get(video)?.beginScrub(direction, fast);
        }, HOLD_DELAY_MS);
        e.preventDefault();
        e.stopPropagation();
      };

      const onKeyUp = (e) => {
        if (KEYS_FRAME_BACK.has(e.key) || KEYS_FRAME_FORWARD.has(e.key)) stopHold();
      };

      // Touch: a tap anywhere on a player reveals its bar (the site still gets the
      // tap too), and a tap outside an open menu closes it.
      const onTouchPointerDown = (e) => {
        for (const wrap of document.querySelectorAll('.ig-vc-wrap.ig-vc-open')) {
          if (!wrap.contains(e.target)) wrap.classList.remove('ig-vc-open');
        }
      };
      const onTouchPointerUp = (e) => {
        if (e.target?.closest?.('.ig-vc-bar')) return;
        for (const ctrl of controllers.values()) {
          if (ctrl.container()?.contains(e.target)) ctrl.reveal();
        }
      };
      if (TOUCH) {
        window.addEventListener('pointerdown', onTouchPointerDown, { capture: true, passive: true });
        window.addEventListener('pointerup', onTouchPointerUp, { capture: true, passive: true });
      }

      const stopVis = (e) => e.stopImmediatePropagation();
      document.addEventListener('visibilitychange', stopVis, true);
      window.addEventListener('pointermove', onFsMove, { passive: true });
      window.addEventListener('click', onFsClick, true);
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keyup', onKeyUp, true);
      // A key held while focus leaves the page never reports its keyup, which would
      // otherwise leave a scrub running indefinitely.
      window.addEventListener('blur', stopHold);
      document.addEventListener('fullscreenchange', onFsSync);

      function scanVideos() {
        if (!site || site.skipPath(location.pathname)) {
          for (const ctrl of controllers.values()) ctrl.destroy();
          controllers.clear();
          return;
        }
        for (const [vid, ctrl] of controllers.entries()) {
          if (!vid.isConnected || hasNativeControls(vid)) {
            ctrl.destroy();
            controllers.delete(vid);
          }
        }
        for (const v of document.querySelectorAll('video')) {
          if (!hasNativeControls(v)) attachVideo(v);
        }
      }

      let scanPending = false;
      const scheduleScan = () => {
        if (scanPending) return;
        scanPending = true;
        requestAnimationFrame(() => {
          scanPending = false;
          scanVideos();
        });
      };

      const observer = new MutationObserver(scheduleScan);
      window.__igVcCleanup = () => {
        clearTimeout(fsIdleTimer);
        document.removeEventListener('visibilitychange', stopVis, true);
        window.removeEventListener('pointermove', onFsMove);
        window.removeEventListener('click', onFsClick, true);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        window.removeEventListener('blur', stopHold);
        stopHold();
        document.removeEventListener('fullscreenchange', onFsSync);
        window.removeEventListener('pointerdown', onTouchPointerDown, true);
        window.removeEventListener('pointerup', onTouchPointerUp, true);
        observer.disconnect();
        for (const ctrl of controllers.values()) ctrl.destroy();
        controllers.clear();
      };

      (async () => {
        // An unsupported host should do nothing at all rather than half-initialise.
        if (!site) return;
        try { settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) }; } catch (e) {}
        scanVideos();
        observer.observe(document.documentElement, { childList: true, subtree: true });
      })();
    })();

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
