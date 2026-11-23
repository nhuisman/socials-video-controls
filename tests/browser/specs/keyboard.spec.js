'use strict';

// Keyboard navigation on a real player.
//
// The unit suite already covers the arithmetic of stepping. What it cannot
// cover is whether a key press reaches the right video at all: the bindings
// are scoped to the player the user is visibly engaged with, so a regression
// here looks like "the arrow keys stopped working" rather than a wrong number.

const h = require('../harness');

module.exports = (site) => {
  h.describe(`${site.label}: keyboard`, () => {
    h.it('steps one frame per tap and ten with shift', async (page) => {
      // Asserted on currentTime rather than on a frame index in the readout.
      // The readout used to carry one and no longer does -- it always shows
      // time now -- and currentTime is the better reference anyway: it is the
      // thing stepping actually has to get right.
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 12);

      const now = async () => (await h.barState(page)).currentTime;
      const key = (shift) => page.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, ...(shift ? { modifiers: 8 } : {})
      }).then(() => h.sleep(60)).then(() => page.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, ...(shift ? { modifiers: 8 } : {})
      })).then(() => h.sleep(700));

      // The first step from an arbitrary position both snaps to a frame centre
      // and advances, so its delta can exceed one frame. Discard it and measure
      // from an aligned start -- measured 0.0500s for that first step on a 30fps
      // reel, which is why this alignment matters.
      await key(false);
      const aligned = await now();

      await key(false);
      const afterOne = await now();
      const frame = afterOne - aligned;
      // One frame between 16fps and 80fps.
      h.assert(frame > 0.012 && frame < 0.063,
        `an aligned tap moved ${frame.toFixed(4)}s, which is not one frame`);

      await key(false);
      const afterTwo = await now();
      h.close(afterTwo - afterOne, frame, 0.006, 'a further tap moves the same one frame');

      await key(true);
      const afterShift = await now();
      const shiftStep = afterShift - afterTwo;
      h.close(shiftStep / frame, 10, 1.2,
        `shift moved ${shiftStep.toFixed(4)}s against a ${frame.toFixed(4)}s frame, which is not ten frames`);
    });

    h.it('always shows a time, never a frame index', async (page) => {
      // The readout used to swap to "0:22.00 · f660" while stepping and revert
      // a few seconds later, which read as the time vanishing.
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 12);
      const before = (await h.barState(page)).readout;
      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      await h.sleep(500);
      const after = (await h.barState(page)).readout;

      for (const [label, text] of [['before stepping', before], ['after stepping', after]]) {
        h.assert(!text.includes('f'), `${label}: readout should carry no frame index, got "${text}"`);
        h.assert(text.includes('/'), `${label}: readout should show position and duration, got "${text}"`);
        h.assert(/\d:\d\d/.test(text), `${label}: readout should look like a time, got "${text}"`);
      }
      // Stepping adds sub-second precision, because whole seconds cannot tell
      // one frame from the next.
      h.assert(after.includes('.'), `after stepping the position should gain decimals, got "${after}"`);
    });

    h.it('steps backwards as far as it stepped forwards', async (page) => {
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 20);
      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      const start = (await h.barState(page)).currentTime;
      for (let i = 0; i < 5; i++) await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      for (let i = 0; i < 5; i++) await page.key('ArrowLeft', { keyCode: 37, code: 'ArrowLeft' });
      await h.sleep(600);
      const end = (await h.barState(page)).currentTime;
      // Seeks land on frame centres, so a round trip returns to the same frame
      // rather than drifting by a rounding error each way.
      h.close(end, start, 0.02, 'five frames forward then back returns to the start');
    });

    h.it('plays no sound while the arrow keys are driving', async (page) => {
      await h.hoverVideo(page);
      await page.eval(`(() => { const v = document.querySelector('video'); v.muted = false; v.volume = 1; return true; })()`,
        { label: 'unmute' });
      await h.setCurrentTime(page, 15);

      // Hold, so the forward jog runs: that path plays the video at a reduced
      // rate, which is exactly where audio leaked through before.
      await page.holdKey('ArrowRight', 700);
      const during = await page.eval(`(() => { const v = document.querySelector('video'); return { muted: v.muted, rate: v.playbackRate }; })()`,
        { label: 'during jog' });
      // By the time this reads back the key is already up, so assert the end
      // state restored rather than the mid-jog state.
      h.equal(during.rate, 1, 'playback rate is restored after the jog');

      const silent = await page.eval(`
        (() => {
          const v = document.querySelector('video');
          window.__igvcAudio = [];
          const probe = setInterval(() => window.__igvcAudio.push(v.muted), 60);
          setTimeout(() => clearInterval(probe), 800);
          return true;
        })()
      `, { label: 'arm audio probe' });
      h.equal(silent, true, 'probe armed');
      await page.holdKey('ArrowRight', 650);
      const samples = await page.eval('window.__igvcAudio.slice()', { label: 'audio samples' });
      h.assert(samples.length > 3, `probe collected ${samples.length} samples`);
      h.assert(samples.some((muted) => muted === true), 'the video is muted at some point during a jog');
    });

    h.it('toggles play with space', async (page) => {
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 8);
      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      const stepped = await h.barState(page);
      h.equal(stepped.paused, true, 'stepping leaves the video paused');

      await page.key(' ', { text: ' ', code: 'Space', keyCode: 32 });
      await h.sleep(900);
      const playing = await h.barState(page);
      h.equal(playing.paused, false, 'space resumes playback');

      await page.key(' ', { text: ' ', code: 'Space', keyCode: 32 });
      await h.sleep(400);
      const repaused = await h.barState(page);
      h.equal(repaused.paused, true, 'space pauses again');
    });

    h.it('ignores arrow keys while a text field has focus', async (page) => {
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 25);
      const before = (await h.barState(page)).currentTime;
      await page.eval(`
        (() => {
          const input = document.createElement('input');
          input.id = '__igvc_probe_input';
          input.type = 'text';
          document.body.appendChild(input);
          input.focus();
          return document.activeElement === input;
        })()
      `, { label: 'focus input' });
      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      await h.sleep(400);
      const after = (await h.barState(page)).currentTime;
      await page.eval(`(() => { document.getElementById('__igvc_probe_input')?.remove(); return true; })()`,
        { label: 'remove input' });
      h.close(after, before, 0.01, 'typing in a field must not scrub the video');
    });
  });
};
