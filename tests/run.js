#!/usr/bin/env node
'use strict';

// Test suite for Instagram Video Control.
//
//   node tests/run.js            run everything
//   node tests/run.js frame      run only groups whose name contains "frame"
//
// No dependencies and no build step: this loads content/core.js directly, so it
// exercises the same code the extension ships rather than a copy of it. Logic
// that cannot be separated from the <video> element is driven through a fake
// element here; see COVERAGE at the bottom of this file for what is and is not
// covered.

const core = require('../content/core.js');

// Mirrors the constants content.js passes into core.
const FPS_CANDIDATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
const FPS_SNAP_TOLERANCE = 0.02;
const SCRUB_MAX_CATCHUP_FRAMES = 3;
const SEEK_STALL_MS = 1000;
const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 59.94, 60];

//#region Harness

const filter = process.argv[2];
let passed = 0;
const failures = [];
const notes = [];
let currentGroup = '';

function group(name, body) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
  currentGroup = name;
  console.log(`\n${name}`);
  body();
}

function test(name, body) {
  try {
    body();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ group: currentGroup, name, message: err.message });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function note(text) {
  notes.push(text);
  console.log(`       ${text}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function close(actual, expected, epsilon, message) {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(`${message || 'values differ'}: got ${actual}, want ${expected} +/- ${epsilon}`);
  }
}

//#endregion

//#region Fakes

// A <video> stand-in whose seeks complete only when the test says so, which is
// what makes the one-seek-in-flight sequencing observable.
function fakeVideo({ duration = 12, fps = 30, hasFastSeek = false } = {}) {
  return {
    duration,
    fps,
    currentTime: 0,
    paused: true,
    pendingSeek: null,
    issued: [],
    hasFastSeek,
    seek(time, kind) {
      this.pendingSeek = time;
      this.issued.push({ time, kind });
    },
    // Completes the outstanding seek. Returns false when there was none.
    land() {
      if (this.pendingSeek === null) return false;
      this.currentTime = this.pendingSeek;
      this.pendingSeek = null;
      return true;
    },
    frame() {
      return core.frameIndexAt(this.currentTime, this.fps);
    }
  };
}

// Drives core.stepTarget with the same sequencing content.js uses: intent is
// tracked separately from currentTime, and one seek is in flight at a time.
function stepper(video) {
  let intendedFrame = null;
  let pendingDelta = 0;
  let inFlight = false;
  let startedAt = 0;
  let now = 0;

  const blocked = () => core.isSeekBlocked({ inFlight, startedAt, now, stallMs: SEEK_STALL_MS });

  const flush = () => {
    if (blocked() || pendingDelta === 0) return;
    const base = intendedFrame ?? video.frame();
    const target = core.stepTarget({
      base,
      pendingDelta,
      lastFrame: core.lastFrameIndexFor(video.duration, video.fps),
      hasIntent: intendedFrame !== null
    });
    pendingDelta = 0;
    if (target === null) return;
    intendedFrame = target;
    inFlight = true;
    startedAt = now;
    video.seek(core.frameCenter(target, video.fps), 'exact');
  };

  return {
    advance(ms) { now += ms; },
    step(delta) {
      if (!inFlight && pendingDelta === 0) intendedFrame = video.frame();
      pendingDelta += delta;
      flush();
    },
    landed() { inFlight = false; flush(); },
    get busy() { return inFlight || pendingDelta !== 0; },
    get intent() { return intendedFrame; }
  };
}

// Drives core.dragSeekDecision the way bindSlider's callbacks do.
function dragger(video) {
  let target = null;
  let dirty = false;
  let inFlight = false;
  let startedAt = 0;
  let now = 0;
  let intendedFrame = null;

  const blocked = () => core.isSeekBlocked({ inFlight, startedAt, now, stallMs: SEEK_STALL_MS });

  const flush = () => {
    const decision = core.dragSeekDecision({
      blocked: blocked(),
      dirty,
      target,
      currentTime: video.currentTime
    });
    if (decision === 'wait') return;
    dirty = false;
    if (decision === 'redundant') return;
    inFlight = true;
    startedAt = now;
    video.seek(target, video.hasFastSeek ? 'fast' : 'exact');
  };

  return {
    advance(ms) { now += ms; },
    move(ratio) {
      target = Math.min(video.duration, Math.max(0, ratio * video.duration));
      dirty = true;
      flush();
    },
    landed() { inFlight = false; flush(); },
    release() {
      if (target !== null) {
        const frame = core.clampFrame(
          core.frameIndexAt(target, video.fps),
          core.lastFrameIndexFor(video.duration, video.fps)
        );
        intendedFrame = frame;
        inFlight = true;
        startedAt = now;
        video.seek(core.frameCenter(frame, video.fps), 'exact');
      }
      target = null;
      dirty = false;
    },
    get intent() { return intendedFrame; }
  };
}

//#endregion

group('formatTime', () => {
  test('formats sub-minute and minute times', () => {
    equal(core.formatTime(0), '0:00');
    equal(core.formatTime(5), '0:05');
    equal(core.formatTime(65), '1:05');
    equal(core.formatTime(599), '9:59');
  });

  test('switches to h:mm:ss past an hour', () => {
    equal(core.formatTime(3600), '1:00:00');
    equal(core.formatTime(3725), '1:02:05');
  });

  test('pads fractional digits for the frame readout', () => {
    equal(core.formatTime(4.533, 2), '0:04.53');
    equal(core.formatTime(4.5, 2), '0:04.50');
    equal(core.formatTime(4.009, 2), '0:04.00');
    equal(core.formatTime(0, 2), '0:00.00');
  });

  test('survives the values a loading video reports', () => {
    equal(core.formatTime(NaN), '0:00');
    equal(core.formatTime(Infinity), '0:00');
    equal(core.formatTime(-5), '0:00');
    equal(core.formatTime(undefined), '0:00');
    equal(core.formatTime(NaN, 2), '0:00.00');
  });
});

group('snapFps', () => {
  test('snaps noisy measurements to the true standard rate', () => {
    const cases = [[30.0001, 30], [29.98, 29.97], [23.98, 23.976], [59.9, 59.94], [60.2, 60], [25.1, 25], [24.05, 24]];
    for (const [measured, want] of cases) {
      equal(core.snapFps(measured, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), want, `${measured} should snap`);
    }
  });

  test('distinguishes 29.97 from 30 rather than collapsing them', () => {
    equal(core.snapFps(29.971, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), 29.97);
    equal(core.snapFps(29.999, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), 30);
    note('fractional NTSC rates stay distinct from their integer neighbours');
  });

  test('leaves an unusual rate alone instead of forcing a candidate', () => {
    equal(core.snapFps(15, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), 15);
    equal(core.snapFps(90, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), 90);
  });

  test('rejects values that cannot be a frame rate', () => {
    equal(core.snapFps(0, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), null);
    equal(core.snapFps(-30, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), null);
    equal(core.snapFps(NaN, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), null);
    equal(core.snapFps(Infinity, FPS_CANDIDATES, FPS_SNAP_TOLERANCE), null);
  });
});

group('frame math', () => {
  test('every frame round-trips to itself through its centre', () => {
    for (const fps of STANDARD_RATES) {
      const lastFrame = core.lastFrameIndexFor(12, fps);
      for (let frame = 0; frame <= lastFrame; frame++) {
        const time = core.frameCenter(frame, fps);
        equal(core.frameIndexAt(time, fps), frame, `fps=${fps} frame ${frame}`);
      }
    }
  });

  test('a frame centre always lands strictly inside the media', () => {
    for (const fps of STANDARD_RATES) {
      const lastFrame = core.lastFrameIndexFor(12, fps);
      for (const frame of [0, 1, lastFrame - 1, lastFrame]) {
        const time = core.frameCenter(frame, fps);
        assert(time > 0 && time < 12, `fps=${fps} frame ${frame} -> ${time} outside [0, 12)`);
      }
    }
  });

  test('stepping does not drift over 500 frames', () => {
    for (const fps of STANDARD_RATES) {
      const video = fakeVideo({ fps });
      const step = stepper(video);
      for (let i = 0; i < 500; i++) {
        step.step(1);
        video.land();
        step.landed();
      }
      const lastFrame = core.lastFrameIndexFor(video.duration, fps);
      equal(video.frame(), Math.min(lastFrame, 500), `fps=${fps} drifted`);
    }
    note('500 single steps land on frame 500 exactly at every rate');
  });

  test('a step forward then back returns to the original frame', () => {
    for (const fps of STANDARD_RATES) {
      for (const startTime of [0, 1, 3.33333, 7.5, 11.8]) {
        const video = fakeVideo({ fps });
        video.currentTime = startTime;
        const origin = video.frame();
        const step = stepper(video);
        step.step(1); video.land(); step.landed();
        step.step(-1); video.land(); step.landed();
        equal(video.frame(), origin, `fps=${fps} from t=${startTime} not reversible`);
      }
    }
  });

  test('clamps at both ends without seeking outside the media', () => {
    for (const fps of STANDARD_RATES) {
      const video = fakeVideo({ fps });
      const step = stepper(video);
      for (let i = 0; i < 50; i++) { step.step(-1); video.land(); step.landed(); }
      equal(video.frame(), 0, `fps=${fps} underflowed`);
      for (let i = 0; i < 1000; i++) { step.step(10); video.land(); step.landed(); }
      equal(video.frame(), core.lastFrameIndexFor(video.duration, fps), `fps=${fps} overflowed`);
      for (const seek of video.issued) {
        assert(seek.time > 0 && seek.time < video.duration, `fps=${fps} seek to ${seek.time} outside media`);
      }
    }
  });

  test('a zero-length step is recognised as a no-op', () => {
    equal(core.stepTarget({ base: 10, pendingDelta: 0, lastFrame: 100, hasIntent: true }), null);
    equal(core.stepTarget({ base: 0, pendingDelta: -5, lastFrame: 100, hasIntent: true }), null, 'clamped-to-same is a no-op');
    equal(core.stepTarget({ base: 10, pendingDelta: 0, lastFrame: 100, hasIntent: false }), 10, 'without intent, report the position');
  });
});

group('seek coalescing (key repeat)', () => {
  test('a burst of 50 presses collapses into few seeks, losing none', () => {
    const video = fakeVideo();
    const step = stepper(video);
    for (let i = 0; i < 50; i++) step.step(1);
    let guard = 0;
    while (step.busy && guard++ < 500) { video.land(); step.landed(); }
    equal(video.frame(), 50, 'lost or duplicated steps');
    assert(video.issued.length <= 2, `coalescing failed: ${video.issued.length} seeks for 50 presses`);
    note(`50 presses with no seek completing -> ${video.issued.length} seek(s), landed on frame 50`);
  });

  test('interleaved press and completion is exact', () => {
    const video = fakeVideo();
    const step = stepper(video);
    for (let i = 0; i < 40; i++) { step.step(1); video.land(); step.landed(); }
    equal(video.frame(), 40);
  });

  test('a direction reversal mid-burst nets out correctly', () => {
    const video = fakeVideo();
    const step = stepper(video);
    for (let i = 0; i < 20; i++) step.step(1);
    for (let i = 0; i < 8; i++) step.step(-1);
    let guard = 0;
    while (step.busy && guard++ < 500) { video.land(); step.landed(); }
    equal(video.frame(), 12);
  });

  test('Shift bursts of 10 stay exact', () => {
    const video = fakeVideo();
    const step = stepper(video);
    for (let i = 0; i < 5; i++) step.step(10);
    let guard = 0;
    while (step.busy && guard++ < 500) { video.land(); step.landed(); }
    equal(video.frame(), 50);
  });
});

group('drag scrubbing', () => {
  test('a flood of pointermoves issues almost no seeks', () => {
    const video = fakeVideo();
    const drag = dragger(video);
    for (let i = 0; i < 120; i++) { drag.move(i / 120); drag.advance(8); }
    assert(video.issued.length < 20, `issued ${video.issued.length} seeks for 120 moves`);
    note(`120 moves with no seek completing -> ${video.issued.length} seek(s)`);
  });

  test('each seek targets the newest position, never a stale one', () => {
    const video = fakeVideo();
    const drag = dragger(video);
    drag.move(0.1);
    close(video.issued[0].time, 1.2, 1e-9, 'first seek');
    drag.move(0.2);
    drag.move(0.3);
    drag.move(0.9);
    video.land();
    drag.landed();
    equal(video.issued.length, 2, 'intermediate positions should be discarded, not queued');
    close(video.issued[1].time, 10.8, 1e-9, 'second seek must aim at the latest position');
  });

  test('releasing finishes on an exact frame-aligned seek', () => {
    const video = fakeVideo();
    const drag = dragger(video);
    drag.move(0.5); video.land(); drag.landed();
    drag.move(0.618);
    drag.release();
    const wantFrame = core.frameIndexAt(0.618 * 12, 30);
    const last = video.issued[video.issued.length - 1];
    equal(drag.intent, wantFrame, 'release frame');
    equal(last.kind, 'exact', 'release must be an exact seek');
    close(last.time, core.frameCenter(wantFrame, 30), 1e-9, 'release not frame-centred');
    assert(last.time > 0 && last.time < 12, `release seek ${last.time} outside media`);
  });

  test('fastSeek is preferred mid-drag where available', () => {
    const video = fakeVideo({ hasFastSeek: true });
    const drag = dragger(video);
    drag.move(0.3);
    equal(video.issued[0].kind, 'fast');
    video.land(); drag.landed();
    drag.move(0.7);
    drag.release();
    equal(video.issued[video.issued.length - 1].kind, 'exact', 'release stays exact');
    note('fastSeek while dragging, exact seek on release');
  });

  test('no seek is issued when the target is already the current position', () => {
    const video = fakeVideo();
    const drag = dragger(video);
    drag.move(0.25);
    video.land();
    drag.landed();
    const before = video.issued.length;
    drag.move(0.25);
    equal(video.issued.length, before, 'issued a redundant seek');
  });

  test('a redundant target is consumed, not left pending', () => {
    equal(core.dragSeekDecision({ blocked: false, dirty: true, target: 5, currentTime: 5 }), 'redundant');
    equal(core.dragSeekDecision({ blocked: false, dirty: true, target: 5, currentTime: 9 }), 'seek');
    equal(core.dragSeekDecision({ blocked: true, dirty: true, target: 5, currentTime: 9 }), 'wait');
    equal(core.dragSeekDecision({ blocked: false, dirty: false, target: 5, currentTime: 9 }), 'wait');
    equal(core.dragSeekDecision({ blocked: false, dirty: true, target: null, currentTime: 9 }), 'wait');
  });
});

group('stall watchdog', () => {
  test('holds a new seek back while one is legitimately in flight', () => {
    assert(core.isSeekBlocked({ inFlight: true, startedAt: 0, now: 200, stallMs: SEEK_STALL_MS }), 'should block at 200ms');
    assert(core.isSeekBlocked({ inFlight: true, startedAt: 0, now: 999, stallMs: SEEK_STALL_MS }), 'should block at 999ms');
  });

  test('lets a new seek supersede one that has stalled', () => {
    assert(!core.isSeekBlocked({ inFlight: true, startedAt: 0, now: 1000, stallMs: SEEK_STALL_MS }), 'should release at 1000ms');
    assert(!core.isSeekBlocked({ inFlight: true, startedAt: 0, now: 5000, stallMs: SEEK_STALL_MS }), 'should release at 5000ms');
  });

  test('never blocks when no seek is running', () => {
    assert(!core.isSeekBlocked({ inFlight: false, startedAt: 0, now: 0, stallMs: SEEK_STALL_MS }));
  });

  test('a stalled seek cannot freeze dragging for good', () => {
    const video = fakeVideo();
    const drag = dragger(video);
    drag.move(0.1);
    const before = video.issued.length;
    drag.move(0.2); drag.advance(200); drag.move(0.3);
    equal(video.issued.length, before, 'watchdog fired too early');
    drag.advance(1200);
    drag.move(0.4);
    equal(video.issued.length, before + 1, 'stalled seek was never superseded');
    close(video.issued[video.issued.length - 1].time, 0.4 * 12, 1e-9, 'superseding seek used a stale target');
    note('a seek that never completes is superseded after the stall window, at the latest position');
  });

  test('a stalled seek cannot freeze frame stepping for good', () => {
    const video = fakeVideo();
    const step = stepper(video);
    step.step(1);
    const before = video.issued.length;
    step.step(1);
    equal(video.issued.length, before, 'should wait while in flight');
    step.advance(1500);
    step.step(1);
    assert(video.issued.length > before, 'stepping stayed wedged behind a stalled seek');
  });
});

group('scrub pacing', () => {
  test('effective rate matches the requested scrub rate', () => {
    for (const fps of [24, 29.97, 30, 60]) {
      for (const rate of [0.5, 2]) {
        let accumulator = 0;
        let frames = 0;
        const tickMs = 1000 / 60;
        const ticks = 600;
        for (let i = 0; i < ticks; i++) {
          const paced = core.scrubSteps({ accumulator, elapsedMs: tickMs, fps, rate, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
          accumulator = paced.accumulator;
          frames += paced.steps;
        }
        const expected = (ticks * tickMs / 1000) * fps * rate;
        const errorPct = Math.abs(frames - expected) / expected * 100;
        assert(errorPct < 2, `fps=${fps} rate=${rate}: ${frames} frames vs ${expected.toFixed(1)} expected (${errorPct.toFixed(1)}% off)`);
      }
    }
  });

  test('spacing is even, with no bursty multi-frame jumps', () => {
    let accumulator = 0;
    let elapsed = 0;
    const gaps = [];
    let lastStepAt = null;
    const tickMs = 1000 / 60;
    for (let i = 0; i < 300; i++) {
      elapsed += tickMs;
      const paced = core.scrubSteps({ accumulator, elapsedMs: tickMs, fps: 30, rate: 0.5, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
      accumulator = paced.accumulator;
      if (paced.steps > 0) {
        equal(paced.steps, 1, 'normal-rate scrub should never batch frames');
        if (lastStepAt !== null) gaps.push(elapsed - lastStepAt);
        lastStepAt = elapsed;
      }
    }
    const spread = Math.max(...gaps) - Math.min(...gaps);
    assert(spread <= tickMs + 1e-9, `gap spread ${spread.toFixed(2)}ms exceeds one display frame`);
    note(`gaps ${Math.min(...gaps).toFixed(1)}-${Math.max(...gaps).toFixed(1)}ms against a 66.7ms target`);
  });

  test('a long stall cannot produce an unbounded jump', () => {
    const paced = core.scrubSteps({ accumulator: 0, elapsedMs: 2000, fps: 30, rate: 0.5, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
    equal(paced.steps, SCRUB_MAX_CATCHUP_FRAMES, 'a 2s stall should be capped');
    note(`a 2s stall yields ${paced.steps} frames, not 30`);
  });

  test('the accumulator drains fully so a backlog is never banked', () => {
    // 2s owed, only 3 issued: the remaining 27 frames must be dropped, not
    // held in the accumulator to discharge later as a lurch.
    const paced = core.scrubSteps({ accumulator: 0, elapsedMs: 2000, fps: 30, rate: 0.5, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
    assert(paced.accumulator < 1000 / (30 * 0.5), `accumulator banked a backlog: ${paced.accumulator}ms`);
    const next = core.scrubSteps({ accumulator: paced.accumulator, elapsedMs: 1000 / 60, fps: 30, rate: 0.5, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
    assert(next.steps <= 1, `lurched on the tick after a stall: ${next.steps} frames`);
    note('frames owed beyond the cap are discarded, so recovery is smooth');
  });

  test('a tick shorter than one frame interval issues nothing', () => {
    const paced = core.scrubSteps({ accumulator: 0, elapsedMs: 5, fps: 30, rate: 0.5, maxCatchup: SCRUB_MAX_CATCHUP_FRAMES });
    equal(paced.steps, 0);
    close(paced.accumulator, 5, 1e-9, 'short tick should accumulate');
  });
});

group('buffered range', () => {
  const ranges = (pairs) => ({
    length: pairs.length,
    start: (i) => pairs[i][0],
    end: (i) => pairs[i][1]
  });

  test('reports the end of the range covering the position', () => {
    equal(core.bufferedEndNear(ranges([[0, 30]]), 10), 30);
    equal(core.bufferedEndNear(ranges([[0, 5], [20, 40]]), 25), 40, 'should pick the covering range');
  });

  test('reports nothing when the position is unbuffered', () => {
    equal(core.bufferedEndNear(ranges([[0, 5]]), 50), 0);
    equal(core.bufferedEndNear(ranges([]), 10), 0);
    equal(core.bufferedEndNear(null, 10), 0, 'a missing TimeRanges must not throw');
  });

  test('tolerates sitting a hair before a range start', () => {
    equal(core.bufferedEndNear(ranges([[10, 20]]), 9.9), 20, 'within tolerance');
    equal(core.bufferedEndNear(ranges([[10, 20]]), 9.0), 0, 'beyond tolerance');
  });
});

group('site resolution', () => {
  test('resolves the supported hosts and their subdomains', () => {
    equal(core.resolveSiteKey('instagram.com'), 'instagram');
    equal(core.resolveSiteKey('www.instagram.com'), 'instagram');
    equal(core.resolveSiteKey('facebook.com'), 'facebook');
    equal(core.resolveSiteKey('www.facebook.com'), 'facebook');
    equal(core.resolveSiteKey('web.facebook.com'), 'facebook');
    equal(core.resolveSiteKey('m.facebook.com'), 'facebook');
  });

  test('is case-insensitive', () => {
    equal(core.resolveSiteKey('WWW.Facebook.COM'), 'facebook');
    equal(core.resolveSiteKey('Instagram.com'), 'instagram');
  });

  test('refuses lookalike hosts', () => {
    equal(core.resolveSiteKey('notinstagram.com'), null, 'suffix without a dot must not match');
    equal(core.resolveSiteKey('instagram.com.example.net'), null, 'host used as a prefix must not match');
    equal(core.resolveSiteKey('facebook.com.attacker.test'), null);
    equal(core.resolveSiteKey('myfacebook.com'), null);
    equal(core.resolveSiteKey('fakeinstagram.com'), null);
    note('a dot-prefixed suffix match is what keeps these out');
  });

  test('returns null for unsupported and malformed hosts', () => {
    equal(core.resolveSiteKey('example.com'), null);
    equal(core.resolveSiteKey(''), null);
    equal(core.resolveSiteKey(null), null);
    equal(core.resolveSiteKey(undefined), null);
    equal(core.resolveSiteKey(42), null);
  });
  test('recognises a media position slider by its timestamp value text', () => {
    assert(core.looksLikeTimeSlider('0:44 of 1:45'), 'Facebook position slider');
    assert(core.looksLikeTimeSlider('1:02:05 of 2:10:00'), 'long-form timestamps');
    assert(core.looksLikeTimeSlider('12:34'), 'a bare timestamp is enough');
    note('matched on the numeric timestamp, so it survives a translated aria-label');
  });

  test('does not mistake a volume slider for a position slider', () => {
    assert(!core.looksLikeTimeSlider('50%'), 'percentage');
    assert(!core.looksLikeTimeSlider('Volume 70'), 'volume text');
    assert(!core.looksLikeTimeSlider('7'), 'bare number');
    assert(!core.looksLikeTimeSlider(''), 'empty');
    assert(!core.looksLikeTimeSlider(null), 'missing attribute');
    assert(!core.looksLikeTimeSlider(undefined), 'absent');
  });

  // Every number below is measured off a live page, so a DOM change that
  // breaks the walk shows up here as a changed fixture rather than as two
  // overlapping control bars nobody tested.
  test('accepts a control strip holding the site\'s own buttons', () => {
    // Facebook feed post: a 44px row inside a 559px player, carrying Play,
    // Settings, Fullscreen, Unmute, both sliders and the "0:08 / 1:45"
    // timestamp. This is the case an earlier button guard rejected, which left
    // Facebook's row drawing underneath ours.
    assert(core.isControlStripAncestor({
      containsVideo: false, height: 44, ceiling: 559 * 0.25, hasLink: false, textLength: 11
    }), 'the 44px feed control row');
    assert(core.isControlStripAncestor({
      containsVideo: false, height: 24, ceiling: 559 * 0.25, hasLink: false, textLength: 11
    }), 'and its 24px parent');
    note('a strip is made of buttons, so buttons cannot be the signal that the walk has gone too far');
  });

  test('accepts a slider wrapper that has already been collapsed to nothing', () => {
    // Second pass over a Reel: everything hidden on the first pass measures
    // 0x0, so no geometric guard can carry the decision there.
    assert(core.isControlStripAncestor({
      containsVideo: false, height: 0, ceiling: 1191 * 0.25, hasLink: false, textLength: 0
    }), 'collapsed Reel slider wrapper');
  });

  test('stops at the player, by descendant on one surface and by size on the other', () => {
    // Reel: the player group really does contain the video element.
    assert(!core.isControlStripAncestor({
      containsVideo: true, height: 0, ceiling: 1191 * 0.25, hasLink: false, textLength: 0
    }), 'Reel player group, caught as an ancestor of the video');
    // Feed: the video sits in a sibling subtree, so containsVideo is false and
    // only the height tells the player group apart from a strip.
    assert(!core.isControlStripAncestor({
      containsVideo: false, height: 559, ceiling: 559 * 0.25, hasLink: false, textLength: 11
    }), 'feed player group, caught only by its height');
    note('both guards are load-bearing: neither surface is covered by the other one');
  });

  test('stops at a caption or author overlay', () => {
    assert(!core.isControlStripAncestor({
      containsVideo: false, height: 40, ceiling: 1191 * 0.25, hasLink: false, textLength: 372
    }), 'a Reel caption: 372 characters');
    assert(!core.isControlStripAncestor({
      containsVideo: false, height: 40, ceiling: 1191 * 0.25, hasLink: true, textLength: 0
    }), 'an author row: carries a profile link');
    note('a control strip carries a timestamp; an overlay carries sentences and links');
  });

  test('treats an unmeasurable video as no height limit at all', () => {
    assert(core.isControlStripAncestor({
      containsVideo: false, height: 900, ceiling: Infinity, hasLink: false, textLength: 0
    }), 'no ceiling to breach');
    assert(!core.isControlStripAncestor({ containsVideo: true, ceiling: Infinity }), 'still stops on the video');
    note('a 0-height video yields no ratio, so the other guards have to hold');
  });
});

group('A-B loop', () => {
  test('sorts markers so they can be set in either order', () => {
    const a = core.normalizeLoop({ start: 8, end: 3, duration: 20, fps: 30 });
    equal(a.start, 3, 'start');
    equal(a.end, 8, 'end');
    note('marking the end before the start still produces a valid range');
  });

  test('clamps a range to the media', () => {
    const r = core.normalizeLoop({ start: -5, end: 99, duration: 20, fps: 30 });
    equal(r.start, 0);
    equal(r.end, 20);
  });

  test('refuses a range too short to be worth looping', () => {
    equal(core.normalizeLoop({ start: 5, end: 5, duration: 20, fps: 30 }), null, 'zero length');
    equal(core.normalizeLoop({ start: 5, end: 5 + 1 / 30, duration: 20, fps: 30 }), null, 'one frame');
    equal(core.normalizeLoop({ start: 5, end: 5 + 2 / 30, duration: 20, fps: 30 }), null, 'two frames');
    assert(core.normalizeLoop({ start: 5, end: 5 + 3 / 30, duration: 20, fps: 30 }), 'three frames is enough');
    note('looping one or two frames thrashes the decoder and shows nothing useful');
  });

  test('scales the minimum with the frame rate', () => {
    assert(core.normalizeLoop({ start: 1, end: 1.04, duration: 20, fps: 120 }), '120fps allows a shorter span');
    equal(core.normalizeLoop({ start: 1, end: 1.02, duration: 20, fps: 24 }), null, '24fps needs a longer one');
  });

  test('accepts a span of exactly the minimum frame count', () => {
    for (const fps of [23.976, 24, 25, 29.97, 30, 59.94, 60]) {
      const start = 5;
      const end = start + 3 / fps;
      assert(core.normalizeLoop({ start, end, duration: 20, fps }), `fps=${fps} rejected an exact 3-frame span`);
    }
    note('float error makes an exact N-frame span measure a hair short; compared in frames with a tolerance');
  });

  test('refuses an unusable video or frame rate', () => {
    equal(core.normalizeLoop({ start: 1, end: 5, duration: NaN, fps: 30 }), null, 'duration not known yet');
    equal(core.normalizeLoop({ start: 1, end: 5, duration: 0, fps: 30 }), null, 'zero duration');
    equal(core.normalizeLoop({ start: 1, end: 5, duration: 20, fps: 0 }), null, 'no frame rate');
    equal(core.normalizeLoop({ start: null, end: 5, duration: 20, fps: 30 }), null, 'marker unset');
    equal(core.normalizeLoop({ start: 1, end: null, duration: 20, fps: 30 }), null, 'marker unset');
  });

  test('restarts on reaching the out point, slightly early', () => {
    assert(core.loopShouldRestart({ currentTime: 10, loopEnd: 10, paused: false }), 'at the out point');
    assert(core.loopShouldRestart({ currentTime: 9.99, loopEnd: 10, paused: false }), 'a hair before it');
    assert(core.loopShouldRestart({ currentTime: 12, loopEnd: 10, paused: false }), 'past it');
    note('landing early avoids showing a frame the user excluded');
  });

  test('does not restart before the out point or while paused', () => {
    assert(!core.loopShouldRestart({ currentTime: 5, loopEnd: 10, paused: false }), 'mid-loop');
    assert(!core.loopShouldRestart({ currentTime: 10, loopEnd: 10, paused: true }), 'paused at the out point');
    assert(!core.loopShouldRestart({ currentTime: NaN, loopEnd: 10, paused: false }), 'unknown position');
    assert(!core.loopShouldRestart({ currentTime: 10, loopEnd: NaN, paused: false }), 'no out point');
  });
  test('a dragged in point cannot cross the out point', () => {
    const r = core.clampMarker({ value: 9, other: 5, which: 'in', duration: 20, fps: 30, minFrames: 3 });
    close(r, 5 - 3 / 30, 1e-9, 'in point should stop short of the out point');
    note('handles stop three frames apart rather than passing through each other');
  });

  test('a dragged out point cannot cross the in point', () => {
    const r = core.clampMarker({ value: 2, other: 5, which: 'out', duration: 20, fps: 30, minFrames: 3 });
    close(r, 5 + 3 / 30, 1e-9, 'out point should stay past the in point');
  });

  test('leaves a marker alone when it is not crossing', () => {
    equal(core.clampMarker({ value: 3, other: 9, which: 'in', duration: 20, fps: 30 }), 3);
    equal(core.clampMarker({ value: 12, other: 9, which: 'out', duration: 20, fps: 30 }), 12);
  });

  test('clamps a dragged marker to the media', () => {
    equal(core.clampMarker({ value: -4, other: null, which: 'in', duration: 20, fps: 30 }), 0);
    equal(core.clampMarker({ value: 99, other: null, which: 'out', duration: 20, fps: 30 }), 20);
    equal(core.clampMarker({ value: 10, other: NaN, which: 'in', duration: 20, fps: 30 }), 10, 'an unset partner imposes no limit');
  });

  test('refuses to place a marker on an unready video', () => {
    equal(core.clampMarker({ value: 5, other: null, which: 'in', duration: NaN, fps: 30 }), null);
    equal(core.clampMarker({ value: 5, other: null, which: 'in', duration: 0, fps: 30 }), null);
    equal(core.clampMarker({ value: 5, other: null, which: 'in', duration: 20, fps: 0 }), null);
    equal(core.clampMarker({ value: NaN, other: null, which: 'in', duration: 20, fps: 30 }), null);
  });
});

group('timeline zoom', () => {
  // A 150px bar, the width augment mode uses, and a 105s video.
  const BAR = 150;
  const DUR = 105;
  const next = (over) => core.nextTimelineView({
    current: null, loopIn: 30, loopOut: 31.5, duration: DUR, barWidthPx: BAR,
    minGapPx: 190, minFraction: 0.2, maxFraction: 0.9, targetFraction: 0.5,
    minWindowSeconds: 5, ...over
  });
  // Feeding the result back in must reach a fixed point, or the bar rescales
  // forever: exactly the reported "resets and skips around".
  const settle = (over, rounds = 12) => {
    let view = null;
    const history = [];
    for (let i = 0; i < rounds; i++) {
      view = next({ ...over, current: view });
      history.push(view.start.toFixed(3) + '-' + view.end.toFixed(3));
    }
    return { view, history, stable: history[rounds - 1] === history[rounds - 2] };
  };

  test('shows the whole video when no loop is marked', () => {
    const v = next({ loopIn: null, loopOut: null });
    equal(v.start, 0);
    equal(v.end, DUR);
    equal(v.zoomed, false);
  });

  test('settles instead of rescaling forever', () => {
    // The bug: a 190px target on a 150px bar can never be met, so "needs more
    // zoom" stayed true and the window tracked the span on every call.
    for (const span of [60, 30, 20, 12, 10, 8, 5, 3, 1.5, 0.5]) {
      const r = settle({ loopIn: 20, loopOut: 20 + span });
      assert(r.stable, `span ${span}s never settled: ${r.history.slice(-4).join(' -> ')}`);
    }
    note('every loop length reaches a fixed point instead of rescaling on each call');
  });

  test('rescales in a few discrete steps, not continuously', () => {
    // Walking a marker 11s inwards used to move the window on every single
    // call. It should now step a handful of times and hold between steps.
    // During an actual drag the view is frozen outright, so a drag sees none of
    // these steps: that part lives in content.js and is verified in-browser.
    let view = null;
    const windows = new Set();
    let samples = 0;
    for (let end2 = 32; end2 >= 21; end2 -= 0.25) {
      view = next({ current: view, loopIn: 20, loopOut: end2 });
      windows.add(view.start.toFixed(2) + '-' + view.end.toFixed(2));
      samples++;
    }
    assert(windows.size <= 4,
      `window changed ${windows.size} times across an 11s drag of ${samples} steps`);
    note(`an 11s inward drag over ${samples} positions changed the window ${windows.size} time(s)`);
  });

  test('crossing a 10s span does not thrash', () => {
    // The span the problem was reported at, stepped finely.
    let view = null;
    const windows = new Set();
    for (let end2 = 32; end2 >= 28; end2 -= 0.1) {
      view = next({ current: view, loopIn: 20, loopOut: end2 });
      windows.add(view.start.toFixed(2) + '-' + view.end.toFixed(2));
    }
    assert(windows.size <= 2, `window changed ${windows.size} times around a 10s span`);
  });

  test('a zoom leaves the loop above the re-zoom threshold', () => {
    for (const span of [20, 10, 5, 2]) {
      const v = next({ loopIn: 20, loopOut: 20 + span });
      if (!v.zoomed) continue;
      const fraction = span / (v.end - v.start);
      assert(fraction >= 0.2 - 1e-9 || v.end - v.start <= 5 + 1e-9,
        `span ${span}s left the loop at ${(fraction * 100).toFixed(0)}% of the window, under the 20% trigger`);
    }
    note('a 50% target sits well above the 20% trigger, which is what makes it settle');
  });

  test('leaves a wide bar alone when the gap is already comfortable', () => {
    equal(next({ loopIn: 10, loopOut: 15, barWidthPx: 4000 }).zoomed, false,
      '5s of 105s on a 4000px bar is already ~190px apart');
    assert(next({ loopIn: 10, loopOut: 15, barWidthPx: 150 }).zoomed,
      'the same loop on a 150px bar needs zooming');
    note('the absolute pixel guard only suppresses zoom on a bar wide enough not to need it');
  });

  test('caps how far it will zoom in', () => {
    for (const [a, b] of [[30, 31.5], [30, 30.5], [30, 30.2], [30, 30.1]]) {
      const v = next({ loopIn: a, loopOut: b });
      assert(v.end - v.start >= 5 - 1e-9,
        `a ${(b - a)}s loop zoomed to ${(v.end - v.start).toFixed(2)}s, past the 5s cap`);
    }
  });

  test('holds the window at the zoom cap rather than re-centring endlessly', () => {
    const r = settle({ loopIn: 30, loopOut: 30.2 });
    assert(r.stable, `a 0.2s loop at the cap never settled: ${r.history.slice(-3).join(' -> ')}`);
    close(r.view.end - r.view.start, 5, 1e-6, 'should sit at the 5s cap');
  });

  test('re-centres only when a marker leaves the window', () => {
    const first = next({});
    const after = next({ current: first, loopIn: 70, loopOut: 71.5 });
    assert(after.start !== first.start, 'should follow markers that moved out of view');
    assert(70 >= after.start && 71.5 <= after.end, 'new window must contain the markers');
  });

  test('returns to the whole video once the loop fills the window', () => {
    const zoomed = next({});
    const released = next({ current: zoomed, loopIn: zoomed.start, loopOut: zoomed.end });
    equal(released.zoomed, false, 'a loop filling its window makes the zoom pointless');
  });

  test('slides rather than shrinks the window at the start', () => {
    const atStart = next({ loopIn: 0, loopOut: 1.5 });
    equal(atStart.start, 0, 'cannot start before zero');
    close(atStart.end - atStart.start, 5, 1e-6, 'keeps its width');
  });

  // Where a time lands on a 150px track, which is what the handles actually do
  // with the window. Asserting in pixels is the point: the bug being guarded
  // against is a handle that cannot be grabbed.
  const BAR_PX = 150;
  const xOf = (time, view) => core.timeToViewRatio(time, view) * BAR_PX;

  test('leaves grabbable track past B when it is against the end', () => {
    // The window stops at the media, so without padding B lands exactly on the
    // right edge of the track with nothing after it.
    const atEnd = next({ loopIn: DUR - 1.5, loopOut: DUR });
    assert(atEnd.end > DUR, `window should extend past the media end, got ${atEnd.end}`);
    close(BAR_PX - xOf(DUR, atEnd), 20, 1e-6, 'leaves 20px of track past the end of the video');
    assert(atEnd.start >= 0, 'stays inside the media at the left');
  });

  test('does not squeeze the markers together to make that room', () => {
    // Widening the window in time was the first attempt and it did exactly
    // this: the handles went from 45px apart to 11px. The padding must buy
    // grab room past B without costing room between A and B.
    const mid = next({ loopIn: 20, loopOut: 21.5 });
    const midGap = xOf(21.5, mid) - xOf(20, mid);
    const atEnd = next({ loopIn: DUR - 1.5, loopOut: DUR });
    const endGap = xOf(DUR, atEnd) - xOf(DUR - 1.5, atEnd);
    assert(endGap > midGap * 0.75,
      `markers at the end are ${endGap.toFixed(1)}px apart against ${midGap.toFixed(1)}px mid-video`);
  });

  test('leaves a loop clear of the end on the normal zoom', () => {
    // Just outside the guard: an ordinary loop, which must not be padded.
    const clear = next({ loopIn: DUR - 12, loopOut: DUR - 10.5 });
    close(clear.end - clear.start, 5, 1e-6, 'ordinary loops keep the tight window');
    assert(clear.end <= DUR + 1e-9, 'and do not reach past the media');
  });

  test('re-pads a held window once B reaches the end', () => {
    // A window established while the loop was mid-video stops at the media, so
    // it must be recomputed rather than held.
    const mid = next({ loopIn: 20, loopOut: 21.5 });
    close(mid.end - mid.start, 5, 1e-6, 'starts tight');
    assert(mid.end <= DUR + 1e-9, 'and unpadded');
    const moved = next({ current: mid, loopIn: DUR - 1.4, loopOut: DUR });
    assert(moved.end > DUR, 'reopens with padding once B is at the end');
    close(BAR_PX - xOf(DUR, moved), 20, 1e-6, 'and lands the padding at 20px');
  });

  test('pads the end of a video shorter than the window too', () => {
    const tiny = next({ loopIn: 6.5, loopOut: 8, duration: 8 });
    assert(tiny.end > 8, 'a short video still needs room past B');
    close(BAR_PX - xOf(8, tiny), 20, 1e-6, 'with the same 20px of track');
    // A 5s window on an 8s video is still a zoom; the padding past the end
    // must not change that verdict either way.
    equal(tiny.zoomed, true, 'a 5s window on an 8s video is a zoom');
  });

  test('settles on a padded window instead of recomputing forever', () => {
    // The padding made the window wider than the zoom cap, so a padded window
    // could never report itself as capped: a tight loop at the end recomputed
    // on every call and the timeline appeared to stick. Feeding the result back
    // in must reach a fixed point.
    let view = next({ loopIn: DUR - 0.4, loopOut: DUR });
    const first = view;
    for (let i = 0; i < 10; i++) {
      view = next({ current: view, loopIn: DUR - 0.4, loopOut: DUR });
    }
    close(view.start, first.start, 1e-9, 'window start settled');
    close(view.end, first.end, 1e-9, 'window end settled');
    assert(view.end > DUR, 'and kept its room past the end');
  });

  test('drops end padding once the loop moves back into the video', () => {
    const atEnd = next({ loopIn: DUR - 1.5, loopOut: DUR });
    assert(atEnd.padSeconds > 0, 'padded at the end');
    // Same window, but the loop is now clear of the end: the blank track past
    // the media has stopped being earned.
    const moved = next({ current: atEnd, loopIn: DUR - 12, loopOut: DUR - 10.5 });
    close(moved.padSeconds, 0, 1e-9, 'padding dropped');
    assert(moved.end <= DUR + 1e-9, 'window back inside the media');
  });

  test('reports its end padding so callers can tell dead space from width', () => {
    const plain = next({ loopIn: 20, loopOut: 21.5 });
    close(plain.padSeconds, 0, 1e-9, 'an ordinary window has none');
    const padded = next({ loopIn: DUR - 1.5, loopOut: DUR });
    close(padded.end - padded.start - padded.padSeconds, 5, 1e-6,
      'width minus padding is the ordinary window width');
  });

  test('skips padding when the bar is narrower than the padding itself', () => {
    // Nothing sensible to do with 20px of padding on a 12px bar; better to
    // leave the window alone than to produce a degenerate one.
    const narrow = next({ loopIn: DUR - 1.5, loopOut: DUR, barWidthPx: 12 });
    assert(narrow.end <= DUR + 1e-9, 'no padding on an unusably narrow bar');
  });

  test('never produces a window wider than the video', () => {
    const v = next({ loopIn: 0.1, loopOut: 0.3, duration: 2 });
    assert(v.end - v.start <= 2 + 1e-9, 'window exceeded a 2s video');
  });

  test('can be switched off', () => {
    const v = next({ disabled: true });
    equal(v.zoomed, false);
    equal(v.end, DUR);
  });

  test('holds the current window when the bar has no measurable width', () => {
    const zoomed = next({});
    equal(next({ current: zoomed, barWidthPx: 0 }), zoomed,
      'a zero-width measurement must not reset the view');
  });

  test('maps time to position and back within the window', () => {
    const w = { start: 29, end: 33, zoomed: true };
    close(core.timeToViewRatio(31, w), 0.5, 1e-9, 'midpoint');
    close(core.viewRatioToTime(0.5, w), 31, 1e-9, 'back to time');
    for (const t of [29, 30.25, 31, 32.75, 33]) {
      close(core.viewRatioToTime(core.timeToViewRatio(t, w), w), t, 1e-9, `round-trip ${t}`);
    }
  });

  test('clamps a position outside the window to an edge', () => {
    const w = { start: 29, end: 33, zoomed: true };
    equal(core.timeToViewRatio(5, w), 0, 'before the window');
    equal(core.timeToViewRatio(90, w), 1, 'after the window');
    equal(core.viewRatioToTime(-1, w), 29);
    equal(core.viewRatioToTime(2, w), 33);
  });

  test('survives an unready video', () => {
    equal(next({ duration: NaN }).zoomed, false);
    equal(core.timeToViewRatio(5, { start: 0, end: 0 }), 0, 'zero-width window');
    equal(core.viewRatioToTime(0.5, { start: 0, end: 0 }), 0);
  });
});


group('loop links', () => {
  test('reads loop times from a fragment', () => {
    const r = core.parseLoopFromUrl('https://www.instagram.com/p/abc/#loop=22.68,31.18');
    equal(r.start, 22.68);
    equal(r.end, 31.18);
    equal(r.rate, undefined, 'no rate given');
  });

  test('reads an optional practice rate', () => {
    const r = core.parseLoopFromUrl('#loop=5,10,0.25');
    equal(r.start, 5);
    equal(r.end, 10);
    equal(r.rate, 0.25);
  });

  test('accepts a bare fragment or one parameter among several', () => {
    assert(core.parseLoopFromUrl('loop=5,10'), 'bare, no hash');
    assert(core.parseLoopFromUrl('#loop=5,10'), 'bare fragment');
    const mixed = core.parseLoopFromUrl('#other=1&loop=5,10&more=2');
    equal(mixed.start, 5, 'one parameter among several');
    equal(mixed.end, 10);
    note('tolerant of other fragment content, since the sites use fragments themselves');
  });

  test('sorts markers given in either order', () => {
    const r = core.parseLoopFromUrl('#loop=31.18,22.68');
    equal(r.start, 22.68);
    equal(r.end, 31.18);
  });

  test('rejects anything it cannot read rather than guessing', () => {
    equal(core.parseLoopFromUrl('https://example.com/p/abc/'), null, 'no fragment');
    equal(core.parseLoopFromUrl('#loop='), null, 'empty value');
    equal(core.parseLoopFromUrl('#loop=abc,def'), null, 'not numbers');
    equal(core.parseLoopFromUrl('#loop=5'), null, 'only one time');
    equal(core.parseLoopFromUrl('#loop=5,5'), null, 'zero length');
    equal(core.parseLoopFromUrl('#loop=-5,10'), null, 'negative');
    equal(core.parseLoopFromUrl('#other=1,2'), null, 'different parameter');
    equal(core.parseLoopFromUrl(''), null);
    equal(core.parseLoopFromUrl(null), null);
    equal(core.parseLoopFromUrl(42), null);
  });

  test('ignores a nonsensical rate but keeps the loop', () => {
    const r = core.parseLoopFromUrl('#loop=5,10,0');
    equal(r.start, 5);
    equal(r.rate, undefined, 'a zero rate is dropped, not applied');
  });

  test('builds a shareable link', () => {
    equal(core.formatLoopUrl('https://www.instagram.com/p/abc/', 22.68, 31.18),
      'https://www.instagram.com/p/abc/#loop=22.68,31.18');
  });

  test('includes a rate only when it is not the default', () => {
    equal(core.formatLoopUrl('https://x/p/a/', 5, 10, 1), 'https://x/p/a/#loop=5,10', '1x is left out');
    equal(core.formatLoopUrl('https://x/p/a/', 5, 10, 0.25), 'https://x/p/a/#loop=5,10,0.25');
    equal(core.formatLoopUrl('https://x/p/a/', 5, 10), 'https://x/p/a/#loop=5,10', 'no rate given');
  });

  test('replaces an existing fragment rather than appending', () => {
    equal(core.formatLoopUrl('https://x/p/a/#loop=1,2', 5, 10), 'https://x/p/a/#loop=5,10');
    equal(core.formatLoopUrl('https://x/p/a/#other', 5, 10), 'https://x/p/a/#loop=5,10');
  });

  test('rounds to hundredths to keep links short', () => {
    equal(core.formatLoopUrl('https://x/', 22.6789123, 31.1812345), 'https://x/#loop=22.68,31.18');
  });

  test('refuses to build a link from an unusable loop', () => {
    equal(core.formatLoopUrl('https://x/', 5, 5), null, 'zero length');
    equal(core.formatLoopUrl('https://x/', NaN, 10), null);
    equal(core.formatLoopUrl('', 5, 10), null, 'no base URL');
    equal(core.formatLoopUrl(null, 5, 10), null);
    equal(core.formatLoopUrl('https://x/', -1, 10), null, 'negative');
  });

  test('round-trips a loop through a link', () => {
    for (const [a, b, rate] of [[22.68, 31.18, undefined], [0.5, 1.75, 0.25], [100, 250.33, 0.5]]) {
      const url = core.formatLoopUrl('https://www.instagram.com/p/abc/', a, b, rate);
      const back = core.parseLoopFromUrl(url);
      close(back.start, a, 0.005, 'start survived');
      close(back.end, b, 0.005, 'end survived');
      if (rate && Math.abs(rate - 1) > 1e-9) close(back.rate, rate, 1e-9, 'rate survived');
    }
    note('what is written can be read back, which is the only property that matters here');
  });
});

group('clip export', () => {
  test('picks the first container the browser supports', () => {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    equal(core.pickRecorderMime(candidates, () => true), 'video/webm;codecs=vp9,opus', 'prefers the first');
    equal(core.pickRecorderMime(candidates, (m) => m === 'video/webm'), 'video/webm', 'falls through');
    equal(core.pickRecorderMime(candidates, () => false), null, 'nothing supported');
  });

  test('skips a candidate whose support check throws', () => {
    const candidates = ['bad', 'video/webm'];
    equal(core.pickRecorderMime(candidates, (m) => {
      if (m === 'bad') throw new TypeError('malformed');
      return true;
    }), 'video/webm');
    note('a malformed candidate is skipped rather than aborting the choice');
  });

  test('refuses malformed arguments', () => {
    equal(core.pickRecorderMime(null, () => true), null);
    equal(core.pickRecorderMime(['video/webm'], null), null);
    equal(core.pickRecorderMime([], () => true), null);
  });

  test('names a clip after its site, video and bounds', () => {
    equal(core.clipFilename('www.instagram.com', '/p/Dfo3mUzgJQJ/', 30.01, 34.51),
      'instagram-Dfo3mUzgJQJ-30p01-34p51.webm');
    equal(core.clipFilename('www.facebook.com', '/reel/1046756455114845', 5, 9.5),
      'facebook-1046756455114845-5p00-9p50.webm');
    note('the decimal point becomes p, since a filename should not carry a second dot');
  });

  test('copes with a path that names no video', () => {
    equal(core.clipFilename('www.instagram.com', '/', 1, 2), 'instagram-1p00-2p00.webm');
    equal(core.clipFilename('www.facebook.com', '', 1, 2), 'facebook-1p00-2p00.webm');
  });

  test('falls back for an unsupported host or bad bounds', () => {
    equal(core.clipFilename('example.com', '/p/abc/', 1, 2), 'video-abc-1p00-2p00.webm');
    equal(core.clipFilename('www.instagram.com', '/p/abc/', NaN, 2), 'instagram-abc-0p00-2p00.webm');
    equal(core.clipFilename(null, null, 1, 2), 'video-1p00-2p00.webm');
  });

  test('honours a different extension', () => {
    equal(core.clipFilename('www.instagram.com', '/p/abc/', 1, 2, 'mp4'), 'instagram-abc-1p00-2p00.mp4');
  });
});

// The committed userscript bundle is a build artifact, and a stale one is worse
// than an absent one: it installs cleanly and silently lacks whatever changed.
// Regenerating it in memory and comparing is cheap, so the always-run suite is
// the right place to catch the drift.
group('userscript bundle', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const bundlePath = path.join(root, 'dist', 'socials-video-controls.user.js');

  test('is committed', () => {
    assert(fs.existsSync(bundlePath),
      'dist/socials-video-controls.user.js is missing; run node tools/build-userscript.js');
  });

  test('is up to date with content/ and the manifest', () => {
    if (!fs.existsSync(bundlePath)) return;
    // --check regenerates in memory and compares, without writing. Building
    // first and then comparing would always pass.
    const result = require('child_process').spawnSync(
      process.execPath,
      [path.join(root, 'tools', 'build-userscript.js'), '--check'],
      { encoding: 'utf8' }
    );
    assert(result.status === 0,
      `the committed bundle is stale: ${(result.stderr || result.stdout || '').trim()}`);
  });

  test('carries no eval or remote code', () => {
    if (!fs.existsSync(bundlePath)) return;
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    // The strongest claim this project makes about itself. A build step is not
    // a good reason to give it up, so it is asserted on the artifact.
    assert(!/\beval\s*\(/.test(bundle), 'bundle contains eval(');
    assert(!/new\s+Function\s*\(/.test(bundle), 'bundle contains new Function(');
    assert(!/importScripts\s*\(/.test(bundle), 'bundle contains importScripts(');
    // @require would fetch code at install time from somewhere else.
    assert(!/^\/\/ @require/m.test(bundle), 'bundle declares @require');
    assert(/^\/\/ @grant        none$/m.test(bundle), 'bundle should request no privileged grants');
  });
});

//#region Summary

console.log('');
if (failures.length) {
  console.log(`FAILED: ${failures.length} failing, ${passed} passing`);
  for (const f of failures) console.log(`  ${f.group} > ${f.name}\n    ${f.message}`);
  process.exit(1);
}
console.log(`PASSED: ${passed} tests, ${notes.length} notes`);

// COVERAGE
//
// Covered here: time formatting, frame-rate snapping, frame-index and
// frame-centre math, frame-step coalescing, drag-seek coalescing and release,
// the stall watchdog, scrub pacing, buffered-range lookup, loop links, loop
// range and marker clamping, timeline zoom, recorder container choice and clip
// filenames.
//
// NOT covered, because it cannot be separated from a real <video> element or a
// real DOM without a headless browser or jsdom:
//
//   - Clip recording: captureStream into MediaRecorder, and the theater
//     overlay that shows the result. Verified in-browser instead.
//   - Forward jog scrub, which sets playbackRate and plays rather than seeking.
//   - Restoring rate and mute after a scrub, and sync() not fighting them.
//   - Which player the keyboard acts on (fullscreen / hover / recent keypress).
//   - Typing-context suppression of the shortcuts.
//   - Player discovery, native-control detection, bar mounting, the series
//     overlay, and recycled-element teardown.
//
//#endregion
