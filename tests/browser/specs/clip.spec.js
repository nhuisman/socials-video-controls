'use strict';

// Clip export: record the A-B loop to a file and show it straight away.
//
// Recording runs in real time, so these tests mark a deliberately short loop
// (config.clipLoopSeconds). The download is stubbed so a run does not litter
// the Downloads folder, and what would have been saved is asserted instead.
//
// This cannot be unit tested at all: it depends on MediaRecorder accepting a
// captured stream from the site's own MSE-backed video element, which is a
// browser-and-site behaviour, not a function of ours.

const h = require('../harness');

const START = 20;

module.exports = (site) => {
  h.describe(`${site.label}: clip export`, () => {
    h.it('offers a recorder format the browser supports', async (page) => {
      // The candidate list lives in content.js; what matters is that at least
      // one of them survives this browser's MediaRecorder.
      const chosen = await page.eval(`
        (() => {
          const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
          return window.__igVcCore.pickRecorderMime(candidates, (m) => window.MediaRecorder.isTypeSupported(m));
        })()
      `, { label: 'pickRecorderMime' });
      h.assert(typeof chosen === 'string' && chosen.length > 0,
        `none of the clip formats are supported here, got ${JSON.stringify(chosen)}`);
      const supported = await page.eval(`MediaRecorder.isTypeSupported(${JSON.stringify(chosen)})`,
        { label: 'isTypeSupported' });
      h.equal(supported, true, `the chosen format ${chosen} should be supported here`);
    });

    h.it('can capture a stream from the site player', async (page) => {
      // If this fails, clip export cannot work on this site at all, and the
      // recording test below would fail for a reason that has nothing to do
      // with our code.
      const capture = await page.eval(`
        (() => {
          const v = document.querySelector('video');
          if (typeof v.captureStream !== 'function') return { ok: false, reason: 'captureStream missing' };
          try {
            const stream = v.captureStream();
            const tracks = stream.getTracks().map((t) => t.kind);
            for (const t of stream.getTracks()) t.stop();
            return { ok: true, tracks };
          } catch (e) {
            return { ok: false, reason: String(e && e.message) };
          }
        })()
      `, { label: 'captureStream' });
      h.assert(capture.ok, `captureStream failed: ${capture.reason}`);
      h.assert(capture.tracks.includes('video'), `expected a video track, got ${JSON.stringify(capture.tracks)}`);
    });

    h.it('disables the clip option when there is no loop to export', async (page) => {
      await h.hoverVideo(page);
      await page.key('|');
      const state = await h.barState(page);
      h.equal(state.clipUnavailable, true, 'nothing to export means the clip option is disabled');
    });

    h.it('records the loop and saves a named file', async (page) => {
      await h.hoverVideo(page);
      await h.stubDownloads(page);
      const end = START + h.config.clipLoopSeconds;
      await h.markLoop(page, START, end);
      // Recording from an unbuffered position stalls, which looks exactly like
      // a broken recorder. Let the loop region arrive first.
      if (!(await h.waitForSeekable(page, START))) h.skip('the loop region never buffered');

      await h.clickBarControl(page, '.ig-vc-clip');

      // Recording is real time plus a lead-in and the encoder flush. Poll
      // rather than sleeping a fixed amount, so a slow machine does not fail.
      const deadline = Date.now() + Math.ceil((h.config.clipLoopSeconds + 12) * 1000);
      let saved = [];
      while (Date.now() < deadline) {
        saved = await h.savedFilenames(page);
        if (saved.length) break;
        await h.sleep(500);
      }
      h.assert(saved.length === 1, `expected one saved clip, got ${JSON.stringify(saved)}`);

      const name = saved[0];
      h.assert(/\.webm$/.test(name), `clip should be a .webm, got "${name}"`);
      // Times go into the filename with a 'p' standing in for the decimal
      // point, because a dot there reads as a second extension.
      h.assert(/\d+p\d+-\d+p\d+\.webm$/.test(name),
        `clip name should carry the loop bounds, got "${name}"`);
      h.assert(new RegExp(site.label.toLowerCase()).test(name) || /instagram|facebook/.test(name),
        `clip name should name the site, got "${name}"`);
    });

    h.it('shows the finished clip in the theater overlay', async (page) => {
      await h.hoverVideo(page);
      await h.stubDownloads(page);
      const end = START + h.config.clipLoopSeconds;
      await h.markLoop(page, START, end);
      if (!(await h.waitForSeekable(page, START))) h.skip('the loop region never buffered');
      await h.clickBarControl(page, '.ig-vc-clip');

      const deadline = Date.now() + Math.ceil((h.config.clipLoopSeconds + 14) * 1000);
      let overlay = null;
      while (Date.now() < deadline) {
        overlay = await page.eval(`
          (() => {
            const theater = document.querySelector('.ig-vc-theater');
            if (!theater) return null;
            const v = theater.querySelector('video');
            return {
              label: theater.querySelector('.ig-vc-theater-label').textContent,
              hasSave: Boolean(theater.querySelector('.ig-vc-theater-save')),
              srcIsBlob: Boolean(v && /^blob:/.test(v.src || '')),
              readyState: v ? v.readyState : null
            };
          })()
        `, { label: 'clip overlay' });
        if (overlay) break;
        await h.sleep(500);
      }

      h.assert(overlay, 'the finished clip should open in the theater overlay');
      // The clip overlay is the one case that does own a separate video
      // element, because the clip is a plain blob rather than an MSE stream.
      h.equal(overlay.srcIsBlob, true, 'the overlay should play the recorded blob');
      h.assert(/MB/.test(overlay.label), `the overlay should report the clip size, got "${overlay.label}"`);
      h.equal(overlay.hasSave, true, 'the overlay should offer to save the clip again');

      await page.escape();
      await h.sleep(600);
      await page.key('|');
    });

    h.it('restores playback state after a recording', async (page) => {
      await h.hoverVideo(page);
      await h.stubDownloads(page);
      const end = START + h.config.clipLoopSeconds;
      await h.markLoop(page, START, end);

      if (!(await h.waitForSeekable(page, START))) h.skip('the loop region never buffered');
      await h.clickBarControl(page, '.ig-vc-opt[data-speed="0.5"]');
      await h.clickBarControl(page, '.ig-vc-clip');

      const deadline = Date.now() + Math.ceil((h.config.clipLoopSeconds + 14) * 1000);
      while (Date.now() < deadline) {
        const saved = await h.savedFilenames(page);
        if (saved.length) break;
        await h.sleep(500);
      }
      await h.sleep(800);
      await page.escape();
      await h.sleep(600);

      // Recording borrows the player: it unmutes and forces 1x so the capture
      // is normal speed. Afterwards it must give back exactly what it took,
      // which with the loop running at 0.5x means 0.5x, not 1x.
      const state = await h.barState(page);
      h.equal(state.activeSpeed, '0.5x', 'the speed selection survives a recording');
      h.equal(state.looping, true, 'the loop should still be running after a recording');
      h.equal(state.playbackRate, 0.5,
        'the player should be handed back at the loop speed it was borrowed from');
      await page.key('|');
    });
  });
};
