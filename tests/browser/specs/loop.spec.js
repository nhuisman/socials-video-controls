'use strict';
 
// Looping, which is the whole point of the extension: hold a few seconds of a
// dance move on repeat, slow it down, and jump back to the start of it.
//
// These tests watch real playback rather than asserting on state flags,
// because the loop is enforced by a watcher racing the video's own clock.
//
// One thing to know before editing: setting B with `]` STARTS the loop. There
// is no separate "now begin looping" step, and an early version of this file
// pressed `\` after marking, which switched off the loop it had just created
// and made three tests fail for a reason that had nothing to do with looping.
// `\` is a toggle; treat it as one.

const h = require('../harness');

const LOOP_START = 20;
const LOOP_END = 23;

// Plays for a while and reports where the clock went. Sampling from inside the
// page keeps the timing tight; a round trip per sample would be too coarse to
// catch an overshoot.
const playAndSample = (count, intervalMs) => `
  (async () => {
    const v = document.querySelector('video');
    v.muted = true;
    await v.play().catch(() => {});
    const out = [];
    for (let i = 0; i < ${count}; i++) {
      out.push({ t: Number(v.currentTime.toFixed(3)), rate: v.playbackRate });
      await new Promise((r) => setTimeout(r, ${intervalMs}));
    }
    v.pause();
    return out;
  })()
`;

module.exports = (site) => {
  h.describe(`${site.label}: loop`, () => {
    h.it('starts looping as soon as B is set', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      const state = await h.barState(page);
      h.equal(state.looping, true, 'setting B should start the loop with no extra step');
      await page.key('|');
    });

    h.it('keeps playback inside A and B', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      h.equal((await h.barState(page)).looping, true, 'the loop should be running');

      const samples = await page.eval(playAndSample(40, 150), { label: 'loop samples' });
      const times = samples.map((s) => s.t);
      h.assert(times.length === 40, `collected ${times.length} samples`);

      // Some overshoot is unavoidable: the watcher can only act once the video
      // has already passed B. Being a full second past it is a broken loop.
      const strays = times.filter((t) => t < LOOP_START - 0.5 || t > LOOP_END + 0.5);
      h.assert(strays.length === 0,
        `playback left the ${LOOP_START}-${LOOP_END}s loop: ${JSON.stringify(strays.slice(0, 6))}`);
      // A loop that never advances is not looping either.
      h.assert(new Set(times).size > 5, 'the video should actually be playing inside the loop');
      await page.key('|');
    });

    h.it('wraps from B back to A rather than stopping', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      const wrapped = await page.eval(`
        (async () => {
          const v = document.querySelector('video');
          v.muted = true;
          v.currentTime = ${LOOP_END - 0.3};
          await new Promise((r) => setTimeout(r, 400));
          await v.play().catch(() => {});
          let sawLate = false;
          for (let i = 0; i < 40; i++) {
            const t = v.currentTime;
            if (t > ${LOOP_END} - 0.4) sawLate = true;
            if (sawLate && t < ${LOOP_START} + 0.6) { v.pause(); return true; }
            await new Promise((r) => setTimeout(r, 120));
          }
          v.pause();
          return false;
        })()
      `, { label: 'wrap' });
      h.equal(wrapped, true, 'reaching B should send playback back to A');
      await page.key('|');
    });

    h.it('stops confining playback once the loop is toggled off', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      await page.key('\\');
      await h.sleep(500);
      const off = await h.barState(page);
      h.equal(off.looping, false, 'backslash should switch the running loop off');

      // With the loop off, playback must be free to run past B.
      await h.setCurrentTime(page, LOOP_END - 0.3);
      const samples = await page.eval(playAndSample(20, 150), { label: 'free samples' });
      const maxT = Math.max(...samples.map((s) => s.t));
      h.assert(maxT > LOOP_END + 0.4,
        `with the loop off playback should pass B; it stopped at ${maxT}`);

      // And the markers are still there to switch back on.
      const still = await h.barState(page);
      h.equal(still.hasLoop, true, 'toggling the loop off should not discard the markers');
      await page.key('|');
    });

    h.it('jumps back to A with Home', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      await h.setCurrentTime(page, LOOP_END - 0.2);
      await page.key('Home', { text: '', keyCode: 36, code: 'Home' });
      await h.sleep(700);
      const state = await h.barState(page);
      h.close(state.currentTime, LOOP_START, 0.3, 'Home returns to A');
      await page.key('|');
    });

    h.it('plays the loop at the speed the bar is set to', async (page) => {
      // There used to be two speed menus: a general one and a slow-biased one
      // inside the loop popup, with the loop borrowing the rate while it ran
      // and handing it back afterwards. One control now, and the slow end
      // (0.1x, 0.25x) moved into it so nothing became unreachable.
      await h.hoverVideo(page);
      await h.markLoop(page, LOOP_START, LOOP_END);
      await h.clickBarControl(page, '.ig-vc-opt[data-speed="0.25"]');
      await h.sleep(600);

      const samples = await page.eval(playAndSample(12, 120), { label: 'loop rates' });
      const rates = [...new Set(samples.map((s) => s.rate))];
      h.assert(rates.length === 1 && rates[0] === 0.25,
        `the loop should hold 0.25x throughout, got ${JSON.stringify(rates)}`);
      h.equal((await h.barState(page)).activeSpeed, '0.25x', 'the chosen speed is marked active');

      // And it stays put when looping stops: there is no second rate to revert
      // to, which is the behaviour that was traded away for one control.
      await page.key('\\');
      await h.sleep(600);
      const after = await h.barState(page);
      h.equal(after.looping, false, 'the loop should be off');
      h.equal(after.playbackRate, 0.25, 'the speed is the bar\'s, so it survives the loop ending');

      await h.clickBarControl(page, '.ig-vc-opt[data-speed="1"]');
      await page.key('|');
    });

    h.it('offers the slow speeds the loop menu used to own', async (page) => {
      // 0.1x and 0.25x were only ever reachable inside the loop menu, and they
      // are the whole point on a fast move. Removing that menu must not have
      // removed them.
      await h.hoverVideo(page);
      const speeds = await page.eval(h.barExpr(`
        return [...bar.querySelectorAll('.ig-vc-opt[data-speed]')].map((b) => b.dataset.speed);
      `), { label: 'speed options' });
      for (const wanted of ['0.1', '0.25', '1', '2']) {
        h.assert(speeds.includes(wanted),
          `the speed menu should offer ${wanted}x; it has ${JSON.stringify(speeds)}`);
      }
      // And there is exactly one speed menu, not two.
      const loopSpeedCount = await page.eval(h.barExpr(`
        return bar.querySelectorAll('.ig-vc-loop-speed').length;
      `), { label: 'loop speed count' });
      h.equal(loopSpeedCount, 0, 'the loop popup should no longer carry its own speed menu');
    });

    h.it('refuses a loop shorter than a few frames', async (page) => {
      await h.hoverVideo(page);
      await page.key('|');
      await h.setCurrentTime(page, 20);
      await page.key('[');
      // Same frame: there is nothing to loop over.
      await page.key(']');
      await h.sleep(400);
      const state = await h.barState(page);
      h.equal(state.hasLoop, false, 'a zero-length loop should not count as a loop');
      h.equal(state.looping, false, 'a zero-length loop should not start looping');
      await page.key('|');
    });
  });
};
