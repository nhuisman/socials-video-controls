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
