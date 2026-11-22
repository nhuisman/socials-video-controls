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
const CACHE_MAX_BYTES = 256 * 1024 * 1024;
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

group('cache eligibility', () => {
  test('refuses a MediaSource-backed player', () => {
    equal(core.cacheRejectReason({ source: 'blob:https://instagram.com/abc', bytes: 0, maxBytes: CACHE_MAX_BYTES }), 'unsupported');
    equal(core.cacheRejectReason({ source: 'mediasource:abc', bytes: 0, maxBytes: CACHE_MAX_BYTES }), 'unsupported');
    note('a blob: source has no fetchable file, and overwriting it would break Instagram');
  });

  test('refuses a missing source', () => {
    equal(core.cacheRejectReason({ source: '', bytes: 0, maxBytes: CACHE_MAX_BYTES }), 'unsupported');
    equal(core.cacheRejectReason({ source: null, bytes: 0, maxBytes: CACHE_MAX_BYTES }), 'unsupported');
  });

  test('accepts a progressive source within the size limit', () => {
    equal(core.cacheRejectReason({ source: 'https://cdn.example/v.mp4', bytes: 80 * 1024 * 1024, maxBytes: CACHE_MAX_BYTES }), null);
  });

  test('refuses an oversize download at the declared and the observed size', () => {
    equal(core.cacheRejectReason({ source: 'https://cdn.example/v.mp4', bytes: CACHE_MAX_BYTES + 1, maxBytes: CACHE_MAX_BYTES }), 'too-large');
    note('checked against Content-Length up front and against bytes received while streaming');
  });

  test('accepts a source whose size is not declared', () => {
    equal(core.cacheRejectReason({ source: 'https://cdn.example/v.mp4', bytes: 0, maxBytes: CACHE_MAX_BYTES }), null);
    equal(core.cacheRejectReason({ source: 'https://cdn.example/v.mp4', bytes: NaN, maxBytes: CACHE_MAX_BYTES }), null);
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
  test('shows the whole video when no loop is marked', () => {
    const v = core.resolveTimelineView({ loopIn: null, loopOut: null, duration: 100, fps: 30 });
    equal(v.start, 0);
    equal(v.end, 100);
    equal(v.zoomed, false);
  });

  test('shows the whole video when the loop is already a large share of it', () => {
    const v = core.resolveTimelineView({ loopIn: 10, loopOut: 60, duration: 100, fps: 30 });
    equal(v.zoomed, false, 'a 50% loop needs no zoom');
    equal(v.end, 100);
  });

  test('zooms around a tight loop so the markers separate', () => {
    // The case that prompted this: 1.5s marked in a 105s video.
    const v = core.resolveTimelineView({ loopIn: 30, loopOut: 31.5, duration: 105, fps: 30 });
    assert(v.zoomed, 'should zoom');
    const beforeWidth = (31.5 - 30) / 105;
    const afterWidth = (31.5 - 30) / (v.end - v.start);
    assert(afterWidth > beforeWidth * 10, `loop went from ${(beforeWidth * 100).toFixed(1)}% to ${(afterWidth * 100).toFixed(1)}% of the bar`);
    note(`a 1.5s loop in a 105s video goes from ${(beforeWidth * 100).toFixed(1)}% to ${(afterWidth * 100).toFixed(0)}% of the bar width`);
  });

  test('leaves room either side to drag a marker outwards', () => {
    const v = core.resolveTimelineView({ loopIn: 30, loopOut: 32, duration: 105, fps: 30 });
    assert(v.start < 30, 'window starts before A');
    assert(v.end > 32, 'window ends after B');
  });

  test('slides rather than shrinks the window at the start of the video', () => {
    const v = core.resolveTimelineView({ loopIn: 0, loopOut: 1.5, duration: 105, fps: 30 });
    equal(v.start, 0, 'cannot start before zero');
    assert(v.end > 1.5, 'window still extends past B');
    close(v.end - v.start, 3, 1e-6, 'window keeps its width');
  });

  test('slides rather than shrinks the window at the end of the video', () => {
    const v = core.resolveTimelineView({ loopIn: 103.5, loopOut: 105, duration: 105, fps: 30 });
    equal(v.end, 105, 'cannot end past the duration');
    assert(v.start < 103.5, 'window still extends before A');
    close(v.end - v.start, 3, 1e-6, 'window keeps its width');
  });

  test('can be switched off', () => {
    const v = core.resolveTimelineView({ loopIn: 30, loopOut: 31.5, duration: 105, fps: 30, disabled: true });
    equal(v.zoomed, false);
    equal(v.end, 105);
  });

  test('maps time to position and back within the window', () => {
    const view = { start: 29, end: 33, zoomed: true };
    close(core.timeToViewRatio(31, view), 0.5, 1e-9, 'midpoint');
    close(core.timeToViewRatio(29, view), 0, 1e-9, 'start');
    close(core.timeToViewRatio(33, view), 1, 1e-9, 'end');
    close(core.viewRatioToTime(0.5, view), 31, 1e-9, 'back to time');
    for (const t of [29, 30.25, 31, 32.75, 33]) {
      close(core.viewRatioToTime(core.timeToViewRatio(t, view), view), t, 1e-9, `round-trip ${t}`);
    }
  });

  test('clamps a position outside the window to an edge', () => {
    const view = { start: 29, end: 33, zoomed: true };
    equal(core.timeToViewRatio(5, view), 0, 'before the window');
    equal(core.timeToViewRatio(90, view), 1, 'after the window');
    equal(core.viewRatioToTime(-1, view), 29);
    equal(core.viewRatioToTime(2, view), 33);
  });

  test('survives an unready video', () => {
    const v = core.resolveTimelineView({ loopIn: 1, loopOut: 2, duration: NaN, fps: 30 });
    equal(v.zoomed, false);
    equal(core.timeToViewRatio(5, { start: 0, end: 0 }), 0, 'zero-width window');
    equal(core.viewRatioToTime(0.5, { start: 0, end: 0 }), 0);
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
// the stall watchdog, scrub pacing, buffered-range lookup, cache eligibility.
//
// NOT covered, because it cannot be separated from a real <video> element or a
// real DOM without a headless browser or jsdom:
//
//   - Blob lifetime ordering in the cache: the src must move off a blob URL
//     before that URL is revoked, or playback breaks. Verify by hand.
//   - Forward jog scrub, which sets playbackRate and plays rather than seeking.
//   - Restoring rate and mute after a scrub, and sync() not fighting them.
//   - Which player the keyboard acts on (fullscreen / hover / recent keypress).
//   - Typing-context suppression of the shortcuts.
//   - Player discovery, native-control detection, bar mounting, the series
//     overlay, and recycled-element teardown.
//
//#endregion
