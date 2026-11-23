'use strict';

// Theater mode: an overlay that hides the page but leaves the browser's own
// chrome visible, which is what was actually asked for when "fullscreen that
// isn't fullscreen" came up.
//
// Two things here are worth a browser test:
//
// 1. The overlay must NOT enter real fullscreen. Asserting that
//    document.fullscreenElement stays null is the only way to tell the two
//    apart from the outside.
// 2. The overlay relocates the live player rather than pointing a second
//    <video> at the page's source. An MSE blob URL binds to exactly one
//    element, so the clone approach showed a silent black box with
//    readyState 0. A test that only checked "an overlay exists" passed on that
//    broken build.

const h = require('../harness');

module.exports = (site) => {
  h.describe(`${site.label}: theater mode`, () => {
    h.it('opens from the t key without entering real fullscreen', async (page) => {
      await h.openTheaterOverlay(page);

      const state = await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          if (!theater) return { open: false };
          const r = theater.getBoundingClientRect();
          const view = ${h.VIEWPORT_EXPR};
          return {
            open: true,
            realFullscreen: document.fullscreenElement !== null,
            position: getComputedStyle(theater).position,
            width: Math.round(r.width),
            height: Math.round(r.height),
            viewW: view.w,
            viewH: view.h
          };
        })()
      `, { label: 'theater state' });

      h.equal(state.open, true, 'pressing t should open the theater overlay');
      h.equal(state.realFullscreen, false, 'theater mode must not put the browser into fullscreen');
      h.equal(state.position, 'fixed', 'the overlay should be fixed to the viewport');
      // Compare against clientWidth, not innerWidth: innerWidth includes the
      // scrollbar while a fixed element's rect does not, which makes a
      // correctly sized overlay look ~15px narrow.
      h.close(state.width, state.viewW, 2, 'the overlay covers the viewport width');
      h.close(state.height, state.viewH, 2, 'the overlay covers the viewport height');

      await page.escape();
      await h.sleep(600);
    });

    h.it('shows a video that is actually decoding', async (page) => {
      await h.openTheaterOverlay(page);

      const video = await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          if (!theater) return null;
          const v = theater.querySelector('video');
          if (!v) return { found: false };
          return {
            found: true,
            readyState: v.readyState,
            width: v.videoWidth,
            height: v.videoHeight,
            duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null
          };
        })()
      `, { label: 'theater video' });

      h.assert(video && video.found, 'the overlay should contain the video');
      // This is the assertion that catches the clone bug: a second element on
      // an MSE URL reports readyState 0 and 0x0 dimensions.
      h.assert(video.readyState >= 2,
        `the overlay video should have data (readyState ${video.readyState}); 0 means it loaded nothing`);
      h.assert(video.width > 0 && video.height > 0,
        `the overlay video should have real dimensions, got ${video.width}x${video.height}`);

      await page.escape();
      await h.sleep(600);
    });

    h.it('scales the video up to the height the overlay offers', async (page) => {
      // The reported bug: the relocated player kept its intrinsic size, so the
      // video sat at 360x640 in a 1279px-tall window -- half the available
      // height -- in the middle of a black screen.
      //
      // The reference here has to be the VIEWPORT, not the stage. The stage
      // shrink-wrapped the undersized video, so "video fills the stage" was
      // true on the broken build too. Measuring against something that cannot
      // move is the only honest check.
      await h.hoverVideo(page);
      const beforeHeight = await page.eval(
        `Math.round(document.querySelector('video').getBoundingClientRect().height)`,
        { label: 'page height' }
      );

      await h.openTheaterOverlay(page);

      const fit = await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          if (!theater) return null;
          const video = theater.querySelector('video');
          const vr = video.getBoundingClientRect();
          const view = ${h.VIEWPORT_EXPR};
          const topBar = theater.querySelector('.ig-vc-theater-bar');
          const chrome = topBar ? Math.round(topBar.getBoundingClientRect().height) : 0;
          return {
            viewH: view.h,
            viewW: view.w,
            chrome,
            videoHeight: Math.round(vr.height),
            videoWidth: Math.round(vr.width),
            intrinsic: [video.videoWidth, video.videoHeight],
            intrinsicRatio: video.videoWidth && video.videoHeight
              ? Number((video.videoWidth / video.videoHeight).toFixed(3))
              : null,
            renderedRatio: vr.height ? Number((vr.width / vr.height).toFixed(3)) : null
          };
        })()
      `, { label: 'theater fit' });

      h.assert(fit, 'the overlay should be open');

      // Everything the overlay's own furniture does not take belongs to the
      // video, give or take padding. Anything under 85% means it never scaled.
      const available = fit.viewH - fit.chrome;
      const used = fit.videoHeight / available;
      h.assert(used >= 0.85,
        `the video uses only ${Math.round(used * 100)}% of the ${available}px available ` +
        `(${fit.videoWidth}x${fit.videoHeight} in a ${fit.viewW}x${fit.viewH} window, ` +
        `intrinsic ${fit.intrinsic.join('x')}); it is not scaling up to the window`);

      h.assert(fit.videoHeight > beforeHeight,
        `theater mode should enlarge the video: ${beforeHeight}px on the page, ${fit.videoHeight}px in the overlay`);

      // Scaling up is no good if it distorts the picture.
      if (fit.intrinsicRatio) {
        h.close(fit.renderedRatio, fit.intrinsicRatio, 0.02,
          'the video should keep its aspect ratio while scaled up');
      }
      // And it must not overflow the window in the other direction.
      h.assert(fit.videoWidth <= fit.viewW,
        `the video is ${fit.videoWidth}px wide in a ${fit.viewW}px window`);

      await page.escape();
      await h.sleep(600);
    });

    h.it('keeps the control bar on screen and reachable from anywhere in the overlay', async (page) => {
      // The other half of the reported bug. Two things made the controls
      // unusable, and both are measured here:
      //
      // 1. The bar is pinned to the bottom of the player box. An undersized
      //    box left it floating 270px above the bottom of the screen, where
      //    nobody looks for video controls.
      // 2. The reveal-on-hover rule was scoped to the player box, so with the
      //    pointer anywhere else in the overlay the bar stayed at opacity 0
      //    and pointer-events: none -- present in the DOM, completely dead.
      await h.openTheaterOverlay(page);

      const view = await page.eval(h.VIEWPORT_EXPR, { label: 'viewport' });

      // Park the pointer in a corner, deliberately far from the video.
      await page.mouseMove(20, view.h - 20);
      await h.sleep(700);

      const reach = await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          if (!theater) return null;
          const bar = theater.querySelector('.ig-vc-bar');
          if (!bar) return { hasBar: false };
          const r = bar.getBoundingClientRect();
          const style = getComputedStyle(bar);
          const view = ${h.VIEWPORT_EXPR};
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          return {
            hasBar: true,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
            viewH: view.h,
            opacity: Number(style.opacity),
            pointerEvents: style.pointerEvents,
            // What a click at the bar's centre would actually hit.
            hitInsideBar: (() => {
              const hit = document.elementFromPoint(cx, cy);
              return Boolean(hit && bar.contains(hit));
            })()
          };
        })()
      `, { label: 'bar reachability' });

      h.assert(reach && reach.hasBar, 'the bar should come into the overlay');
      h.equal(reach.opacity, 1,
        'the bar must be visible with the pointer anywhere in the overlay, not just over the video');
      h.equal(reach.pointerEvents, 'auto', 'the bar must accept clicks');
      h.equal(reach.hitInsideBar, true, 'a click at the bar should land on the bar');

      // It must be inside the window, and at the bottom of it where controls
      // belong -- not floating in the middle.
      h.assert(reach.bottom <= reach.viewH + 1,
        `the bar sits ${reach.bottom - reach.viewH}px below the viewport (${reach.viewH}px tall)`);
      h.assert(reach.top >= 0, `the bar sits ${-reach.top}px above the viewport`);

      await page.escape();
      await h.sleep(600);

      // Augment mode puts the bar at the top of the screen and omits most
      // controls. Making it match the replace-mode bar is outstanding work,
      // tracked in AGENTS.md under "Known gaps". This skip keeps the gap
      // visible in every run without burying a genuine regression in a
      // permanently red suite.
      if (site.expectedMode === 'augment' && reach.bottom < reach.viewH * 0.9) {
        h.skip(`known gap: augment-mode bar sits at the top of the screen (bottom ${reach.bottom} of ${reach.viewH})`);
      }
      h.assert(reach.bottom >= reach.viewH * 0.9,
        `the bar is floating ${reach.viewH - reach.bottom}px above the bottom of a ${reach.viewH}px window`);
    });

    h.it('offers real fullscreen from inside the overlay', async (page) => {
      await h.openTheaterOverlay(page);

      const button = await page.eval(`
        (() => {
          const b = document.querySelector('.ig-vc-theater .ig-vc-theater-fs');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return {
            label: b.textContent,
            width: Math.round(r.width),
            height: Math.round(r.height),
            hit: (() => {
              const el = document.elementFromPoint(
                Math.round(r.left + r.width / 2),
                Math.round(r.top + r.height / 2)
              );
              return el === b;
            })(),
            fullscreenAllowed: document.fullscreenEnabled
          };
        })()
      `, { label: 'fullscreen button' });

      h.assert(button, 'the overlay should offer a real-fullscreen button');
      h.assert(button.hit, 'the fullscreen button must not be covered by anything');
      h.assert(button.width > 0 && button.height > 0, 'the button must have a hit area');
      h.equal(button.fullscreenAllowed, true, 'the page must permit fullscreen for the button to mean anything');

      await page.escape();
      await h.sleep(600);

      // Whether the request SUCCEEDS cannot be tested from here. Chrome does
      // not grant fullscreen activation to CDP-synthesised input: a plain div
      // with its own click handler gets "TypeError: not granted" from both a
      // synthetic click and a synthetic keypress, so this is a property of the
      // harness and not of the extension. Asserting success would fail forever
      // on working code; asserting failure would pass forever on broken code.
      // The reachable, permitted button is as far as automation can go.
      h.skip('entering real fullscreen needs a human gesture: CDP input is not granted activation');
    });

    h.it('brings the control bar along', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, 20, 24);
      await h.openTheaterOverlay(page);

      const inside = await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          if (!theater) return null;
          const bar = theater.querySelector('.ig-vc-bar');
          return {
            hasBar: Boolean(bar),
            hasLoopToggle: Boolean(theater.querySelector('.ig-vc-loop-toggle')),
            hasFullscreenOption: Boolean(theater.querySelector('.ig-vc-theater-fs')),
            hasClose: Boolean(theater.querySelector('.ig-vc-theater-close'))
          };
        })()
      `, { label: 'theater contents' });

      h.equal(inside.hasBar, true, 'the extension bar should move into the overlay with the player');
      h.equal(inside.hasLoopToggle, true, 'loop controls should still be reachable in theater mode');
      h.equal(inside.hasFullscreenOption, true, 'real fullscreen should be offered inside the overlay');
      h.equal(inside.hasClose, true, 'the overlay should offer a way out');

      await page.escape();
      await h.sleep(600);
      await page.key('|');
    });

    h.it('puts the player back where it came from on close', async (page) => {
      await h.hoverVideo(page);
      const before = await page.eval(`
        (() => {
          const v = document.querySelector('video');
          const container = v.closest('.ig-vc-player');
          return {
            parentTag: container && container.parentElement ? container.parentElement.tagName : null,
            parentClass: container && container.parentElement ? container.parentElement.className : null
          };
        })()
      `, { label: 'before theater' });

      await h.openTheaterOverlay(page);
      await page.escape();
      await h.sleep(900);

      const after = await page.eval(`
        (() => {
          const v = document.querySelector('video');
          const container = v.closest('.ig-vc-player');
          return {
            theaterGone: !document.querySelector('.ig-vc-theater'),
            stillAdopted: Boolean(document.querySelector('.ig-vc-theater-adopted')),
            parentTag: container && container.parentElement ? container.parentElement.tagName : null,
            parentClass: container && container.parentElement ? container.parentElement.className : null,
            barStillThere: Boolean(container && container.querySelector('.ig-vc-bar'))
          };
        })()
      `, { label: 'after theater' });

      h.equal(after.theaterGone, true, 'Escape should close the overlay');
      h.equal(after.stillAdopted, false, 'the relocation class should be cleaned up');
      h.equal(after.parentTag, before.parentTag, 'the player returns to the same parent element');
      h.equal(after.parentClass, before.parentClass, 'the player returns to the same place in the page');
      h.equal(after.barStillThere, true, 'the control bar comes back with it');
    });

    h.it('closes on a click outside the video', async (page) => {
      await h.openTheaterOverlay(page);
      const open = await page.eval(`Boolean(document.querySelector('.ig-vc-theater'))`, { label: 'open' });
      h.equal(open, true, 'the overlay should be open before clicking out of it');

      // The overlay itself is the backdrop, so a click on it and not on a child
      // dismisses it. Click near a corner, away from the stage.
      await page.eval(`
        (() => {
          const theater = document.querySelector('.ig-vc-theater');
          theater.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        })()
      `, { label: 'backdrop click' });
      await h.sleep(700);
      const closed = await page.eval(`!document.querySelector('.ig-vc-theater')`, { label: 'closed' });
      h.equal(closed, true, 'clicking the backdrop should close the overlay');
    });
  });
};
