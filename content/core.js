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


  // The slice of the video the seek bar should represent, as a transition from
  // the window currently in use rather than a fresh calculation each time.
  //
  // Stickiness is the point. The window changes only when it stops working:
  // when a marker falls outside it, when the loop has become too small a share
  // of it to aim at, or when the loop has grown large enough that zooming is
  // pointless. Anything else holds the current window.
  //
  // The thresholds are fractions of the bar, not absolute pixels, because an
  // absolute target can exceed the bar's own width — a 190px goal on a 150px
  // bar can never be met, which makes "needs more zoom" true forever and
  // rescales the bar on every pointer move. minGapPx only suppresses zooming on
  // a bar wide enough that the gap is already comfortable in absolute terms.
  core.nextTimelineView = ({
    current,
    loopIn,
    loopOut,
    duration,
    barWidthPx,
    minGapPx = 190,
    minFraction = 1 / 3,
    maxFraction = 0.9,
    targetFraction = 0.5,
    minWindowSeconds = 5,
    // A loop butted up against the end of the video has no room to its right:
    // the window stops at the media, so B lands exactly on the track's right
    // edge with nothing after it and cannot be grabbed. When B is within
    // endGuardSeconds of the end, the window is extended past the end of the
    // video by enough to leave endPaddingPx of empty track beyond it -- the
    // post-roll a clip trimmer leaves for the same reason.
    //
    // Widening the window in TIME instead was tried and is wrong: it pulls the
    // markers closer together (measured: 45px apart to 11px on a 150px track)
    // and still leaves B on the edge, because the window end is still the
    // media end.
    endGuardSeconds = 1,
    endPaddingPx = 20,
    disabled = false
  }) => {
    const full = {
      start: 0,
      end: Number.isFinite(duration) && duration > 0 ? duration : 0,
      zoomed: false,
      padSeconds: 0
    };
    if (disabled || !Number.isFinite(duration) || duration <= 0) return full;
    if (!Number.isFinite(loopIn) || !Number.isFinite(loopOut)) return full;
    // An unlaid-out bar has no meaningful pixel width; keep whatever is in use
    // rather than thrashing on a zero measurement.
    if (!Number.isFinite(barWidthPx) || barWidthPx <= 0) return current || full;

    const a = Math.min(loopIn, loopOut);
    const b = Math.max(loopIn, loopOut);
    const span = b - a;
    if (span <= 0) return full;

    const fractionOf = (windowWidth) => (windowWidth > 0 ? span / windowWidth : 0);
    // True when the loop sits so close to the end that the window cannot show
    // anything to its right.
    const nearEnd = duration - b < endGuardSeconds;
    // Seconds of window that render as endPaddingPx of track, given a window
    // whose own width includes that padding.
    const padFor = (unpaddedWidth) => {
      if (!nearEnd || !(barWidthPx > endPaddingPx) || !(unpaddedWidth > 0)) return 0;
      const share = endPaddingPx / barWidthPx;
      return (unpaddedWidth * share) / (1 - share);
    };
    // Zoom in only when the loop is both a small share of the bar and narrow in
    // absolute terms, so a very wide bar is left alone.
    const wantsMoreZoom = (windowWidth) => {
      const fraction = fractionOf(windowWidth);
      return fraction < minFraction && fraction * barWidthPx < minGapPx;
    };

    if (current && current.end > current.start) {
      const insideWindow = a >= current.start && b <= current.end;
      if (insideWindow) {
        // End padding is dead space past the media, so every judgement below is
        // made on the width that actually carries video. Measuring the padded
        // width instead meant a padded window could never satisfy the zoom cap
        // -- 5.77s against a 5s cap -- so a tight loop recomputed on every
        // single call and the timeline never settled.
        const pad = Number.isFinite(current.padSeconds) ? current.padSeconds : 0;
        const windowWidth = (current.end - current.start) - pad;
        if (windowWidth <= 0) return full;
        // The loop now fills the window, so the zoom is doing nothing.
        if (fractionOf(windowWidth) > maxFraction) return full;
        // A window established before B reached the end stops at the media, so
        // it has no room past B and must be recomputed rather than kept.
        const needsEndRoom = nearEnd && pad <= 0;
        // Padding that is no longer earned must go, or the timeline keeps
        // showing blank track past a loop that has moved back into the video.
        const staleEndRoom = !nearEnd && pad > 0;
        // Already comfortable, or as far in as the zoom cap allows: hold it.
        const atZoomCap = windowWidth <= minWindowSeconds + 1e-9;
        if (!needsEndRoom && !staleEndRoom && (!wantsMoreZoom(windowWidth) || atZoomCap)) return current;
      }
    } else if (!wantsMoreZoom(duration)) {
      return full;
    }

    // Size the window so the loop occupies targetFraction of it, which lands
    // comfortably above minFraction and so settles rather than zooming again.
    // minWindowSeconds caps how far in the bar will ever go.
    const width = Math.min(duration, Math.max(span / targetFraction, minWindowSeconds));
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
    // Whether this is a zoom is decided before padding, so a padded window at
    // the end of a short video does not start claiming to be zoomed.
    const zoomed = end - start < duration - 1e-9;
    // Leave grabbable track past the media end when B is up against it. The
    // amount is carried on the view so the stickiness checks above can tell
    // dead space apart from window width.
    const padSeconds = padFor(end - start);
    return { start, end: end + padSeconds, zoomed, padSeconds };
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

  // Chooses the first container the browser will actually record. Passing the
  // support check in keeps this testable without a MediaRecorder.
  core.pickRecorderMime = (candidates, isSupported) => {
    if (!Array.isArray(candidates) || typeof isSupported !== 'function') return null;
    for (const candidate of candidates) {
      try {
        if (isSupported(candidate)) return candidate;
      } catch (e) {
        // A malformed candidate should be skipped, not fatal.
      }
    }
    return null;
  };

  // Filename for an exported clip: site, video identifier where the path offers
  // one, and the loop bounds, so saved clips sort and identify themselves.
  core.clipFilename = (hostname, pathname, start, end, extension = 'webm') => {
    const site = core.resolveSiteKey(hostname) || 'video';
    const slug = typeof pathname === 'string'
      ? (pathname.match(/\/(?:p|reel|reels|watch|tv)\/([A-Za-z0-9_-]{3,})/) || [])[1] || ''
      : '';
    const stamp = (n) => (Number.isFinite(n) && n >= 0 ? n.toFixed(2).replace('.', 'p') : '0p00');
    const parts = [site];
    if (slug) parts.push(slug);
    parts.push(`${stamp(start)}-${stamp(end)}`);
    return `${parts.join('-')}.${extension}`;
  };

  // Reads loop times out of a URL fragment, in the form
  //   #loop=<start>,<end>[,<rate>]
  // Tolerant on purpose: accepts a bare fragment or one parameter among several,
  // accepts the markers in either order, and rejects anything it cannot read
  // rather than guessing.
  core.parseLoopFromUrl = (input) => {
    if (typeof input !== 'string' || !input) return null;
    const hashIndex = input.indexOf('#');
    const fragment = hashIndex >= 0 ? input.slice(hashIndex + 1) : input;
    if (!fragment) return null;

    let raw = null;
    for (const part of fragment.split('&')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim().toLowerCase() !== 'loop') continue;
      try {
        raw = decodeURIComponent(part.slice(eq + 1));
      } catch (e) {
        raw = part.slice(eq + 1);
      }
    }
    if (!raw) return null;

    const pieces = raw.split(',').map((piece) => Number(piece.trim()));
    const [start, end, rate] = pieces;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || end < 0) return null;
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    if (b - a <= 0) return null;

    const parsed = { start: a, end: b };
    if (pieces.length > 2 && Number.isFinite(rate) && rate > 0) parsed.rate = rate;
    return parsed;
  };

  // Builds a shareable URL for a loop, replacing any fragment already present.
  // A rate of 1 is left out, since it is the default and only adds noise.
  core.formatLoopUrl = (href, loopIn, loopOut, rate) => {
    if (typeof href !== 'string' || !href) return null;
    if (!Number.isFinite(loopIn) || !Number.isFinite(loopOut)) return null;
    const a = Math.min(loopIn, loopOut);
    const b = Math.max(loopIn, loopOut);
    if (b - a <= 0 || a < 0) return null;
    const round = (n) => Number(n.toFixed(2));
    const parts = [round(a), round(b)];
    if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 1e-9) parts.push(round(rate));
    return `${href.split('#')[0]}#loop=${parts.join(',')}`;
  };

  // Keeps a playback rate inside what browsers accept. Assigning a rate outside
  // this range throws, so an out-of-range or malformed value falls back rather
  // than taking the player down.
  core.clampPlaybackRate = (rate, fallback = 1, min = 0.0625, max = 16) => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.max(min, n));
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

  // Whether an ancestor of a site's progress slider is still part of its
  // control strip, and so safe to hide along with the slider, or whether the
  // walk has climbed out into the player itself.
  //
  // Kept here, away from the DOM, because this decision is where the walk went
  // wrong on Facebook's feed: an earlier version stopped at the first ancestor
  // holding a button, which on a feed post is the very row carrying Play,
  // Settings, Fullscreen and Unmute, so their row kept drawing under our bar.
  // Buttons are deliberately not a signal — a control strip is made of them.
  //
  // The caller passes measurements rather than elements so every branch can be
  // tested against numbers taken off the live sites.
  core.isControlStripAncestor = ({
    containsVideo = false,
    height = 0,
    ceiling = Infinity,
    hasLink = false,
    textLength = 0,
    maxTextLength = 40
  } = {}) => {
    // The player itself, on a surface where the video is a real descendant.
    if (containsVideo) return false;
    // The player itself, on a surface where the video sits in a sibling
    // subtree and the only thing separating the two is size.
    if (Number.isFinite(ceiling) && height > ceiling) return false;
    // A caption or author overlay: sentences and profile links, where a
    // control strip carries a timestamp and nothing else.
    if (hasLink) return false;
    if (textLength > maxTextLength) return false;
    return true;
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
