(() => {
  'use strict';

  window.__igVcCleanup?.();
  for (const el of document.querySelectorAll('.ig-vc-bar')) el.remove();
  for (const el of document.querySelectorAll('.ig-vc-player')) el.classList.remove('ig-vc-player', 'ig-vc-kb');
  for (const el of document.querySelectorAll('.ig-vc-host')) el.classList.remove('ig-vc-host');
  for (const el of document.querySelectorAll('.ig-vc-series-overlay')) el.classList.remove('ig-vc-series-overlay');

  const DEFAULT_SETTINGS = { volume: 1, muted: false, playbackRate: 1 };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Frame stepping
  const DEFAULT_FPS = 30;
  const FPS_CANDIDATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  const FPS_SNAP_TOLERANCE = 0.02;
  const FPS_MIN_SAMPLES = 4;
  const FPS_MAX_SAMPLES = 24;
  const KEYBOARD_REVEAL_MS = 4000;
  const SEEK_STALL_MS = 1000;
  const SHIFT_FRAME_MULTIPLIER = 10;
  const KEYS_FRAME_BACK = new Set(['ArrowLeft']);
  const KEYS_FRAME_FORWARD = new Set(['ArrowRight']);
  const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  // Held-key scrubbing
  const HOLD_DELAY_MS = 180;
  const SCRUB_RATE_NORMAL = 0.5;
  const SCRUB_RATE_FAST = 2;
  const SCRUB_MAX_CATCHUP_FRAMES = 3;

  // Whole-file cache
  const CACHE_MAX_BYTES = 256 * 1024 * 1024;
  const CACHE_TITLES = {
    idle: 'Pre-download this video for load-free scrubbing',
    loading: 'Downloading — click to cancel',
    ready: 'Cached in memory — click to release',
    unsupported: 'This video is streamed in segments by Instagram and cannot be pre-downloaded',
    error: 'Download failed — click to retry'
  };

  // Official Lucide v1.61.0 icon paths
  const svg = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
  const SPEAKER = `<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>`;
  const ICONS = {
    play: svg(`<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>`),
    pause: svg(`<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>`),
    volumeX: svg(`${SPEAKER}<path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>`),
    volume: svg(SPEAKER),
    volume1: svg(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/>`),
    volume2: svg(`${SPEAKER}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`),
    maximize: svg(`<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`),
    minimize: svg(`<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>`),
    // Original thin-stroke glyphs for the cache control, drawn to match the set above
    download: svg(`<path d="M12 4v11"/><path d="m7 12 5 5 5-5"/><path d="M5 20h14"/>`),
    cached: svg(`<path d="m6 11 4 4 8-9"/><path d="M5 20h14"/>`)
  };

  let settings = { ...DEFAULT_SETTINGS };
  const controllers = new Map();

  // Pure logic lives in content/core.js, loaded as the first content script, so
  // the code the extension runs is the same code the test suite exercises.
  const core = window.__igVcCore;

  const formatTime = (s, decimals = 0) => core.formatTime(s, decimals);

  const snapFps = (raw) => core.snapFps(raw, FPS_CANDIDATES, FPS_SNAP_TOLERANCE);

  // Learns a video's true frame rate from presented-frame metadata, since HTML5
  // video exposes no frame rate of its own. requestVideoFrameCallback only fires
  // when a frame is actually painted, so samples arrive during playback and after
  // each seek; until enough land, callers fall back to DEFAULT_FPS.
  function createFrameClock(video) {
    const supported = typeof video.requestVideoFrameCallback === 'function';
    let deltas = [];
    let fps = null;
    let handle = null;
    let prevMediaTime = null;
    let prevPresentedFrames = null;
    let stopped = false;

    const schedule = () => {
      if (stopped || !supported || handle !== null) return;
      try { handle = video.requestVideoFrameCallback(onFrame); } catch (e) {}
    };

    function onFrame(_now, metadata) {
      handle = null;
      const mediaTime = metadata?.mediaTime;
      const presentedFrames = metadata?.presentedFrames;
      // Only frames painted during real playback describe the frame grid. A seek
      // presents a single frame however far it jumped, so sampling while paused or
      // seeking would confirm whatever rate we already assumed instead of the truth.
      const trustworthy = !video.paused && !video.seeking;
      if (trustworthy && Number.isFinite(mediaTime) && Number.isFinite(presentedFrames) && prevMediaTime !== null) {
        // presentedFrames jumps by more than 1 when frames are dropped, so divide
        // the elapsed media time by the frames actually covered.
        const frameSpan = presentedFrames - prevPresentedFrames;
        const timeSpan = mediaTime - prevMediaTime;
        // Only short forward gaps are usable; stalls and leftover seeks are not.
        if (frameSpan > 0 && timeSpan > 1e-4 && timeSpan < 0.5) {
          deltas.push(timeSpan / frameSpan);
          if (deltas.length > FPS_MAX_SAMPLES) deltas.shift();
          if (deltas.length >= FPS_MIN_SAMPLES) {
            const sorted = [...deltas].sort((a, b) => a - b);
            const median = sorted[sorted.length >> 1];
            if (median > 0) fps = snapFps(1 / median);
          }
        }
      }
      prevMediaTime = trustworthy && Number.isFinite(mediaTime) ? mediaTime : null;
      prevPresentedFrames = trustworthy && Number.isFinite(presentedFrames) ? presentedFrames : null;
      schedule();
    }

    schedule();

    return {
      get fps() { return fps || DEFAULT_FPS; },
      get measured() { return fps !== null; },
      // Instagram recycles <video> elements across posts, so a new source
      // invalidates everything learned about the previous one.
      reset() {
        deltas = [];
        fps = null;
        prevMediaTime = null;
        prevPresentedFrames = null;
        schedule();
      },
      stop() {
        stopped = true;
        if (handle !== null) {
          try { video.cancelVideoFrameCallback(handle); } catch (e) {}
          handle = null;
        }
      }
    };
  }

  async function saveSettings(partial) {
    settings = { ...settings, ...partial };
    for (const ctrl of controllers.values()) ctrl.sync();
    try { await chrome.storage.local.set(partial); } catch (e) {}
  }

  const NATIVE_CONTROLS_SELECTOR = [
    '[aria-label="Video progress"]',
    '[role="slider"][aria-valuetext]',
    '[aria-label="Enter fullscreen"]',
    '[aria-label="Exit fullscreen"]'
  ].join(', ');

  // Per-site adapters. Everything site-specific lives here; the rest of the file
  // reads policy off the resolved adapter and otherwise does not care which site
  // it is on.
  //
  // 'replace' mode mounts the full control bar, because Instagram ships almost no
  // controls and there is nothing to compete with. 'augment' mode leaves the
  // site's own controls alone and contributes only what they lack — frame
  // stepping, jog scrubbing and the frame readout — which is the right posture on
  // Facebook, where a full player already exists.
  const SITE_ADAPTERS = {
    instagram: {
      mode: 'replace',
      // Walks up until the subtree would cover more than one video, stopping at
      // Instagram's own player markers.
      playerContainer(video) {
        let cur = video.parentElement;
        let best = cur;
        for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
          if (cur.querySelectorAll('video').length > 1) break;
          best = cur;
          if (cur.querySelector('[data-instancekey], [role="group"][aria-label="Video player"]')) break;
          cur = cur.parentElement;
        }
        return best;
      },
      // A player that already has its own seek or fullscreen affordance is left
      // untouched, so the bar never doubles up on Instagram's native controls.
      hasNativeControls(video, root) {
        const scope = root || video.closest('article, [role="dialog"], [role="presentation"]') || video.parentElement;
        if (!scope) return false;
        return Boolean(scope.querySelector(NATIVE_CONTROLS_SELECTOR))
          || scope.querySelectorAll('[role="slider"]').length > 1;
      },
      skipPath: (pathname) => pathname.startsWith('/stories/'),
      findSeriesOverlay,
      nativeSeekSlider: () => null
    },

    facebook: {
      mode: 'augment',
      // Verified against a live Reel: data-video-id is the stable per-video
      // anchor, it is already position:relative, it contains exactly one video
      // and — unlike the ancestors above it — none of Facebook's own sliders.
      // Walking further up the way Instagram does reaches Facebook's progress
      // slider and would wrongly look like a competing player.
      playerContainer(video) {
        return video.closest('[data-video-id]') || video.parentElement;
      },
      // Augment mode never suppresses itself: Facebook's controls are expected to
      // be present and are deliberately left in place alongside the readout.
      hasNativeControls: () => false,
      skipPath: (pathname) => pathname.startsWith('/stories/'),
      findSeriesOverlay: () => null,
      // Facebook's progress slider lives just outside the data-video-id anchor,
      // so this walks up a few levels from the container. Identified by a
      // position-looking aria-valuetext rather than its English aria-label, with
      // "the only slider in scope" as the structural fallback.
      nativeSeekSlider(video, container) {
        let cur = container;
        for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
          if (cur.querySelectorAll('video').length > 1) break;
          const sliders = [...cur.querySelectorAll('[role="slider"]')];
          const byValueText = sliders.find((s) => core.looksLikeTimeSlider(s.getAttribute('aria-valuetext')));
          if (byValueText) return byValueText;
          if (sliders.length === 1) return sliders[0];
          cur = cur.parentElement;
        }
        return null;
      }
    }
  };

  const siteKey = core.resolveSiteKey(location.hostname);
  const site = SITE_ADAPTERS[siteKey];
  const augmenting = site?.mode === 'augment';

  function resolvePlayerContainer(video) {
    return site.playerContainer(video);
  }

  function hasNativeControls(video, root = resolvePlayerContainer(video)) {
    return site.hasNativeControls(video, root);
  }

  function ensureRelativeContainer(container) {
    if (container && getComputedStyle(container).position === 'static') container.style.position = 'relative';
    return container;
  }

  function findSeriesOverlay(container) {
    let cur = container;
    for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
      if (cur.querySelectorAll('video').length > 1) break;
      for (const link of cur.querySelectorAll('a[href*="/series/"][href*="/watch"]')) {
        if (!/\/series\/[^/]+\/watch\b/.test(link.getAttribute('href') || '')) continue;
        let overlay = link;
        while (overlay.parentElement && overlay.parentElement !== cur) {
          overlay = overlay.parentElement;
        }
        const pos = getComputedStyle(overlay).position;
        if (pos !== 'absolute' && pos !== 'fixed') continue;
        return { host: cur, overlay };
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function bindSlider(el, isVertical, onInput, onStart, onEnd) {
    const track = el.querySelector('.ig-vc-track') || el;
    const calc = (e) => {
      const r = track.getBoundingClientRect();
      const raw = isVertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width;
      return Math.min(1, Math.max(0, raw || 0));
    };
    const setDrag = (active) => {
      el.closest('.ig-vc-player')?.classList.toggle('dragging', active);
      el.closest('.ig-vc-wrap')?.classList.toggle('dragging', active);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      setDrag(true);
      onStart?.();
      onInput(calc(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (el.hasPointerCapture(e.pointerId)) onInput(calc(e));
    });
    for (const evt of ['pointerup', 'pointercancel']) {
      el.addEventListener(evt, (e) => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        el.releasePointerCapture(e.pointerId);
        setDrag(false);
        onEnd?.();
      });
    }
    return () => el.closest('.ig-vc-player')?.classList.contains('dragging');
  }

  function attachVideo(video) {
    if (hasNativeControls(video)) {
      if (controllers.has(video)) {
        controllers.get(video).destroy();
        controllers.delete(video);
      }
      return;
    }
    if (controllers.has(video)) return controllers.get(video).mount();

    const ac = new AbortController();
    const { signal } = ac;
    const bar = document.createElement('div');
    bar.className = augmenting ? 'ig-vc-bar ig-vc-augment' : 'ig-vc-bar';
    bar.innerHTML = `
      <button type="button" class="ig-vc-btn ig-vc-play"></button>
      <span class="ig-vc-time">0:00 / 0:00</span>
      <div class="ig-vc-seek"><div class="ig-vc-track"><div class="ig-vc-buffer"></div><div class="ig-vc-fill"></div></div></div>
      <div class="ig-vc-wrap">
        <button type="button" class="ig-vc-btn ig-vc-mute"></button>
        <div class="ig-vc-popup"><div class="ig-vc-box">
          <div class="ig-vc-vol"><div class="ig-vc-track"><div class="ig-vc-fill"></div></div></div>
        </div></div>
      </div>
      <div class="ig-vc-wrap">
        <button type="button" class="ig-vc-btn ig-vc-speed-btn">1x</button>
        <div class="ig-vc-popup"><div class="ig-vc-box ig-vc-speed-box">
          ${SPEEDS.map((s) => `<button type="button" class="ig-vc-opt" data-speed="${s}">${s}x</button>`).join('')}
        </div></div>
      </div>
      <button type="button" class="ig-vc-btn ig-vc-cache"></button>
      <button type="button" class="ig-vc-btn ig-vc-fs"></button>
    `;

    const [playBtn, timeEl, seekEl, muteBtn, volEl, speedBtn, cacheBtn, fsBtn] = [
      '.ig-vc-play', '.ig-vc-time', '.ig-vc-seek', '.ig-vc-mute', '.ig-vc-vol', '.ig-vc-speed-btn', '.ig-vc-cache', '.ig-vc-fs'
    ].map((sel) => bar.querySelector(sel));
    const speedOpts = bar.querySelectorAll('.ig-vc-opt');

    for (const evt of ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart']) {
      bar.addEventListener(evt, (e) => { e.stopPropagation(); e.preventDefault(); });
    }

    const frameClock = createFrameClock(video);
    let frameMode = false;
    let revealTimer = null;
    // Held-key stepping collapses into one in-flight seek at a time, so intent has
    // to be tracked separately from video.currentTime, which lags behind it.
    let intendedFrame = null;
    let pendingDelta = 0;
    let seekInFlight = false;
    let preloadNudged = false;
    // Dragging the seek bar wants the newest pointer position, not every position
    // it passed through. dragTargetTime holds the last one asked for and doubles as
    // the "a seek drag is in progress" flag; dragDirty says it has not been honoured.
    let dragTargetTime = null;
    let dragDirty = false;
    let seekStartedAt = 0;

    // A seek into unbuffered data can pend indefinitely and its `seeked` may never
    // arrive. Without this, one stalled seek would freeze stepping and dragging
    // permanently, so after a grace period a new seek is allowed to supersede it.
    const seekBlocked = () => core.isSeekBlocked({
      inFlight: seekInFlight,
      startedAt: seekStartedAt,
      now: performance.now(),
      stallMs: SEEK_STALL_MS
    });

    const beginSeek = (t) => {
      seekInFlight = true;
      seekStartedAt = performance.now();
      video.currentTime = t;
    };

    const currentFrameIndex = () => core.frameIndexAt(video.currentTime, frameClock.fps);

    const lastFrameIndex = () => core.lastFrameIndexFor(video.duration, frameClock.fps);

    // Whole-file cache state. The video is fetched once into a blob and the element
    // is repointed at it, so later seeks never touch the network.
    let cacheState = 'idle'; // idle | loading | ready | unsupported | error
    let cacheBlobUrl = null;
    let cacheAbort = null;
    let cacheProgress = 0;
    let cachePercentShown = -1;
    let originalSrc = null;
    let restoreTime = null;

    // Held-key scrubbing state. Forward motion plays the video slowly; backward
    // motion steps on a timed schedule, because no browser implements reverse
    // playback. While scrubbing, sync() must not fight the rate and mute we set.
    let scrubbing = false;
    let scrubDirection = 0;
    let scrubRate = SCRUB_RATE_NORMAL;
    let scrubRafHandle = null;
    let scrubLastTick = 0;
    let scrubAccumulator = 0;
    let preScrubMuted = false;
    let preScrubRate = 1;

    // End of the buffered range covering a given time, which is how far stepping
    // can go without touching the network.
    const bufferedEndNear = (t) => core.bufferedEndNear(video.buffered, t);

    function sync() {
      video.controls = false;
      const vol = Math.min(1, Math.max(0, Number(settings.volume) ?? 1));
      const rate = Number(settings.playbackRate) || 1;
      // In augment mode the host site owns volume, mute and speed — it has its
      // own controls for them, and asserting ours here fights them. Verified on
      // Facebook: a volume written by us is reverted by their player within a
      // second, so this would be a losing battle as well as a wrong one.
      //
      // While scrubbing, rate and mute belong to the scrub; enforcing the saved
      // preferences would cancel it instantly.
      if (!augmenting && !scrubbing) {
        if (Math.abs(video.volume - vol) > 0.005) video.volume = vol;
        if (!video.paused && video.muted !== Boolean(settings.muted)) video.muted = Boolean(settings.muted);
        if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
      }

      playBtn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
      const effVol = settings.muted ? 0 : vol;
      volEl.style.setProperty('--v', `${(effVol * 100).toFixed(1)}%`);
      muteBtn.innerHTML = effVol === 0 ? ICONS.volumeX : effVol < 0.25 ? ICONS.volume : effVol < 0.65 ? ICONS.volume1 : ICONS.volume2;

      speedBtn.textContent = `${Number(rate.toFixed(2))}x`;
      for (const opt of speedOpts) opt.classList.toggle('active', Math.abs(Number(opt.dataset.speed) - rate) < 0.01);

      if (cacheState === 'loading') {
        cacheBtn.textContent = cacheProgress > 0 ? `${Math.round(cacheProgress * 100)}%` : '···';
        cacheBtn.classList.add('ig-vc-cache-text');
      } else {
        cacheBtn.classList.remove('ig-vc-cache-text');
        cacheBtn.innerHTML = cacheState === 'ready' ? ICONS.cached : ICONS.download;
      }
      cacheBtn.classList.toggle('active', cacheState === 'ready');
      cacheBtn.classList.toggle('unavailable', cacheState === 'unsupported' || cacheState === 'error');
      cacheBtn.title = CACHE_TITLES[cacheState] || CACHE_TITLES.idle;

      fsBtn.innerHTML = document.fullscreenElement?.contains(video) ? ICONS.minimize : ICONS.maximize;
    }

    const renderTime = (t) => (frameMode
      ? `${formatTime(t, 2)} / ${formatTime(video.duration)} · f${Math.floor(t * frameClock.fps + 1e-6)}`
      : `${formatTime(t)} / ${formatTime(video.duration)}`);

    // Issues at most one drag seek at a time and always aims at the newest pointer
    // position, discarding whatever it passed through. Writing currentTime on every
    // pointermove instead aborts the in-flight seek each time, so none ever
    // completes and the picture stays frozen until the drag stops.
    const flushDragSeek = () => {
      const decision = core.dragSeekDecision({
        blocked: seekBlocked(),
        dirty: dragDirty,
        target: dragTargetTime,
        currentTime: video.currentTime
      });
      // 'wait' leaves the target pending for the next attempt; 'redundant'
      // consumes it without seeking, because the video is already there.
      if (decision === 'wait') return;
      dragDirty = false;
      if (decision === 'redundant') return;
      // fastSeek trades precision for speed, which is the right trade mid-drag.
      // Firefox implements it; Chrome does not, hence the exact-seek fallback.
      if (typeof video.fastSeek === 'function') {
        seekInFlight = true;
        seekStartedAt = performance.now();
        video.fastSeek(dragTargetTime);
      } else {
        beginSeek(dragTargetTime);
      }
    };

    const updateTime = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      seekEl.style.setProperty('--b', `${((bufferedEndNear(video.currentTime) / video.duration) * 100).toFixed(1)}%`);
      // Mid-drag the pointer owns the fill and the readout, so leave both alone;
      // overwriting them here would snap the bar back to the lagging decoder.
      if (dragTargetTime !== null) return;
      if (!isSeeking()) seekEl.style.setProperty('--v', `${((video.currentTime / video.duration) * 100).toFixed(1)}%`);
      timeEl.textContent = renderTime(video.currentTime);
    };

    let wasPlaying = false;

    const requestPlay = () => {
      if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 0.2) {
        video.currentTime = 0;
      }
      video.play().catch(() => {});
    };

    const requestPause = () => video.pause();

    const isSeeking = bindSlider(
      seekEl,
      false,
      (ratio) => {
        // The fill and readout follow the pointer directly. Only the decoder is
        // paced, so the bar stays responsive even when the picture lags behind it.
        seekEl.style.setProperty('--v', `${(ratio * 100).toFixed(1)}%`);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          dragTargetTime = Math.min(video.duration, Math.max(0, ratio * video.duration));
          dragDirty = true;
          timeEl.textContent = renderTime(dragTargetTime);
          flushDragSeek();
        }
      },
      () => {
        wasPlaying = !video.paused;
        if (wasPlaying) requestPause();
        // A drag supersedes any queued frame steps.
        pendingDelta = 0;
        intendedFrame = null;
        // Dragging is the most seek-heavy thing the bar does, so ask for the file.
        if (!preloadNudged) {
          preloadNudged = true;
          try { video.preload = 'auto'; } catch (e) {}
        }
      },
      () => {
        // The last paced seek landed wherever the pointer happened to be while it
        // was in flight, and may have been approximate, so finish on an exact
        // frame-aligned seek to the real release position.
        if (dragTargetTime !== null && Number.isFinite(video.duration) && video.duration > 0) {
          const frame = core.clampFrame(core.frameIndexAt(dragTargetTime, frameClock.fps), lastFrameIndex());
          intendedFrame = frame;
          beginSeek(core.frameCenter(frame, frameClock.fps));
        }
        dragTargetTime = null;
        dragDirty = false;
        if (wasPlaying) requestPlay();
        updateTime();
      }
    );

    bindSlider(volEl, true, (ratio) => {
      saveSettings({ volume: ratio, muted: ratio === 0 });
      video.muted = ratio === 0;
    });

    let currentContainer = null;
    let currentHost = null;
    let currentSeriesOverlay = null;
    const clearSeriesOverlay = () => {
      currentHost?.classList.remove('ig-vc-host');
      currentSeriesOverlay?.classList.remove('ig-vc-series-overlay');
      currentHost = null;
      currentSeriesOverlay = null;
    };
    const mount = () => {
      const container = video.isConnected && resolvePlayerContainer(video);
      if (hasNativeControls(video, container)) {
        destroy();
        controllers.delete(video);
        return;
      }
      if (ensureRelativeContainer(container)) {
        if (currentContainer && currentContainer !== container) {
          currentContainer.classList.remove('ig-vc-player');
        }
        currentContainer = container;
        if (bar.parentElement !== container) {
          container.classList.add('ig-vc-player');
          container.appendChild(bar);
        }
        const series = site.findSeriesOverlay(container);
        if (series?.host !== currentHost || series?.overlay !== currentSeriesOverlay) {
          clearSeriesOverlay();
          if (series) {
            currentHost = series.host;
            currentSeriesOverlay = series.overlay;
            currentHost.classList.add('ig-vc-host');
            currentSeriesOverlay.classList.add('ig-vc-series-overlay');
          }
        }
        bindNativeSlider();
      }
    };

    const destroy = () => {
      ro.disconnect();
      ac.abort();
      frameClock.stop();
      clearTimeout(revealTimer);
      pendingDelta = 0;
      seekInFlight = false;
      intendedFrame = null;
      dragTargetTime = null;
      dragDirty = false;
      scrubbing = false;
      scrubDirection = 0;
      if (scrubRafHandle !== null) {
        cancelAnimationFrame(scrubRafHandle);
        scrubRafHandle = null;
      }
      // Hand the element back to Instagram's own source, so a recycled <video> is
      // never left pointing at a blob URL that is about to be revoked.
      cacheAbort?.abort();
      cacheAbort = null;
      if (cacheBlobUrl && originalSrc && video.src === cacheBlobUrl) {
        video.src = originalSrc;
        video.load();
      }
      releaseCacheBlob();
      cacheState = 'idle';
      bar.remove();
      clearSeriesOverlay();
      const container = currentContainer || (video.isConnected && resolvePlayerContainer(video));
      container?.classList.remove('ig-vc-player', 'ig-vc-kb');
      currentContainer = null;
    };

    // Keyboard actions happen without the pointer over the player, so the bar has
    // to be revealed deliberately and then released back to hover control. Bar
    // visibility doubles as the engagement signal that gates the keyboard.
    const revealBar = (withFrameInfo) => {
      frameMode = withFrameInfo;
      currentContainer?.classList.add('ig-vc-kb');
      currentContainer?.classList.remove('idle');
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        // A long hold must not time the bar out from under an active scrub.
        if (scrubbing) {
          revealBar(withFrameInfo);
          return;
        }
        frameMode = false;
        currentContainer?.classList.remove('ig-vc-kb');
        updateTime();
      }, KEYBOARD_REVEAL_MS);
      updateTime();
    };

    // Issues at most one seek at a time and collapses everything queued behind it
    // into the next one. Assigning currentTime while a seek is still running makes
    // the browser abandon and restart it, which is what makes a held key stutter.
    const flushSeek = () => {
      if (seekBlocked() || pendingDelta === 0) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        pendingDelta = 0;
        return;
      }
      const base = intendedFrame ?? currentFrameIndex();
      const target = core.stepTarget({
        base,
        pendingDelta,
        lastFrame: lastFrameIndex(),
        hasIntent: intendedFrame !== null
      });
      pendingDelta = 0;
      if (target === null) return;
      intendedFrame = target;
      // Seeks to the centre of the target frame rather than its boundary, so float
      // rounding cannot land on the neighbour and stepping stays reversible.
      beginSeek(core.frameCenter(target, frameClock.fps));
    };

    const queueFrames = (delta) => {
      // A fresh burst starts from where the video actually is; anything queued
      // mid-burst accumulates against the pending target, not the stale position.
      if (!seekInFlight && pendingDelta === 0) intendedFrame = currentFrameIndex();
      pendingDelta += delta;
      flushSeek();
    };

    const stepFrames = (delta) => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
      if (!video.paused) requestPause();
      // Ask for the whole file once the user starts stepping, so a held key walks
      // through buffered data instead of waiting on a range request per frame.
      // No-op for Instagram's MSE-backed players, which buffer on their own terms.
      if (!preloadNudged) {
        preloadNudged = true;
        try { video.preload = 'auto'; } catch (e) {}
      }
      queueFrames(delta);
      revealBar(true);
      return true;
    };

    const togglePlay = () => {
      intendedFrame = null;
      pendingDelta = 0;
      if (video.paused) requestPlay();
      else requestPause();
      revealBar(false);
      return true;
    };

    // Reverse motion, paced in wall-clock time rather than run as fast as the
    // decoder allows. Even spacing is what reads as smooth; "every frame, whenever
    // it lands" is what reads as stutter.
    const scrubTick = (now) => {
      scrubRafHandle = null;
      if (!scrubbing) return;
      const elapsed = now - scrubLastTick;
      scrubLastTick = now;
      scrubAccumulator += elapsed;
      const paced = core.scrubSteps({
        accumulator: scrubAccumulator,
        elapsedMs: elapsed,
        fps: frameClock.fps,
        rate: scrubRate,
        maxCatchup: SCRUB_MAX_CATCHUP_FRAMES
      });
      scrubAccumulator = paced.accumulator;
      if (paced.steps > 0) {
        // While a seek is still decoding, drop the backlog rather than bank it.
        // Catching up later would lurch, and during a scrub smooth motion matters
        // more than an exact frame count: falling behind just moves slower.
        if (!seekBlocked()) queueFrames(-paced.steps);
      }
      if (video.currentTime <= 0) {
        endScrub();
        return;
      }
      scrubRafHandle = requestAnimationFrame(scrubTick);
    };

    const beginScrub = (direction, fast) => {
      if (scrubbing || !Number.isFinite(video.duration) || video.duration <= 0) return;
      scrubbing = true;
      scrubDirection = direction;
      scrubRate = fast ? SCRUB_RATE_FAST : SCRUB_RATE_NORMAL;
      // Remember what the scrub is about to borrow. In augment mode the saved
      // preferences are not authoritative — the host site's controls are — so the
      // only correct thing to restore is whatever was actually in effect.
      preScrubMuted = video.muted;
      preScrubRate = video.playbackRate;
      revealBar(true);
      if (direction > 0) {
        // Forward motion hands the work back to the decoder's normal playback
        // path. No seeking at all, frames presented on schedule: the only way to
        // get genuinely smooth output. Audio at a scrub rate is just noise.
        video.muted = true;
        video.playbackRate = scrubRate;
        video.play().catch(() => {});
      } else {
        scrubLastTick = performance.now();
        scrubAccumulator = 0;
        scrubRafHandle = requestAnimationFrame(scrubTick);
      }
    };

    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing = false;
      if (scrubRafHandle !== null) {
        cancelAnimationFrame(scrubRafHandle);
        scrubRafHandle = null;
      }
      if (scrubDirection > 0) video.pause();
      scrubDirection = 0;
      // currentTime is left wherever playback stopped; frame indices derive from
      // it, so a following tap is still exact without a corrective seek.
      if (augmenting) {
        video.playbackRate = preScrubRate;
        video.muted = preScrubMuted;
      } else {
        video.playbackRate = Number(settings.playbackRate) || 1;
        video.muted = Boolean(settings.muted);
      }
      revealBar(true);
      sync();
    };

    // Facebook's own progress slider is scrub-on-release: during a drag it moves
    // its thumb but leaves the video pinned. Verified on a live Reel —
    // currentTime held at a single value across 29 samples of a 1.4s drag, then
    // jumped only on release. This adds the live picture updates it omits,
    // routed through the same paced-seek path as our own slider.
    //
    // Propagation is deliberately NOT stopped: Facebook's handler must keep
    // running so its thumb still tracks the pointer and its own release-seek
    // remains the final word on where the video lands.
    let nativeSlider = null;
    let nativeDragPointer = null;

    const nativeDragTo = (clientX) => {
      if (!nativeSlider || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const rect = nativeSlider.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      dragTargetTime = Math.min(video.duration, Math.max(0, ratio * video.duration));
      dragDirty = true;
      timeEl.textContent = renderTime(dragTargetTime);
      flushDragSeek();
    };

    const onNativePointerDown = (e) => {
      if (e.button !== 0 || nativeDragPointer !== null) return;
      nativeDragPointer = e.pointerId;
      wasPlaying = !video.paused;
      if (wasPlaying) requestPause();
      // A slider drag supersedes any queued frame steps.
      pendingDelta = 0;
      intendedFrame = null;
      revealBar(false);
      nativeDragTo(e.clientX);
    };

    const onNativePointerMove = (e) => {
      if (nativeDragPointer === null || e.pointerId !== nativeDragPointer) return;
      nativeDragTo(e.clientX);
    };

    const onNativePointerEnd = (e) => {
      if (nativeDragPointer === null || e.pointerId !== nativeDragPointer) return;
      nativeDragPointer = null;
      // Facebook issues its own exact seek on release. Ours would race it, so the
      // pending target is dropped rather than contested.
      dragTargetTime = null;
      dragDirty = false;
      if (wasPlaying) requestPlay();
      updateTime();
    };

    // Facebook mounts the slider lazily and can replace the element, so this is
    // re-checked on every mount and rebinds when the element actually changes.
    const bindNativeSlider = () => {
      if (!augmenting || !site.nativeSeekSlider) return;
      const found = site.nativeSeekSlider(video, currentContainer || resolvePlayerContainer(video));
      if (!found || found === nativeSlider) return;
      nativeSlider = found;
      found.addEventListener('pointerdown', onNativePointerDown, { signal, capture: true });
    };

    window.addEventListener('pointermove', onNativePointerMove, { signal, capture: true });
    for (const evt of ['pointerup', 'pointercancel']) {
      window.addEventListener(evt, onNativePointerEnd, { signal, capture: true });
    }

    const releaseCacheBlob = () => {
      if (cacheBlobUrl) {
        URL.revokeObjectURL(cacheBlobUrl);
        cacheBlobUrl = null;
      }
      cacheProgress = 0;
      cachePercentShown = -1;
    };

    // Hands the element back to Instagram's own source before dropping the blob,
    // since revoking a URL the video is still playing from would break playback.
    const disableCache = () => {
      cacheAbort?.abort();
      cacheAbort = null;
      if (cacheBlobUrl && originalSrc && video.src === cacheBlobUrl) {
        restoreTime = video.currentTime;
        const wasPlaying = !video.paused;
        video.src = originalSrc;
        video.load();
        if (wasPlaying) video.play().catch(() => {});
      }
      releaseCacheBlob();
      cacheState = 'idle';
      sync();
    };

    const enableCache = async () => {
      const source = video.currentSrc || video.src;
      // A blob:/MediaSource src means Instagram's player is feeding segments in
      // from its own JavaScript. There is no fetchable file behind it, and
      // overwriting the src would break their player, so this is left alone.
      if (core.cacheRejectReason({ source, bytes: 0, maxBytes: CACHE_MAX_BYTES }) === 'unsupported') {
        cacheState = 'unsupported';
        sync();
        return;
      }
      originalSrc = source;
      cacheState = 'loading';
      cacheProgress = 0;
      cachePercentShown = -1;
      sync();
      cacheAbort = new AbortController();
      try {
        // The same file the element already loaded, so this usually comes straight
        // from the browser's HTTP cache. Cookies are deliberately not attached.
        const res = await fetch(source, { credentials: 'omit', signal: cacheAbort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length')) || 0;
        if (core.cacheRejectReason({ source, bytes: total, maxBytes: CACHE_MAX_BYTES })) {
          throw new Error('exceeds cache size limit');
        }
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (core.cacheRejectReason({ source, bytes: received, maxBytes: CACHE_MAX_BYTES })) {
            reader.cancel();
            throw new Error('exceeds cache size limit');
          }
          cacheProgress = total ? received / total : 0;
          // Chunks land far faster than the eye can read, so only repaint when the
          // whole percentage actually moves.
          const percent = Math.round(cacheProgress * 100);
          if (percent !== cachePercentShown) {
            cachePercentShown = percent;
            sync();
          }
        }
        const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' });
        cacheAbort = null;
        cacheBlobUrl = URL.createObjectURL(blob);
        restoreTime = video.currentTime;
        const wasPlaying = !video.paused;
        video.src = cacheBlobUrl;
        video.load();
        cacheState = 'ready';
        if (wasPlaying) video.play().catch(() => {});
        sync();
      } catch (err) {
        cacheAbort = null;
        releaseCacheBlob();
        // Cancelling is a normal outcome, not a failure.
        cacheState = err?.name === 'AbortError' ? 'idle' : 'error';
        sync();
      }
    };

    playBtn.addEventListener('click', () => (video.paused ? requestPlay() : requestPause()));
    muteBtn.addEventListener('click', () => {
      const muted = !settings.muted;
      saveSettings({ volume: !muted && settings.volume === 0 ? 0.5 : settings.volume, muted });
      video.muted = muted;
    });
    for (const opt of speedOpts) opt.addEventListener('click', () => saveSettings({ playbackRate: Number(opt.dataset.speed) }));
    speedBtn.addEventListener('contextmenu', () => saveSettings({ playbackRate: 1 }));
    cacheBtn.addEventListener('click', () => {
      if (cacheState === 'loading') {
        cacheAbort?.abort();
        return;
      }
      if (cacheState === 'ready') {
        disableCache();
        return;
      }
      enableCache();
    });
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else (currentContainer || ensureRelativeContainer(resolvePlayerContainer(video)) || video).requestFullscreen().catch(() => {});
    });

    for (const evt of ['play', 'playing', 'pause', 'volumechange', 'ratechange']) {
      video.addEventListener(evt, sync, { signal });
    }
    video.addEventListener('loadedmetadata', () => {
      frameClock.reset();
      intendedFrame = null;
      pendingDelta = 0;
      seekInFlight = false;
      dragTargetTime = null;
      dragDirty = false;
      preloadNudged = false;
      // Instagram recycles <video> elements, so if our blob is no longer the source
      // the element has been reclaimed and the cache belongs to a different video.
      if (cacheBlobUrl && video.currentSrc !== cacheBlobUrl) {
        releaseCacheBlob();
        cacheState = 'idle';
      }
      if (restoreTime !== null) {
        const resumeAt = restoreTime;
        restoreTime = null;
        if (Number.isFinite(resumeAt) && resumeAt > 0) video.currentTime = resumeAt;
      }
      mount();
      sync();
      updateTime();
    }, { signal });
    video.addEventListener('timeupdate', updateTime, { signal });
    video.addEventListener('progress', updateTime, { signal });
    // Pacing: the next queued step or drag target only goes out once this seek has
    // landed. A drag supersedes queued frame steps, so it is flushed first.
    video.addEventListener('seeked', () => {
      seekInFlight = false;
      flushDragSeek();
      flushSeek();
      updateTime();
    }, { signal });

    const ro = new ResizeObserver(mount);
    ro.observe(video);
    mount();
    sync();
    updateTime();

    controllers.set(video, { mount, sync, destroy, stepFrames, togglePlay, beginScrub, endScrub, container: () => currentContainer });
  }

  let fsIdleTimer = null;
  const onFsMove = (e) => {
    const fs = document.fullscreenElement;
    if (!fs || !fs.classList.contains('ig-vc-player')) return;
    fs.classList.remove('idle');
    clearTimeout(fsIdleTimer);
    if (!e.target?.closest?.('.ig-vc-bar')) {
      fsIdleTimer = setTimeout(() => fs.classList.add('idle'), 2000);
    }
  };
  const onFsClick = (e) => {
    const fs = document.fullscreenElement;
    if (fs && fs.classList.contains('ig-vc-player') && !e.target.closest('.ig-vc-bar')) {
      e.stopPropagation();
      e.preventDefault();
      const v = fs.querySelector('video');
      if (v) {
        if (v.paused) {
          if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.2) {
            v.currentTime = 0;
          }
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      }
    }
  };
  const onFsSync = () => {
    clearTimeout(fsIdleTimer);
    for (const el of document.querySelectorAll('.ig-vc-player.idle')) el.classList.remove('idle');
    for (const a of document.querySelectorAll('a[data-ig-href]')) {
      a.setAttribute('href', a.dataset.igHref);
      delete a.dataset.igHref;
    }
    const fs = document.fullscreenElement;
    if (fs?.classList.contains('ig-vc-player')) {
      const fsLink = fs.closest('a[href]');
      if (fsLink) {
        fsLink.dataset.igHref = fsLink.getAttribute('href');
        fsLink.removeAttribute('href');
      }
    }
    for (const ctrl of controllers.values()) ctrl.sync();
  };
  const isTypingContext = (el) =>
    Boolean(el?.isContentEditable) || Boolean(el?.closest?.(TYPING_SELECTOR));

  // Arrows move Instagram's carousels and Space scrolls the feed, so the keyboard
  // is claimed only for a player that is visibly engaged: fullscreen, under the
  // pointer, or still in keyboard mode from a recent press. Everywhere else
  // Instagram's own handling is left completely untouched.
  function resolveActiveVideo() {
    const fs = document.fullscreenElement;
    if (fs) {
      for (const video of controllers.keys()) {
        if (fs === video || fs.contains(video)) return video;
      }
    }
    let hovered = null;
    let keyboardActive = null;
    for (const [video, ctrl] of controllers.entries()) {
      if (!video.isConnected) continue;
      const container = ctrl.container();
      if (!container?.isConnected) continue;
      if (!hovered && container.matches(':hover')) hovered = video;
      if (!keyboardActive && container.classList.contains('ig-vc-kb')) keyboardActive = video;
    }
    // The pointer is a present-tense signal, so it outranks a lapsing keyboard
    // session; without it, stepping survives the mouse drifting off the player.
    return hovered || keyboardActive;
  }

  // A tap and a hold want different mechanisms: a tap wants one precise seek, a
  // hold wants continuous motion. The first press steps once, then this timer
  // decides the press became a hold and switches to scrubbing. Driving it from our
  // own timer rather than the OS key-repeat avoids the ~300-500ms repeat delay and
  // the arbitrary repeat rate that varies per machine.
  let holdTimer = null;
  let holdVideo = null;

  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (holdVideo) {
      controllers.get(holdVideo)?.endScrub();
      holdVideo = null;
    }
  };

  const onKeyDown = (e) => {
    // Leave browser and OS shortcuts and IME composition alone.
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const space = e.key === ' ' || e.code === 'Space';
    const back = KEYS_FRAME_BACK.has(e.key);
    const forward = KEYS_FRAME_FORWARD.has(e.key);
    if (!space && !back && !forward) return;
    if (isTypingContext(e.target) || isTypingContext(document.activeElement)) return;
    const video = resolveActiveVideo();
    const ctrl = controllers.get(video);
    if (!ctrl) return;

    if (space) {
      stopHold();
      ctrl.togglePlay();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // OS key-repeat is swallowed: motion is driven by the scrub, not by repeats.
    if (e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const direction = back ? -1 : 1;
    // Tear down any scrub already running before the new press takes effect, so
    // the old one cannot restore rate and mute on top of the new motion.
    stopHold();
    // Only claim the key once the video actually acted on it.
    if (!ctrl.stepFrames(direction * (e.shiftKey ? SHIFT_FRAME_MULTIPLIER : 1))) return;
    holdVideo = video;
    const fast = e.shiftKey;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      controllers.get(video)?.beginScrub(direction, fast);
    }, HOLD_DELAY_MS);
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyUp = (e) => {
    if (KEYS_FRAME_BACK.has(e.key) || KEYS_FRAME_FORWARD.has(e.key)) stopHold();
  };

  const stopVis = (e) => e.stopImmediatePropagation();
  document.addEventListener('visibilitychange', stopVis, true);
  window.addEventListener('pointermove', onFsMove, { passive: true });
  window.addEventListener('click', onFsClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  // A key held while focus leaves the page never reports its keyup, which would
  // otherwise leave a scrub running indefinitely.
  window.addEventListener('blur', stopHold);
  document.addEventListener('fullscreenchange', onFsSync);

  function scanVideos() {
    if (!site || site.skipPath(location.pathname)) {
      for (const ctrl of controllers.values()) ctrl.destroy();
      controllers.clear();
      return;
    }
    for (const [vid, ctrl] of controllers.entries()) {
      if (!vid.isConnected || hasNativeControls(vid)) {
        ctrl.destroy();
        controllers.delete(vid);
      }
    }
    for (const v of document.querySelectorAll('video')) {
      if (!hasNativeControls(v)) attachVideo(v);
    }
  }

  let scanPending = false;
  const scheduleScan = () => {
    if (scanPending) return;
    scanPending = true;
    requestAnimationFrame(() => {
      scanPending = false;
      scanVideos();
    });
  };

  const observer = new MutationObserver(scheduleScan);
  window.__igVcCleanup = () => {
    clearTimeout(fsIdleTimer);
    document.removeEventListener('visibilitychange', stopVis, true);
    window.removeEventListener('pointermove', onFsMove);
    window.removeEventListener('click', onFsClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', stopHold);
    stopHold();
    document.removeEventListener('fullscreenchange', onFsSync);
    observer.disconnect();
    for (const ctrl of controllers.values()) ctrl.destroy();
    controllers.clear();
  };

  (async () => {
    // An unsupported host should do nothing at all rather than half-initialise.
    if (!site) return;
    try { settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) }; } catch (e) {}
    scanVideos();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
