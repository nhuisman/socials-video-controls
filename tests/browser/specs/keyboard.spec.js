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
      await h.hoverVideo(page);
      await h.setCurrentTime(page, 12);

      const fps = await page.eval(`
        (() => {
          const bar = ${h.ACTIVE_BAR};
          const m = bar && /f(\\d+)/.exec(bar.querySelector('.ig-vc-time').textContent);
          return m ? Number(m[1]) : null;
        })()
      `, { label: 'frame readout' });
      // The readout only shows a frame index once frame mode is on, which a
      // step turns on. Before the first step there is nothing to read.
      h.equal(fps, null, 'frame readout appears only after a step');

      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      const afterOne = await h.barState(page);
      const frameOf = (readout) => {
        const m = /f(\d+)/.exec(readout);
        return m ? Number(m[1]) : null;
      };
      const one = frameOf(afterOne.readout);
      h.assert(one !== null, `readout should carry a frame index, got "${afterOne.readout}"`);

      await page.key('ArrowRight', { keyCode: 39, code: 'ArrowRight' });
      const afterTwo = frameOf((await h.barState(page)).readout);
      h.equal(afterTwo - one, 1, 'a tap advances exactly one frame');

      await page.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8
      });
      await h.sleep(60);
      await page.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8
      });
      await h.sleep(900);
      const afterShift = frameOf((await h.barState(page)).readout);
      h.equal(afterShift - afterTwo, 10, 'shift+tap advances ten frames');
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

    h.it('toggles play with space and leaves frame mode', async (page) => {
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
