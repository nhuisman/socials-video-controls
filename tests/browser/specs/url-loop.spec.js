'use strict';

// Loading a loop from the URL, and producing a link that carries one.
//
// This is the most timing-sensitive thing the extension does. Facebook strips
// the fragment from the address bar about 1.3 seconds after navigation, which
// is before DOMContentLoaded. A reader that runs at document_idle sees a URL
// with no loop in it. The only reason this works is that capture-url.js runs
// at document_start and stashes the fragment before the page can clean it.
//
// No unit test can catch a regression here: it is entirely about when the code
// runs relative to the site's own script.

const h = require('../harness');

const LOOP_START = 30.01;
const LOOP_END = 34.51;
const LOOP_RATE = 0.25;

module.exports = (site) => {
  h.describe(`${site.label}: loop in the URL`, () => {
    h.it('captures the fragment before the site can strip it', async (page) => {
      const url = `${site.url.split('#')[0]}#loop=${LOOP_START},${LOOP_END},${LOOP_RATE}`;
      await h.loadExtension(page, url);

      const captured = await page.eval(`
        (() => {
          const stash = window.__igVcLaunchUrl;
          return {
            stashed: stash ? stash.hash : null,
            addressBarNow: location.hash
          };
        })()
      `, { label: 'launch url' });

      h.assert(captured.stashed && captured.stashed.includes('loop='),
        `capture-url.js must stash the fragment, got ${JSON.stringify(captured.stashed)}`);
      // On Facebook the address bar is already clean by now. That is the point:
      // the stash is what makes the feature work, not location.hash.
      if (!captured.addressBarNow.includes('loop=')) {
        h.assert(true, 'the site stripped the fragment, and the stash still has it');
      }
    });

    h.it('applies the loop from the URL to the player', async (page) => {
      const url = `${site.url.split('#')[0]}#loop=${LOOP_START},${LOOP_END},${LOOP_RATE}`;
      await h.loadExtension(page, url);
      await h.hoverVideo(page);
      await h.sleep(1500);

      const state = await h.barState(page);
      h.assert(/30/.test(state.loopInTitle || ''),
        `A should come from the URL, got "${state.loopInTitle}"`);
      h.assert(/34/.test(state.loopOutTitle || ''),
        `B should come from the URL, got "${state.loopOutTitle}"`);
      h.equal(state.activeSpeed, '0.25x', 'the speed should come from the URL too');
      h.equal(state.hasLoop, true, 'a URL loop is a loop, so the loop-link button should show');
      await page.key('|');
    });

    h.it('opens the video at A, not at the start', async (page) => {
      // A shared loop link is an invitation to watch one passage. Before this,
      // the markers were applied but the video stayed wherever the site had
      // left it, so the loop only engaged if playback wandered into range.
      const url = `${site.url.split('#')[0]}#loop=${LOOP_START},${LOOP_END},${LOOP_RATE}`;
      await h.loadExtension(page, url);
      await h.hoverVideo(page);
      await h.sleep(2000);

      const state = await h.barState(page);
      // The invariant is that the link lands on the move. Asserting the exact
      // value of A is wrong: the loop is already running by the time this
      // samples, so the clock has legitimately advanced past A.
      h.assert(state.currentTime >= LOOP_START - 0.3 && state.currentTime <= LOOP_END,
        `a loop link should open inside the ${LOOP_START}-${LOOP_END}s loop, not at ${state.currentTime}s`);
      h.assert(state.currentTime > 5,
        `the video should not still be near the start; it is at ${state.currentTime}s`);
      h.equal(state.looping, true, 'a loop link should arrive already looping');
      await page.key('|');
    });

    h.it('ignores a malformed loop fragment without breaking the bar', async (page) => {
      await h.loadExtension(page, `${site.url.split('#')[0]}#loop=notanumber,alsonot`);
      await h.hoverVideo(page);
      const state = await h.barState(page);
      // The bar must still be there and still be usable.
      h.assert(state.order.length > 2, 'the bar should still build with a junk fragment');
      h.equal(state.hasLoop, false, 'a junk fragment should leave no loop set');
    });

    h.it('writes the loop into the address bar as it changes', async (page) => {
      await h.hoverVideo(page);
      await page.key('|');
      await h.sleep(900);

      const hash = () => page.eval('location.hash', { label: 'hash' });
      await h.markLoop(page, 20, 24);
      await h.sleep(1000);
      const marked = await hash();

      if (!marked.includes('loop=')) {
        // Facebook rewrites its own address bar and may strip the fragment
        // again. The link button remains the reliable route there.
        h.skip('the site stripped the fragment back out of the address bar');
      }

      const parse = (h2) => (/#loop=([0-9.,]+)/.exec(h2) || [])[1]?.split(',').map(Number) || [];
      let parts = parse(marked);
      h.close(parts[0], 20, 0.5, 'the address bar carries A');
      h.close(parts[1], 24, 0.5, 'the address bar carries B');

      // Changing the practice speed is part of the shared loop.
      await h.clickBarControl(page, '.ig-vc-opt[data-speed="0.25"]');
      await h.sleep(1000);
      parts = parse(await hash());
      h.equal(parts[2], 0.25, 'the address bar carries the loop rate');

      // Moving the loop updates rather than appends.
      await h.markLoop(page, 30, 33);
      await h.sleep(1000);
      const moved = await hash();
      parts = parse(moved);
      h.close(parts[0], 30, 0.5, 'the address bar follows the loop');
      h.assert(!/loop=.*loop=/.test(moved), `exactly one loop in the URL, got ${moved}`);

      // And clearing takes it away, so a copied URL cannot carry a loop the
      // page is no longer showing.
      await page.key('|');
      await h.sleep(1000);
      h.assert(!(await hash()).includes('loop='), 'clearing the loop strips the fragment');
    });

    h.it('does not fill the back button with loop edits', async (page) => {
      // Assigning location.hash would push a history entry per edit, so a few
      // minutes of trimming would bury the back button. replaceState does not.
      await h.hoverVideo(page);
      await page.key('|');
      await h.sleep(900);
      const before = await page.eval('history.length', { label: 'history before' });
      await h.markLoop(page, 20, 24);
      await h.sleep(900);
      await h.markLoop(page, 30, 33);
      await h.sleep(900);
      await h.clickBarControl(page, '.ig-vc-opt[data-speed="0.5"]');
      await h.sleep(900);
      const after = await page.eval('history.length', { label: 'history after' });
      h.assert(after - before <= 1,
        `three loop edits added ${after - before} history entries; they should add none`);
      await page.key('|');
    });

    h.it('builds a shareable link from the current loop', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, 20, 24);
      await h.clickBarControl(page, '.ig-vc-opt[data-speed="0.5"]');

      // The clipboard needs a trusted gesture that a scripted click does not
      // supply, so assert on the link the button reports rather than on the
      // clipboard contents.
      await h.clickBarControl(page, '.ig-vc-loop-link');
      await h.sleep(700);
      const link = await page.eval(h.barExpr(`
        const btn = bar.querySelector('.ig-vc-loop-link');
        return { title: btn.title, label: btn.textContent };
      `), { label: 'link button' });

      const match = /#loop=([0-9.,]+)/.exec(link.title || '');
      h.assert(match, `the link button should report a loop URL, got "${link.title}"`);
      const parts = match[1].split(',').map(Number);
      h.close(parts[0], 20, 0.5, 'the link carries A');
      h.close(parts[1], 24, 0.5, 'the link carries B');
      h.equal(parts[2], 0.5, 'the link carries the loop rate when it is not 1x');
      h.assert(!/#.*#/.test(link.title), 'the link should carry exactly one fragment');
      await page.key('|');
    });

    h.it('round-trips a generated link back into the same loop', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, 18, 21);
      await h.clickBarControl(page, '.ig-vc-loop-link');
      await h.sleep(700);
      const title = await page.eval(h.barExpr(`return bar.querySelector('.ig-vc-loop-link').title;`),
        { label: 'link title' });
      const url = (/(https?:\/\/\S+#loop=[0-9.,]+)/.exec(title || '') || [])[1];
      if (!url) h.skip('the link button did not report a URL to round-trip');

      await h.loadExtension(page, url);
      await h.hoverVideo(page);
      await h.sleep(1500);
      const state = await h.barState(page);
      h.assert(/18/.test(state.loopInTitle || ''), `A survives the round trip: "${state.loopInTitle}"`);
      h.assert(/21/.test(state.loopOutTitle || ''), `B survives the round trip: "${state.loopOutTitle}"`);
      await page.key('|');
    });
  });
};
