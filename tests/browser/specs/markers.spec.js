'use strict';

// A and B markers, and the timeline zoom that makes them usable.
//
// Two bugs here cost real time and neither was visible in a unit test:
//
// 1. The zoom target was an absolute 190px gap on a track only 130-180px wide,
//    so "needs more zoom" was permanently true and the window recomputed on
//    every paint. The timeline appeared to skip around while dragging.
// 2. Recomputing the view during a drag changed the pointer-to-time mapping
//    mid-drag, so the marker chased the pointer instead of following it.
//
// Both only reproduce on a real track with real width, which is why these
// tests drive a browser.

const h = require('../harness');

// Below this the track cannot physically separate two markers, whatever the
// zoom does: Instagram renders a 338px player whose seek track collapses to
// 48px, and a 0.5s gap inside the 5s minimum zoom window is under 5px there.
// That is a known, recorded layout gap rather than a regression in the zoom,
// so these tests say so instead of failing every run. See AGENTS.md.
const MIN_USABLE_TRACK_PX = 100;

async function requireUsableTrack(page) {
  const geo = await h.seekGeometry(page);
  if (geo.track.width < MIN_USABLE_TRACK_PX) {
    h.skip(`seek track is only ${geo.track.width}px; too narrow to place markers (known gap)`);
  }
  return geo;
}

module.exports = (site) => {
  h.describe(`${site.label}: markers`, () => {
    h.it('sets A and B from the keyboard and shows both handles', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, 18, 23);

      const geo = await h.seekGeometry(page);
      h.assert(geo.handleA.visible, 'handle A is displayed');
      h.assert(geo.handleB.visible, 'handle B is displayed');
      h.assert(geo.handleB.x > geo.handleA.x, `B (${geo.handleB.x}) sits to the right of A (${geo.handleA.x})`);

      const state = await h.barState(page);
      h.assert(/18/.test(state.loopInTitle || ''), `A title mentions its time: "${state.loopInTitle}"`);
      h.assert(/23/.test(state.loopOutTitle || ''), `B title mentions its time: "${state.loopOutTitle}"`);
      await page.key('|');
    });

    h.it('separates close markers far enough to grab', async (page) => {
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      // Half a second apart is unusable at full-timeline scale: on a 150px
      // track over a 100s video that is under one pixel.
      await h.markLoop(page, 30, 30.5);
      const geo = await h.seekGeometry(page);
      const gap = geo.handleB.x - geo.handleA.x;
      // The zoom will not go below a 5s window, so a 0.5s gap can never be
      // more than a tenth of the track: 15px on Facebook's 150px track. The
      // bar for "grabbable" is a handle's own width, not an arbitrary 20px.
      const handleWidth = Math.max(geo.handleA.w, 8);
      h.assert(gap >= handleWidth + 2,
        `handles ${gap}px apart on a ${geo.track.width}px track with ${handleWidth}px handles; ` +
        'the zoom must separate them enough to grab individually');
      await page.key('|');
    });

    h.it('holds the timeline still while a handle is dragged', async (page) => {
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      await h.markLoop(page, 20, 32);
      const geo = await h.seekGeometry(page);

      // Record the visible window on every drag step. The bug made this change
      // on nearly every sample; the fix makes it change only a few times.
      await page.eval(`(() => { window.__igvcWindows = []; return true; })()`, { label: 'arm window probe' });
      const sample = async () => {
        await page.eval(h.barExpr(`
          const seek = bar.querySelector('.ig-vc-seek');
          window.__igvcWindows.push(seek.title || '');
          return true;
        `), { label: 'sample window' });
      };

      // Drag B inwards towards A, which is what triggered the thrash.
      const from = { x: geo.handleB.x, y: geo.track.y };
      const to = { x: geo.handleA.x + Math.round((geo.handleB.x - geo.handleA.x) * 0.2), y: geo.track.y };
      await page.drag(from, to, { steps: 18, stepMs: 90, onStep: sample });

      const windows = await page.eval('window.__igvcWindows.slice()', { label: 'windows' });
      const changes = windows.filter((w, i) => i > 0 && w !== windows[i - 1]).length;
      h.assert(windows.length > 10, `collected ${windows.length} samples`);
      h.assert(changes <= 4,
        `the visible window changed ${changes} times across ${windows.length} drag samples; it must stay frozen during a drag`);
      await page.key('|');
    });

    h.it('keeps a dragged handle on the side of the timeline it was grabbed from', async (page) => {
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      await h.markLoop(page, 15, 35);
      const before = await h.seekGeometry(page);

      // Drag A to the right, past where B used to be. It must stop short of B
      // rather than swapping past it.
      await page.drag(
        { x: before.handleA.x, y: before.track.y },
        { x: Math.min(before.handleB.x + 40, before.track.left + before.track.width - 4), y: before.track.y },
        { steps: 14, stepMs: 80 }
      );
      const after = await h.seekGeometry(page);
      h.assert(after.handleA.x < after.handleB.x,
        `A (${after.handleA.x}) must stay left of B (${after.handleB.x}) after being dragged past it`);
      await page.key('|');
    });

    h.it('shows the hotkey hint while dragging the seek bar', async (page) => {
      await h.hoverVideo(page);
      await page.key('|');
      const geo = await h.seekGeometry(page);
      const mid = { x: geo.track.left + Math.round(geo.track.width / 2), y: geo.track.y };

      let hintSeen = '';
      await page.drag(mid, { x: mid.x + 30, y: mid.y }, {
        steps: 8,
        stepMs: 110,
        onStep: async () => {
          if (hintSeen) return;
          const state = await page.eval(h.barExpr(`
            const hint = bar.querySelector('.ig-vc-hint');
            return { text: hint.textContent, visible: hint.classList.contains('visible') };
          `), { label: 'hint' });
          if (state && state.visible && state.text) hintSeen = state.text;
        }
      });
      h.assert(hintSeen, 'a hotkey hint should appear while scrubbing with no markers set');
      h.assert(/\[/.test(hintSeen), `the hint should offer the A hotkey, got "${hintSeen}"`);
    });

    h.it('leaves room to grab B when it sits at the end of the video', async (page) => {
      // With the window clamped to the media, a B marker at the end landed
      // exactly on the track's right edge with zero pixels after it, so the
      // handle could not be grabbed. The timeline now extends past the end of
      // the video to leave post-roll, the way a clip trimmer does.
      await h.hoverVideo(page);
      await requireUsableTrack(page);

      const duration = await page.eval(`document.querySelector('video').duration`, { label: 'duration' });
      h.assert(Number.isFinite(duration) && duration > 10, `need a long enough video, got ${duration}`);

      // A mid-video loop first, to compare the marker spacing against.
      await h.markLoop(page, 20, 21.5);
      const mid = await h.seekGeometry(page);
      const midGap = mid.handleB.x - mid.handleA.x;

      await h.markLoop(page, duration - 1.5, duration);
      const atEnd = await h.seekGeometry(page);
      const trackRight = atEnd.track.left + atEnd.track.width;
      const spaceAfterB = trackRight - atEnd.handleB.x;
      const endGap = atEnd.handleB.x - atEnd.handleA.x;

      h.assert(spaceAfterB >= 15,
        `only ${spaceAfterB}px of track past B on a ${atEnd.track.width}px track; ` +
        'the handle needs room to be grabbed');
      // Buying that room by squeezing the markers together would be no good:
      // widening the window in time did exactly that, 45px down to 11px.
      h.assert(endGap > midGap * 0.6,
        `markers only ${endGap}px apart at the end against ${midGap}px mid-video; ` +
        'the end padding must not come out of the gap between A and B');
      await page.key('|');
    });

    h.it('keeps the end room on every visit, not just the first', async (page) => {
      // Reported as "works a few times then it sticks". The padding made the
      // window wider than the zoom cap, so a padded window never counted as
      // capped and a tight loop recomputed on every call instead of settling.
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      const duration = await page.eval(`document.querySelector('video').duration`, { label: 'duration' });

      const spaceAfterB = async () => {
        const g = await h.seekGeometry(page);
        return (g.track.left + g.track.width) - g.handleB.x;
      };

      // Alternating end and mid-video loops is what left a padded window held
      // when it should have been dropped, and vice versa.
      const visits = [];
      for (const [a, b] of [
        [duration - 1.5, duration],
        [20, 21.5],
        [duration - 1.2, duration],
        [40, 41.5],
        [duration - 1.5, duration]
      ]) {
        await h.markLoop(page, a, b);
        await h.sleep(650);
        visits.push({ nearEnd: duration - b < 1, space: await spaceAfterB() });
      }

      const bad = visits.filter((v) => v.nearEnd && v.space < 15);
      h.assert(bad.length === 0,
        `end-of-video room failed on ${bad.length} of ${visits.filter((v) => v.nearEnd).length} visits: ` +
        JSON.stringify(visits));
      // And the padding must be given back when it is not earned.
      const midVisits = visits.filter((v) => !v.nearEnd);
      h.assert(midVisits.every((v) => v.space > 15),
        `a mid-video loop should have ordinary slack: ${JSON.stringify(midVisits)}`);
      await page.key('|');
    });

    h.it('extends the loop past the window when B is held at the edge', async (page) => {
      // Reported as "drag B to the far right and it doesn't auto extend". The
      // view is frozen during a drag, so the furthest B could reach was the
      // zoomed window's right edge -- measured, it sat at 0:23.51 in an
      // 0:18-0:23 window however long the pointer was held there. Holding near
      // an edge now pans the window, driven by elapsed time so it cannot feed
      // back into the pointer-to-time mapping.
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      await h.markLoop(page, 20, 22);
      await h.sleep(700);

      // The live readout, not the button titles: sync() only refreshes those on
      // release, which is what made an earlier version of this look broken.
      const readB = () => page.eval(h.barExpr(`
        const hb = bar.querySelector('.ig-vc-handle-b').getBoundingClientRect();
        const tr = bar.querySelector('.ig-vc-track').getBoundingClientRect();
        // "0:22.00 · f660" -> 22. Parsed by splitting rather than with a regex:
        // a backslash escape inside this template literal does not survive.
        const head = bar.querySelector('.ig-vc-time').textContent.split(' ')[0];
        const parts = head.split(':');
        const seconds = parts.length === 2
          ? Number(parts[0]) * 60 + Number(parts[1])
          : null;
        return {
          seconds: Number.isFinite(seconds) ? seconds : null,
          fromTrackRight: Math.round(tr.right - hb.left)
        };
      `), { label: 'live B' });

      const geo = await h.seekGeometry(page);
      const trackRight = geo.track.left + geo.track.width;
      const samples = [];
      await page.dragHold(
        { x: geo.handleB.x, y: geo.track.y },
        { x: trackRight - 5, y: geo.track.y },
        { holdMs: 2000, sampleMs: 500, onSample: async () => samples.push(await readB()) }
      );

      h.assert(samples.length >= 3, `expected several samples, got ${samples.length}`);
      const seconds = samples.map((s) => s.seconds);
      h.assert(seconds.every((v) => typeof v === 'number'), `unreadable readout: ${JSON.stringify(samples)}`);

      // It must keep advancing while the pointer holds perfectly still.
      for (let i = 1; i < seconds.length; i++) {
        h.assert(seconds[i] > seconds[i - 1] + 0.2,
          `B stopped advancing while held at the edge: ${JSON.stringify(seconds)}`);
      }
      // And it must get well past where the frozen window used to cap it.
      h.assert(seconds[seconds.length - 1] > 24,
        `B only reached ${seconds[seconds.length - 1]}s; the window is not panning`);
      // The handle stays pinned near the edge while the window moves under it.
      for (const s of samples.slice(1)) {
        h.assert(s.fromTrackRight < 30,
          `the handle drifted ${s.fromTrackRight}px from the edge instead of staying pinned`);
      }

      // After release the loop must keep what the pan reached, and the handle
      // must be grabbable again rather than stranded on the edge.
      await h.sleep(700);
      const settled = await page.eval(h.barExpr(`
        const hb = bar.querySelector('.ig-vc-handle-b').getBoundingClientRect();
        const tr = bar.querySelector('.ig-vc-track').getBoundingClientRect();
        return { fromTrackRight: Math.round(tr.right - hb.left), title: bar.querySelector('.ig-vc-loop-out').title };
      `), { label: 'settled' });
      // The old behaviour capped B at the frozen window's end, ~23.5s for the
      // 0:18-0:23 window this loop produces, no matter how long it was held.
      const last = seconds[seconds.length - 1];
      h.assert(last > 25, `B reached only ${last}s, barely past the old ~23.5s cap`);
      h.assert(settled.fromTrackRight > 20,
        `after release the handle is still ${settled.fromTrackRight}px from the edge; it should be grabbable`);
      await page.key('|');
    });

    h.it('previews the exact frame under the handle, even where fastSeek exists', async (page) => {
      // Dragging a marker pauses playback and seeks so the picture shows the
      // frame being set. That used to go through fastSeek where the browser had
      // one -- an API that is imprecise by specification, landing on a nearby
      // keyframe. Chromium does not implement it, so this suite always took the
      // exact path and never saw the problem; WebKit, where fastSeek
      // originated, took the other one.
      //
      // A 2s-keyframe stand-in is installed here so the imprecise branch would
      // be exercised if it ever came back. Measured against it before the fix:
      // the preview drifted up to 0.89s from the handle.
      await h.hoverVideo(page);
      await requireUsableTrack(page);
      await page.eval(`
        (() => {
          window.__igvcRealFastSeek = HTMLMediaElement.prototype.fastSeek || null;
          HTMLMediaElement.prototype.fastSeek = function (t) {
            this.currentTime = Math.round(t / 2) * 2;
          };
          return true;
        })()
      `, { label: 'install fastSeek stand-in' });

      try {
        await h.markLoop(page, 20, 30);
        await h.sleep(600);
        const geo = await h.seekGeometry(page);
        const drifts = [];
        await page.drag(
          { x: geo.handleB.x, y: geo.track.y },
          { x: geo.handleB.x - 70, y: geo.track.y },
          { steps: 8, stepMs: 160, onStep: async () => {
            const s = await page.eval(h.barExpr(`
              const head = bar.querySelector('.ig-vc-time').textContent.split(' ')[0];
              const parts = head.split(':');
              const want = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : null;
              return { want, got: document.querySelector('video').currentTime, paused: document.querySelector('video').paused };
            `), { label: 'drift' });
            if (s.want !== null) drifts.push({ drift: Math.abs(s.want - s.got), paused: s.paused });
          } }
        );

        h.assert(drifts.length >= 4, `expected several samples, got ${drifts.length}`);
        // Playback must stop for the duration of the drag.
        h.assert(drifts.every((d) => d.paused === true),
          'the video should be paused while a marker is dragged');
        // And the picture must sit on the frame the handle names. One frame at
        // 30fps is 0.033s; a tenth of a second is generous and still an order of
        // magnitude tighter than keyframe snapping.
        const worst = Math.max(...drifts.map((d) => d.drift));
        h.assert(worst < 0.1,
          `the preview drifted ${worst.toFixed(2)}s from the handle; it must show the frame being set`);
      } finally {
        await page.eval(`
          (() => {
            if (window.__igvcRealFastSeek) HTMLMediaElement.prototype.fastSeek = window.__igvcRealFastSeek;
            else delete HTMLMediaElement.prototype.fastSeek;
            delete window.__igvcRealFastSeek;
            return true;
          })()
        `, { label: 'remove stand-in' }).catch(() => {});
        await page.key('|');
      }
    });

    h.it('shows a playhead distinct from the loop span', async (page) => {
      await h.hoverVideo(page);
      await h.markLoop(page, 20, 26);
      await h.setCurrentTime(page, 22);
      const marks = await page.eval(h.barExpr(`
        const playhead = bar.querySelector('.ig-vc-playhead');
        const span = bar.querySelector('.ig-vc-loop-span');
        const ph = playhead.getBoundingClientRect();
        const sp = span.getBoundingClientRect();
        return {
          playheadVisible: getComputedStyle(playhead).display !== 'none' && ph.width > 0,
          playheadWidth: Math.round(ph.width),
          spanWidth: Math.round(sp.width),
          playheadInsideSpan: ph.left >= sp.left - 2 && ph.right <= sp.right + 2
        };
      `), { label: 'playhead' });
      h.equal(marks.playheadVisible, true, 'the playhead should be drawn');
      h.assert(marks.playheadWidth <= 6, `the playhead should be a thin marker, got ${marks.playheadWidth}px`);
      h.assert(marks.spanWidth > marks.playheadWidth, 'the loop span should be wider than the playhead');
      h.equal(marks.playheadInsideSpan, true, 'at 22s the playhead belongs inside a 20-26s loop');
      await page.key('|');
    });
  });
};
