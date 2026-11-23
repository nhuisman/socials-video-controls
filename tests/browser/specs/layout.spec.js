'use strict';

// Control bar layout on a real player.
//
// This group exists because adding loop controls twice pushed the fullscreen
// and cache buttons out of view on Instagram, and neither time was caught
// before shipping. The bar has very little slack on a narrow player, so its
// layout is now asserted against the real thing.

const h = require('../harness');

module.exports = (site) => {
  h.describe(`${site.label}: bar layout`, () => {
    h.it('runs in the expected mode', async (page) => {
      const state = await h.barState(page);
      const mode = state.augmentMode ? 'augment' : 'replace';
      h.equal(mode, site.expectedMode, 'site adapter mode');
    });

    h.it('puts jump-back-to-A first, ahead of play', async (page) => {
      const state = await h.barState(page);
      h.assert(state.order.length > 2, 'bar has controls');
      h.assert(state.order[0].includes('loop-restart'), `first control is ${state.order[0]}`);
      h.assert(state.order[1].includes('play'), `second control is ${state.order[1]}`);
    });

    h.it('sits flush with the bottom of the player', async (page) => {
      // Facebook used to run in augment mode, which pinned a stripped bar to
      // the top-left. Both sites now carry the same bottom bar.
      await h.hoverVideo(page);
      const pos = await page.eval(h.barExpr(`
        const video = document.querySelector('video');
        const vr = video.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        return {
          gapFromBottom: Math.round(vr.bottom - br.bottom),
          barWidth: Math.round(br.width),
          videoWidth: Math.round(vr.width),
          opacity: Number(getComputedStyle(bar).opacity)
        };
      `), { label: 'bar position' });
      h.close(pos.gapFromBottom, 0, 2, 'the bar should sit on the bottom edge of the player');
      h.close(pos.barWidth, pos.videoWidth, 4, 'the bar should span the player width');
      h.equal(pos.opacity, 1, 'and be visible while the player is hovered');
    });

    h.it('leaves no second seek control in the player', async (page) => {
      // Our bar occupies the bottom of the player, which is exactly where
      // Facebook draws its own progress slider, so theirs is hidden. Two seek
      // controls stacked on each other is the bug this guards against.
      await h.hoverVideo(page);
      const foreign = await page.eval(h.barExpr(`
        const player = bar.closest('.ig-vc-player');
        return [...player.querySelectorAll('[role="slider"]')]
          .filter((sl) => !sl.closest('.ig-vc-bar') && getComputedStyle(sl).display !== 'none')
          .map((sl) => sl.getAttribute('aria-valuetext') || sl.getAttribute('aria-label') || '(unlabelled)');
      `), { label: 'foreign sliders' });
      h.assert(foreign.length === 0,
        `the site's own seek control is still visible: ${JSON.stringify(foreign)}`);
    });

    h.it('plays and pauses from the bar', async (page) => {
      // A real click, not el.click(): Facebook re-pauses a video that no
      // genuine gesture started, so a scripted click leaves it paused and the
      // play button looks broken when it is not.
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 10);
      const before = await h.barState(page);
      h.equal(before.paused, true, 'starts paused');

      await h.clickBarControlReal(page, '.ig-vc-play');
      await h.sleep(900);
      const playing = await h.barState(page);
      h.equal(playing.paused, false, 'the play button should start playback');

      await h.clickBarControlReal(page, '.ig-vc-play');
      await h.sleep(600);
      const paused = await h.barState(page);
      h.equal(paused.paused, true, 'and stop it again');
    });

    h.it('fits every control inside the bar', async (page) => {
      await h.hoverVideo(page);
      const fit = await page.eval(h.barExpr(`
        const barRect = bar.getBoundingClientRect();
        const style = getComputedStyle(bar);
        const padRight = parseFloat(style.paddingRight) || 0;
        const limit = barRect.width - padRight;
        const clipped = [];
        for (const child of bar.children) {
          if (getComputedStyle(child).display === 'none') continue;
          const r = child.getBoundingClientRect();
          const right = r.right - barRect.left;
          if (right > limit + 0.5) clipped.push({ cls: child.className.replace(/ig-vc-|btn /g, ''), over: Math.round(right - limit) });
        }
        return { barWidth: Math.round(barRect.width), limit: Math.round(limit), clipped };
      `), { label: 'fit check' });
      h.assert(fit.clipped.length === 0,
        `controls pushed out of a ${fit.barWidth}px bar: ${JSON.stringify(fit.clipped)}`);
    });

    h.it('still fits with the widest readout the bar can show', async (page) => {
      await h.hoverVideo(page);
      // Frame mode lengthens the readout, which is what clipped the right-hand
      // buttons before. Force the longest form it can produce.
      const fit = await page.eval(h.barExpr(`
        const time = bar.querySelector('.ig-vc-time');
        const before = time.textContent;
        time.textContent = '1:02:05.75 \\u00b7 f111772';
        const barRect = bar.getBoundingClientRect();
        const padRight = parseFloat(getComputedStyle(bar).paddingRight) || 0;
        const limit = barRect.width - padRight;
        const clipped = [];
        for (const child of bar.children) {
          if (getComputedStyle(child).display === 'none') continue;
          const r = child.getBoundingClientRect();
          if (r.right - barRect.left > limit + 0.5) clipped.push(child.className.replace(/ig-vc-|btn /g, ''));
        }
        time.textContent = before;
        return { clipped, barWidth: Math.round(barRect.width) };
      `), { label: 'wide readout fit' });
      h.assert(fit.clipped.length === 0,
        `a long readout clipped ${JSON.stringify(fit.clipped)} on a ${fit.barWidth}px bar`);
    });

    h.it('hides the loop-link button until a loop exists', async (page) => {
      await h.hoverVideo(page);
      await page.key('|');
      const before = await h.barState(page);
      h.equal(before.hasLoop, false, 'the loop-link button should be hidden with no markers');
      await h.markLoop(page, 10, 14);
      const after = await h.barState(page);
      h.equal(after.hasLoop, true, 'the loop-link button should appear once A and B are set');
      await page.key('|');
    });
  });
};
