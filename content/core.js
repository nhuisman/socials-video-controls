// Pure logic shared by the content script and the test suite.
//
// Everything here is deliberately free of DOM, extension and video-element
// access so it can be loaded and exercised under bare `node`. The invariants
// that matter live in these functions: frame stepping must be drift-free and
// reversible, seeks must coalesce without losing or duplicating intent, and
// scrub pacing must stay even without banking a backlog.
//
// Orchestration — which seek to issue when, blob lifetime, element wiring —
// stays in content.js, because it is inseparable from the <video> element.
(() => {
  'use strict';

  const core = {};

  // Formats seconds as m:ss, h:mm:ss past an hour, with optional fractional
  // digits for the frame-accurate readout.
  core.formatTime = (seconds, decimals = 0) => {
    const zeroFraction = decimals ? `.${'0'.repeat(decimals)}` : '';
    if (!Number.isFinite(seconds) || seconds <= 0) return `0:00${zeroFraction}`;
    const minutes = Math.floor(seconds / 60);
    const wholeSeconds = String(Math.floor(seconds % 60)).padStart(2, '0');
    const secondsText = decimals
      ? `${wholeSeconds}.${String(Math.floor((seconds % 1) * 10 ** decimals)).padStart(decimals, '0')}`
      : wholeSeconds;
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${secondsText}`
      : `${minutes}:${secondsText}`;
  };

  // Snaps a measured frame rate to a standard one when it lands within
  // tolerance, so 29.98 is recognised as 29.97 rather than rounded to 30. An
  // unusual rate outside tolerance is returned unchanged rather than forced
  // onto the nearest candidate.
  core.snapFps = (raw, candidates, tolerance) => {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    let best = raw;
    let bestError = Infinity;
    for (const candidate of candidates) {
      const error = Math.abs(candidate - raw) / candidate;
      if (error < bestError) {
        bestError = error;
        best = candidate;
      }
    }
    return bestError <= tolerance ? best : raw;
  };

  // The frame displayed at a given time. The epsilon absorbs float error from
  // a currentTime that landed a hair below a boundary.
  core.frameIndexAt = (time, fps) => Math.floor(time * fps + 1e-6);

  core.lastFrameIndexFor = (duration, fps) => Math.max(0, Math.round(duration * fps) - 1);

  // The centre of a frame, not its boundary. Seeking to a boundary lets float
  // rounding land on the neighbour; seeking to the centre cannot.
  core.frameCenter = (frame, fps) => (frame + 0.5) / fps;

  core.clampFrame = (frame, lastFrame) => Math.min(lastFrame, Math.max(0, frame));

  // Where a frame step should land. `base` is the pending intent when one
  // exists, otherwise the video's real position; `hasIntent` says which. A
  // target equal to an existing intent means there is nothing left to do.
  core.stepTarget = ({ base, pendingDelta, lastFrame, hasIntent }) => {
    const target = core.clampFrame(base + pendingDelta, lastFrame);
    if (target === base && hasIntent) return null;
    return target;
  };

  // How many frames a held-key scrub owes for the time just elapsed.
  //
  // The accumulator drains by the full owed count while only the capped count
  // is issued, which is what stops a decode stall from banking a backlog and
  // discharging it as a lurch. Falling behind makes the scrub move slower; it
  // never makes it jump.
  core.scrubSteps = ({ accumulator, elapsedMs, fps, rate, maxCatchup }) => {
    const msPerFrame = 1000 / (fps * rate);
    const total = accumulator + elapsedMs;
    const owed = Math.floor(total / msPerFrame);
    if (owed <= 0) return { steps: 0, accumulator: total };
    return { steps: Math.min(owed, maxCatchup), accumulator: total - owed * msPerFrame };
  };

  // End of the buffered range covering a time, which is how far seeking can go
  // without touching the network. `ranges` is a TimeRanges or anything with the
  // same length/start/end shape.
  core.bufferedEndNear = (ranges, time, tolerance = 0.25) => {
    if (!ranges) return 0;
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) - tolerance && time <= ranges.end(i)) return ranges.end(i);
    }
    return 0;
  };

  // Whether a new seek must wait. A seek into unbuffered data can pend forever
  // and never report completion, so past the stall window a new seek is allowed
  // to supersede it rather than wedging stepping and dragging permanently.
  core.isSeekBlocked = ({ inFlight, startedAt, now, stallMs }) =>
    Boolean(inFlight) && now - startedAt < stallMs;

  // What to do with a drag target. Three outcomes, not two: 'wait' leaves the
  // target pending for the next attempt, while 'redundant' consumes it without
  // seeking because the video is already there.
  core.dragSeekDecision = ({ blocked, dirty, target, currentTime, epsilon = 1e-4 }) => {
    if (blocked || !dirty || target === null || target === undefined) return 'wait';
    if (Math.abs(currentTime - target) < epsilon) return 'redundant';
    return 'seek';
  };

  // Why a video cannot be cached, or null when it can. A blob:/MediaSource
  // source has no fetchable file behind it, and overwriting it would break
  // Instagram's own player.
  core.cacheRejectReason = ({ source, bytes, maxBytes }) => {
    if (!source || source.startsWith('blob:') || source.startsWith('mediasource:')) return 'unsupported';
    if (Number.isFinite(bytes) && bytes > maxBytes) return 'too-large';
    return null;
  };

  // The slice of the video the seek bar should represent, as a transition from
  // the window currently in use rather than a fresh calculation each time.
  //
  // Stickiness is the point. Recomputing on every marker nudge made the bar
  // rescale constantly, which is disorienting while aiming at a handle. Once a
  // window is established it is kept as long as the markers still sit inside it
  // and the loop has not grown large enough to need the whole video back.
  //
  // The decision to zoom is made in pixels, not as a fraction of duration,
  // because what matters is whether the two handles are far enough apart on
  // screen to aim at individually.
  core.nextTimelineView = ({
    current,
    loopIn,
    loopOut,
    duration,
    barWidthPx,
    minGapPx = 190,
    unzoomGapPx = 420,
    minWindowSeconds = 5,
    padFraction = 0.5,
    disabled = false
  }) => {
    const full = { start: 0, end: Number.isFinite(duration) && duration > 0 ? duration : 0, zoomed: false };
    if (disabled || !Number.isFinite(duration) || duration <= 0) return full;
    if (!Number.isFinite(loopIn) || !Number.isFinite(loopOut)) return full;
    // An unlaid-out bar has no meaningful pixel width; keep whatever is in use
    // rather than thrashing on a zero measurement.
    if (!Number.isFinite(barWidthPx) || barWidthPx <= 0) return current || full;

    const a = Math.min(loopIn, loopOut);
    const b = Math.max(loopIn, loopOut);
    const span = b - a;
    if (span <= 0) return full;

    const gapAt = (windowWidth) => (windowWidth > 0 ? (span / windowWidth) * barWidthPx : 0);

    // Keep the established window while it still works.
    if (current && current.zoomed && current.end > current.start) {
      const insideWindow = a >= current.start && b <= current.end;
      const gap = gapAt(current.end - current.start);
      if (insideWindow && gap <= unzoomGapPx) return current;
      if (gap > unzoomGapPx) return full;
    } else if (gapAt(duration) >= minGapPx) {
      // Already far enough apart on screen at full scale; nothing to fix.
      return full;
    }

    // Centring on the loop keeps the window stable as a marker moves, and the
    // minimum width caps how far in the bar will ever zoom.
    const width = Math.min(duration, Math.max(span * (1 + 2 * padFraction), minWindowSeconds));
    const middle = (a + b) / 2;
    let start = middle - width / 2;
    let end = start + width;
    if (start < 0) {
      start = 0;
      end = width;
    }
    if (end > duration) {
      end = duration;
      start = Math.max(0, duration - width);
    }
    if (end - start <= 0) return full;
    return { start, end, zoomed: end - start < duration - 1e-9 };
  };

  // Position within the current view, 0..1. Out-of-window times clamp to an
  // edge rather than running off it.
  core.timeToViewRatio = (time, view) => {
    const span = view.end - view.start;
    if (!(span > 0) || !Number.isFinite(time)) return 0;
    return Math.min(1, Math.max(0, (time - view.start) / span));
  };

  core.viewRatioToTime = (ratio, view) => {
    const span = view.end - view.start;
    if (!(span > 0)) return view.start || 0;
    return view.start + Math.min(1, Math.max(0, ratio)) * span;
  };

  // Clamps a dragged loop marker so it stays inside the media and cannot cross
  // the other marker: an in point stops minFrames short of the out point, and
  // vice versa. Returns null when the video is not ready.
  core.clampMarker = ({ value, other, which, duration, fps, minFrames = 3 }) => {
    if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return null;
    if (!Number.isFinite(fps) || fps <= 0) return null;
    const minSpan = minFrames / fps;
    let next = value;
    if (Number.isFinite(other)) {
      next = which === 'in' ? Math.min(next, other - minSpan) : Math.max(next, other + minSpan);
    }
    return Math.max(0, Math.min(next, duration));
  };

  // Normalises a loop range. Markers can be set in either order, so these are
  // sorted rather than rejected, and clamped to the media. A range shorter than
  // minFrames is returned as null: looping over one or two frames thrashes the
  // decoder and shows nothing useful.
  core.normalizeLoop = ({ start, end, duration, fps, minFrames = 3 }) => {
    if (!Number.isFinite(duration) || duration <= 0) return null;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (!Number.isFinite(fps) || fps <= 0) return null;
    const a = Math.max(0, Math.min(Math.min(start, end), duration));
    const b = Math.max(0, Math.min(Math.max(start, end), duration));
    // Compared in frames with a tolerance, because float error makes an exactly
    // minFrames-long span measure a hair short: 5 + 3/30 - 5 is 0.0999...,
    // which would silently refuse a loop the user legitimately marked.
    if ((b - a) * fps < minFrames - 1e-6) return null;
    return { start: a, end: b };
  };

  // Whether a playing video has reached the end of its loop. The epsilon lands
  // the restart a touch early rather than overshooting past the out point, which
  // would show a frame the user excluded.
  core.loopShouldRestart = ({ currentTime, loopEnd, paused, epsilon = 0.015 }) => {
    if (paused || !Number.isFinite(currentTime) || !Number.isFinite(loopEnd)) return false;
    return currentTime >= loopEnd - epsilon;
  };

  // Whether a slider's aria-valuetext looks like a media position ("0:44 of
  // 1:45"), which is how a progress slider is told apart from a volume one
  // without depending on a localised aria-label. The timestamp format is
  // numeric, so this survives translation where an English label would not.
  core.looksLikeTimeSlider = (valueText) => {
    if (typeof valueText !== 'string') return false;
    return (valueText.match(/\d{1,2}:\d{2}/g) || []).length >= 1;
  };

  // Which site adapter a hostname belongs to, or null when unsupported.
  // Matched on exact host or a dot-prefixed suffix so that a lookalike such as
  // notinstagram.com or instagram.com.example.net never resolves.
  core.resolveSiteKey = (hostname) => {
    if (typeof hostname !== 'string' || !hostname) return null;
    const host = hostname.toLowerCase();
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
    if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
    return null;
  };

  if (typeof module === 'object' && module.exports) module.exports = core;
  else if (typeof window !== 'undefined') window.__igVcCore = core;
})();
