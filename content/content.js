(() => {
  'use strict';

  window.__igVcCleanup?.();
  for (const el of document.querySelectorAll('.ig-vc-bar')) el.remove();
  for (const el of document.querySelectorAll('.ig-vc-player')) el.classList.remove('ig-vc-player', 'ig-vc-kb');
  for (const el of document.querySelectorAll('.ig-vc-host')) el.classList.remove('ig-vc-host');
  for (const el of document.querySelectorAll('.ig-vc-series-overlay')) el.classList.remove('ig-vc-series-overlay');

  const DEFAULT_SETTINGS = { volume: 1, muted: false, playbackRate: 1, loopRate: 1 };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  // Slow-biased, because the point of a practice loop is studying a fast move.
  const LOOP_SPEEDS = [0.1, 0.25, 0.5, 0.75, 1];

  // Frame stepping
  const DEFAULT_FPS = 30;
  const FPS_CANDIDATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  const FPS_SNAP_TOLERANCE = 0.02;
  const FPS_MIN_SAMPLES = 4;
  const FPS_MAX_SAMPLES = 24;
  const KEYBOARD_REVEAL_MS = 4000;
  const SEEK_STALL_MS = 1000;

  // A-B loop, for practising a single move
  const LOOP_MIN_FRAMES = 3;
  // ~2 inches at 96dpi: the point below which two handles are too close to aim
  // at individually. Unzoom only once they are much further apart, so the bar
  // does not flip back and forth around a single threshold.
  const ZOOM_MIN_GAP_PX = 190;
  // The trigger sits well below the target so each zoom buys a factor of 2.5 in
  // span before another is needed, which keeps the number of discrete steps
  // across a long drag small. At 20% of a 150px bar the handles are still ~30px
  // apart, comfortably aimable for 9px handles.
  const ZOOM_MIN_FRACTION = 0.2;
  const ZOOM_MAX_FRACTION = 0.9;
  const ZOOM_TARGET_FRACTION = 0.5;
  const ZOOM_MIN_WINDOW_SECONDS = 5;
  // A B marker within this much of the end of the video would sit exactly on the
  // track's right edge, where it cannot be grabbed. The timeline is extended
  // past the end of the video by enough to leave this many pixels of track
  // beyond it, the way a clip trimmer leaves post-roll.
  // Long enough that dragging a handle writes once on settling rather than on
  // every pointer move.
  const URL_WRITE_DEBOUNCE_MS = 400;
  const ZOOM_END_GUARD_SECONDS = 1;
  const ZOOM_END_PADDING_PX = 20;
  const KEYS_LOOP_IN = new Set(['[', '{']);
  const KEYS_LOOP_OUT = new Set([']', '}']);
  const KEYS_LOOP_TOGGLE = new Set(['\\']);
  const KEYS_LOOP_RESTART = new Set(['Home']);
  const KEYS_LOOP_CLEAR = new Set(['|']);
  const KEYS_THEATER = new Set(['t', 'T']);
  const SHIFT_FRAME_MULTIPLIER = 10;
  const KEYS_FRAME_BACK = new Set(['ArrowLeft']);
  const KEYS_FRAME_FORWARD = new Set(['ArrowRight']);
  const TYPING_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  // Held-key scrubbing
  const HOLD_DELAY_MS = 180;
  const SCRUB_RATE_NORMAL = 0.5;
  const SCRUB_RATE_FAST = 2;
  const SCRUB_MAX_CATCHUP_FRAMES = 3;


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
    // Original thin-stroke glyph for the clip export control, matching the set above
    download: svg(`<path d="M12 4v11"/><path d="m7 12 5 5 5-5"/><path d="M5 20h14"/>`),
    loop: svg(`<path d="M3 11V9a4 4 0 0 1 4-4h11"/><path d="m15 2 3 3-3 3"/><path d="M21 13v2a4 4 0 0 1-4 4H6"/><path d="m9 22-3-3 3-3"/>`),
    link: svg(`<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M8 12h8"/>`),
    restart: svg(`<path d="M6 5v14"/><path d="M20 5 9 12l11 7z"/>`)
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
  // A loop shared by URL belongs to the video the link was opened for, so it is
  // consumed by the first player able to accept it rather than applied to every
  // video in a feed. The launch URL is read from the document_start capture,
  // falling back to the live location where the site has not rewritten it.
  let pendingUrlLoop = core.parseLoopFromUrl(window.__igVcLaunchUrl?.hash || location.hash);

  // Exported loop clips. Recording is real time and captures the element's
  // rendered output, since both sites stream through MediaSource and there is no
  // file to slice. Verified on a live Reel: captureStream yields live audio and
  // video tracks, and MediaRecorder produces a decodable 540x960 WebM.
  const CLIP_MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  const CLIP_MAX_SECONDS = 60;
  const CLIP_LEAD_IN_MS = 350;
  const CLIP_TITLES = {
    idle: 'Record this loop and save it as a clip',
    recording: 'Recording the loop in real time — click to cancel',
    unavailable: 'Set both A and B to export a clip',
    unsupported: 'This browser cannot record from a video element',
    error: 'Recording failed — click to retry'
  };

  // Theater overlay: covers the page so only the video is visible, while leaving
  // the browser's own chrome alone. Requested in preference to real fullscreen,
  // which hides the tabs and address bar; this is a page-level overlay, so the
  // browser stays exactly as it is. Also where a freshly recorded clip opens.
  let theaterEl = null;
  // When the overlay adopts the live player instead of playing a standalone
  // file, this records where to put it back.
  let theaterAdopted = null;

  const downloadUrl = (url, filename) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const onTheaterKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeTheater();
  };

  function closeTheater() {
    if (!theaterEl) return;
    // Put an adopted player back exactly where it was, before the overlay goes.
    if (theaterAdopted) {
      const { element, parent, nextSibling } = theaterAdopted;
      element.classList.remove('ig-vc-theater-adopted');
      // The overlay set this to make the box track the picture; the page's own
      // layout must not inherit it.
      element.style.removeProperty('aspect-ratio');
      if (parent && parent.isConnected) parent.insertBefore(element, nextSibling || null);
      theaterAdopted = null;
    }
    const held = theaterEl.querySelector('.ig-vc-theater-video');
    if (held) {
      held.pause();
      held.removeAttribute('src');
      held.load();
    }
    // Leaving real fullscreen first, or the browser is left in fullscreen with
    // nothing in it.
    if (document.fullscreenElement === theaterEl) document.exitFullscreen().catch(() => {});
    // Only a blob we created gets revoked; a page URL must be left alone.
    const revoke = theaterEl.dataset.revokeUrl;
    theaterEl.remove();
    theaterEl = null;
    document.removeEventListener('keydown', onTheaterKey, true);
    document.removeEventListener('fullscreenchange', onTheaterFullscreenChange);
    if (revoke) URL.revokeObjectURL(revoke);
  }

  function onTheaterFullscreenChange() {
    if (!theaterEl) return;
    const button = theaterEl.querySelector('.ig-vc-theater-fs');
    if (!button) return;
    const isFull = document.fullscreenElement === theaterEl;
    button.textContent = isFull ? 'exit fullscreen' : 'fullscreen';
    button.title = isFull
      ? 'Leave real fullscreen and go back to covering the page'
      : 'Enter real browser fullscreen, hiding the tabs and address bar too';
  }

  // Two modes. `adopt` relocates the live player into the overlay, which is the
  // only way to show a MediaSource-backed video: its blob URL can be attached
  // to exactly one element, so a second <video> pointed at the same URL loads
  // nothing. `src` plays a standalone file, which is how a recorded clip opens.
  function openTheater({ adopt = null, src = null, revokeUrl = null, filename = null, label = '' }) {
    closeTheater();
    theaterEl = document.createElement('div');
    theaterEl.className = 'ig-vc-theater';
    if (revokeUrl) theaterEl.dataset.revokeUrl = revokeUrl;
    theaterEl.innerHTML = `
      <div class="ig-vc-theater-bar">
        <span class="ig-vc-theater-label"></span>
        <span class="ig-vc-theater-actions">
          <button type="button" class="ig-vc-theater-save"></button>
          <button type="button" class="ig-vc-theater-fs">fullscreen</button>
          <button type="button" class="ig-vc-theater-close">close</button>
        </span>
      </div>
      <div class="ig-vc-theater-stage"></div>
    `;
    theaterEl.querySelector('.ig-vc-theater-label').textContent = label;
    const stage = theaterEl.querySelector('.ig-vc-theater-stage');
    const saveBtn = theaterEl.querySelector('.ig-vc-theater-save');
    if (filename && src) {
      saveBtn.textContent = 'save again';
      saveBtn.addEventListener('click', () => downloadUrl(src, filename));
    } else {
      saveBtn.remove();
    }
    // Real fullscreen lives here rather than on the bar. A click inside the
    // overlay is a fresh user gesture, which is what requestFullscreen needs —
    // and what a recording several seconds long no longer has when it finishes.
    theaterEl.querySelector('.ig-vc-theater-fs').addEventListener('click', () => {
      if (document.fullscreenElement === theaterEl) document.exitFullscreen().catch(() => {});
      else theaterEl.requestFullscreen().catch(() => {});
    });
    theaterEl.querySelector('.ig-vc-theater-close').addEventListener('click', closeTheater);
    // Clicking the backdrop dismisses, but a click on the stage must not.
    theaterEl.addEventListener('click', (e) => {
      if (e.target === theaterEl) closeTheater();
    });
    document.body.appendChild(theaterEl);

    if (adopt) {
      // Relocating the player brings our own control bar with it, so the loop
      // controls stay available in theater mode.
      theaterAdopted = { element: adopt, parent: adopt.parentElement, nextSibling: adopt.nextSibling };
      adopt.classList.add('ig-vc-theater-adopted');
      stage.appendChild(adopt);
      // The stylesheet fills the stage's height; this supplies the width, by
      // giving the box the video's own proportions. Without it the box is as
      // wide as the stage, so the bar stretches across the letterboxing
      // instead of sitting under the picture.
      const fitAdoptedBox = () => {
        if (!theaterAdopted || theaterAdopted.element !== adopt) return false;
        const media = adopt.querySelector('video');
        const w = media ? media.videoWidth : 0;
        const h = media ? media.videoHeight : 0;
        if (!w || !h) return false;
        adopt.style.aspectRatio = `${w} / ${h}`;
        return true;
      };
      // Dimensions are zero until the first frame is decoded, which on a paused
      // video that was never played has not happened yet.
      if (!fitAdoptedBox()) {
        const media = adopt.querySelector('video');
        if (media) {
          const onReady = () => {
            // Stop listening once the box is sized, and also if the overlay
            // closed first: the video outlives the overlay, so a listener left
            // on it would leak one pair per open.
            const stale = !theaterAdopted || theaterAdopted.element !== adopt;
            if (fitAdoptedBox() || stale) {
              media.removeEventListener('loadedmetadata', onReady);
              media.removeEventListener('resize', onReady);
            }
          };
          media.addEventListener('loadedmetadata', onReady);
          media.addEventListener('resize', onReady);
        }
      }
    } else if (src) {
      const held = document.createElement('video');
      held.className = 'ig-vc-theater-video';
      held.controls = true;
      held.loop = true;
      held.playsInline = true;
      held.src = src;
      stage.appendChild(held);
      held.play().catch(() => {});
    }

    document.addEventListener('keydown', onTheaterKey, true);
    document.addEventListener('fullscreenchange', onTheaterFullscreenChange);
    onTheaterFullscreenChange();
  }

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
      <button type="button" class="ig-vc-btn ig-vc-loop-restart"></button>
      <button type="button" class="ig-vc-btn ig-vc-play"></button>
      <span class="ig-vc-time">0:00 / 0:00</span>
      <div class="ig-vc-seek"><div class="ig-vc-track"><div class="ig-vc-buffer"></div><div class="ig-vc-loop-span"></div><div class="ig-vc-fill"></div></div><div class="ig-vc-playhead"></div><div class="ig-vc-handle ig-vc-handle-a"></div><div class="ig-vc-handle ig-vc-handle-b"></div><div class="ig-vc-hint"></div></div>
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
      <div class="ig-vc-wrap ig-vc-loop-wrap">
        <button type="button" class="ig-vc-btn ig-vc-loop-toggle"></button>
        <div class="ig-vc-popup"><div class="ig-vc-box ig-vc-loop-box">
          ${LOOP_SPEEDS.map((s) => `<button type="button" class="ig-vc-opt ig-vc-loop-speed" data-loop-speed="${s}">${s}x</button>`).join('')}
          <div class="ig-vc-loop-sep"></div>
          <button type="button" class="ig-vc-opt ig-vc-loop-in">A</button>
          <button type="button" class="ig-vc-opt ig-vc-loop-out">B</button>
          <button type="button" class="ig-vc-opt ig-vc-loop-clear">clr</button>
          <button type="button" class="ig-vc-opt ig-vc-clip">clip</button>
          <button type="button" class="ig-vc-opt ig-vc-loop-zoom">fit</button>
        </div></div>
      </div>
      <button type="button" class="ig-vc-btn ig-vc-loop-link"></button>
      <button type="button" class="ig-vc-btn ig-vc-fs"></button>
    `;

    const [loopRestartBtn, playBtn, timeEl, seekEl, muteBtn, volEl, speedBtn, loopInBtn, loopOutBtn, loopToggleBtn, clipBtn, fsBtn] = [
      '.ig-vc-loop-restart', '.ig-vc-play', '.ig-vc-time', '.ig-vc-seek', '.ig-vc-mute', '.ig-vc-vol', '.ig-vc-speed-btn',
      '.ig-vc-loop-in', '.ig-vc-loop-out', '.ig-vc-loop-toggle', '.ig-vc-clip', '.ig-vc-fs'
    ].map((sel) => bar.querySelector(sel));
    const loopClearBtn = bar.querySelector('.ig-vc-loop-clear');
    const loopZoomBtn = bar.querySelector('.ig-vc-loop-zoom');
    // Promoted to the bar: sharing a loop is the common action, exporting a
    // clip the rare one, so the bar slot the clip button held is now the link.
    const loopLinkBtn = bar.querySelector('.ig-vc-loop-link');
    const hintEl = bar.querySelector('.ig-vc-hint');
    const loopSpeedOpts = bar.querySelectorAll('.ig-vc-loop-speed');
    const handleA = bar.querySelector('.ig-vc-handle-a');
    const handleB = bar.querySelector('.ig-vc-handle-b');
    const seekTrack = seekEl.querySelector('.ig-vc-track');
    // Only the general speed options, which are the ones carrying data-speed.
    // Matching every .ig-vc-opt also caught the loop popup's buttons -- A, B,
    // clr, link, fit and the loop speeds -- so clicking any of them ran
    // saveSettings({ playbackRate: Number(undefined) }) and persisted NaN,
    // silently resetting the user's chosen speed to 1x.
    const speedOpts = bar.querySelectorAll('.ig-vc-opt[data-speed]');

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


    // Held-key scrubbing state. Forward motion plays the video slowly; backward
    // motion steps on a timed schedule, because no browser implements reverse
    // playback. While scrubbing, sync() must not fight the rate and mute we set.
    let scrubbing = false;
    let scrubDirection = 0;
    let scrubRate = SCRUB_RATE_NORMAL;
    let scrubRafHandle = null;
    let scrubLastTick = 0;
    let scrubAccumulator = 0;
    let preScrubRate = 1;

    // Keyboard navigation is silent. Stepping and jog scrubbing both move the
    // video in ways that make audio useless or unpleasant (a half-speed
    // soundtrack, or a frame's worth of a sample), so the first keyboard move
    // mutes and it stays muted until playback is deliberately resumed.
    let keyboardMuted = false;
    let preKeyboardMuted = false;

    const enterKeyboardSilence = () => {
      if (!keyboardMuted) {
        keyboardMuted = true;
        preKeyboardMuted = video.muted;
      }
      // Re-asserted on every keyboard move, not just the first. The host site or
      // the user can unmute in between, and a jog scrub that then plays with the
      // sound on is exactly what this exists to prevent.
      video.muted = true;
    };

    // Restoring on an actual play covers every way playback can resume: Space,
    // our own play button, and the host site's.
    const exitKeyboardSilence = () => {
      if (!keyboardMuted) return;
      keyboardMuted = false;
      video.muted = preKeyboardMuted;
    };

    // A-B loop. Markers are held in seconds and snapped to frame centres when
    // set, so they line up with the frame-stepping grid and can be nudged by
    // stepping to the right frame and setting the marker again.
    let loopIn = null;
    let loopOut = null;
    let looping = false;
    let loopRafHandle = null;
    let zoomDisabled = false;
    let preLoopRate = null;
    let linkFeedbackTimer = null;
    let urlWriteTimer = null;

    // Reflects the current loop in the address bar, so the page can be
    // bookmarked or copied from the browser rather than only through the link
    // button. Debounced because dragging a handle changes the loop on every
    // pointer move, and replaceState is not free.
    //
    // replaceState rather than assigning location.hash: assigning would push a
    // history entry per edit and bury the back button under dozens of them.
    // history.state is passed through untouched so neither site's router loses
    // the state it put there.
    //
    // Facebook rewrites its own address bar and may strip this again; that is
    // its prerogative and the link button remains the reliable route. On
    // Instagram the fragment persists.
    const writeLoopToUrl = () => {
      clearTimeout(urlWriteTimer);
      urlWriteTimer = setTimeout(() => {
        urlWriteTimer = null;
        try {
          const range = loopRange();
          const href = location.href;
          const next = range
            ? core.formatLoopUrl(href, range.start, range.end, settings.loopRate)
            : href.split('#')[0];
          if (!next || next === href) return;
          history.replaceState(history.state, '', next);
        } catch (e) {
          // A site may forbid history access, or the URL may be rejected. The
          // loop still works; only its reflection in the address bar is lost.
        }
      }, URL_WRITE_DEBOUNCE_MS);
    };

    // Clip export state.
    let clipState = 'idle'; // idle | recording | unsupported | error
    let clipProgress = 0;
    let clipPercentShown = -1;
    let clipRecorder = null;
    let clipStream = null;
    let clipRafHandle = null;
    let clipCancelled = false;

    const loopRange = () => core.normalizeLoop({
      start: loopIn,
      end: loopOut,
      duration: video.duration,
      fps: frameClock.fps,
      minFrames: LOOP_MIN_FRAMES
    });

    // The window the seek bar currently represents. Held as state rather than
    // derived fresh each time, so nudging a marker does not rescale the bar.
    let timelineView = null;
    // Frozen for the duration of a drag. Without this, moving a marker changes
    // the window, which changes the pointer-to-time mapping mid-drag, which
    // makes the handle jump away from the pointer: a feedback loop that reads as
    // the bar resetting and skipping around. The window is re-evaluated once on
    // release instead.
    let frozenView = null;

    const currentView = () => {
      if (frozenView) return frozenView;
      timelineView = core.nextTimelineView({
        current: timelineView,
        loopIn,
        loopOut,
        duration: video.duration,
        barWidthPx: seekTrack.getBoundingClientRect().width,
        minGapPx: ZOOM_MIN_GAP_PX,
        minFraction: ZOOM_MIN_FRACTION,
        maxFraction: ZOOM_MAX_FRACTION,
        targetFraction: ZOOM_TARGET_FRACTION,
        minWindowSeconds: ZOOM_MIN_WINDOW_SECONDS,
        endGuardSeconds: ZOOM_END_GUARD_SECONDS,
        endPaddingPx: ZOOM_END_PADDING_PX,
        disabled: zoomDisabled
      });
      return timelineView;
    };

    const freezeView = () => {
      frozenView = currentView();
    };

    const thawView = () => {
      frozenView = null;
    };

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
      // While scrubbing or looping, the rate and mute belong to that motion; the
      // saved preferences would cancel it instantly.
      if (!augmenting && !scrubbing && !looping) {
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


      const range = loopRange();
      loopInBtn.classList.toggle('active', loopIn !== null);
      loopOutBtn.classList.toggle('active', loopOut !== null);
      loopInBtn.title = loopIn === null
        ? 'Set loop start at the current frame  [ '
        : `Loop start ${formatTime(loopIn, 2)} — press [ again to move it`;
      loopOutBtn.title = loopOut === null
        ? 'Set loop end at the current frame  ] '
        : `Loop end ${formatTime(loopOut, 2)} — press ] again to move it`;
      loopToggleBtn.innerHTML = ICONS.loop;
      loopToggleBtn.classList.toggle('active', looping);
      loopToggleBtn.classList.toggle('unavailable', !range);
      loopToggleBtn.title = range
        ? (looping
          ? `Looping at ${Number(core.clampPlaybackRate(settings.loopRate, 1))}x — click to stop  \\`
          : `Loop ${formatTime(range.start)}–${formatTime(range.end)} at ${Number(core.clampPlaybackRate(settings.loopRate, 1))}x  \\`)
        : 'Set both A and B to enable looping';
      loopRestartBtn.innerHTML = ICONS.restart;
      loopRestartBtn.classList.toggle('unavailable', loopIn === null);
      loopRestartBtn.title = loopIn === null
        ? 'Set A first, then this jumps back to it'
        : `Jump back to ${formatTime(loopIn, 2)}  Home`;

      const view = currentView();
      loopZoomBtn.textContent = view.zoomed ? 'full' : 'fit';
      loopZoomBtn.classList.toggle('active', zoomDisabled);
      loopZoomBtn.title = view.zoomed
        ? `Timeline zoomed to ${formatTime(view.start)}–${formatTime(view.end)} — show the whole video instead`
        : 'Zoom the timeline around a tight loop so the markers are easier to aim at';

      const loopRate = core.clampPlaybackRate(settings.loopRate, 1);
      for (const opt of loopSpeedOpts) {
        opt.classList.toggle('active', Math.abs(Number(opt.dataset.loopSpeed) - loopRate) < 0.001);
        // With no loop to apply to, the menu is only a preference for later.
        // Saying so beats an "active" highlight on a control that cannot act.
        opt.classList.toggle('unavailable', !range);
        opt.title = range
          ? `Play the loop at ${opt.dataset.loopSpeed}x`
          : `Set A and B first — this will be the loop speed (${opt.dataset.loopSpeed}x)`;
      }

      // A loop link only exists once a segment is marked, so the bar button is
      // hidden rather than shown disabled when there is nothing to share. The
      // feedback timer owns the label while it is reporting ok/err.
      if (linkFeedbackTimer === null) {
        loopLinkBtn.innerHTML = ICONS.link;
        loopLinkBtn.classList.remove('ig-vc-clip-text');
        loopLinkBtn.title = 'Copy a link to this video that opens at this loop';
      }
      loopLinkBtn.classList.toggle('ig-vc-hidden', !range);

      // Clip export moved into the loop menu: it is a rare action and it costs
      // a bar slot the loop link uses far more often.
      if (clipState === 'recording') {
        clipBtn.textContent = clipProgress > 0 ? `${Math.round(clipProgress * 100)}%` : 'rec';
      } else {
        clipBtn.textContent = 'clip';
      }
      clipBtn.classList.toggle('active', clipState === 'recording');
      clipBtn.classList.toggle('unavailable',
        !range || clipState === 'unsupported' || clipState === 'error');
      clipBtn.title = range ? (CLIP_TITLES[clipState] || CLIP_TITLES.idle) : CLIP_TITLES.unavailable;

      fsBtn.innerHTML = document.fullscreenElement?.contains(video) ? ICONS.minimize : ICONS.maximize;
      fsBtn.title = document.fullscreenElement?.contains(video)
        ? 'Leave fullscreen  ·  right-click or  t  for theater mode'
        : 'Fullscreen  ·  right-click or  t  for theater mode, which covers the page but keeps the browser visible';
    }

    const renderTime = (t) => (frameMode
      ? `${formatTime(t, 2)} · f${Math.floor(t * frameClock.fps + 1e-6)}`
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

    // Marker positions and visibility, split out so a trim drag can repaint them
    // at pointer rate without the cost of a full sync() on every move.
    const paintLoopMarks = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const view = currentView();
      seekEl.style.setProperty('--la', `${(core.timeToViewRatio(loopIn ?? 0, view) * 100).toFixed(2)}%`);
      seekEl.style.setProperty('--lb', `${(core.timeToViewRatio(loopOut ?? 0, view) * 100).toFixed(2)}%`);
      seekEl.classList.toggle('has-a', loopIn !== null);
      seekEl.classList.toggle('has-b', loopOut !== null);
      seekEl.classList.toggle('has-loop', Boolean(loopRange()));
      seekEl.classList.toggle('zoomed', view.zoomed);
      seekEl.title = view.zoomed
        ? `Timeline zoomed to ${formatTime(view.start)}–${formatTime(view.end)} for marker precision`
        : '';
    };

    const updateTime = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const view = currentView();
      seekEl.style.setProperty('--b', `${(core.timeToViewRatio(bufferedEndNear(video.currentTime), view) * 100).toFixed(1)}%`);
      paintLoopMarks();
      // Mid-drag the pointer owns the fill and the readout, so leave both alone;
      // overwriting them here would snap the bar back to the lagging decoder.
      if (dragTargetTime !== null) return;
      if (!isSeeking()) seekEl.style.setProperty('--v', `${(core.timeToViewRatio(video.currentTime, view) * 100).toFixed(1)}%`);
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
          // Through the view window, so dragging is fine-grained while zoomed.
          dragTargetTime = core.viewRatioToTime(ratio, currentView());
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
        freezeView();
        showHint('playhead');
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
        thawView();
        showHint(null);
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
      clearTimeout(linkFeedbackTimer);
      linkFeedbackTimer = null;
      clearTimeout(urlWriteTimer);
      urlWriteTimer = null;
      stopClipRecording();
      clipState = 'idle';
      stopLoopWatcher();
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
      enterKeyboardSilence();
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

    // Restarting is paced like any other seek, so a tight loop cannot thrash the
    // decoder by issuing a new seek before the last one landed.
    // Trim handles. Dragging one moves that marker and previews the video at the
    // new position, which is how a clip trimmer behaves: you see the frame you
    // are trimming to. Previews go through the same paced seek path as any other
    // drag, so a fast drag cannot thrash the decoder.
    let trimDrag = null;

    const moveTrim = (clientX) => {
      if (!trimDrag || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const rect = seekTrack.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      // Snapped to a frame centre so a marker always sits on the arrow keys' grid.
      // Read through the view window, which is what makes a tight loop editable.
      const snapped = core.frameCenter(
        core.frameIndexAt(core.viewRatioToTime(ratio, currentView()), frameClock.fps),
        frameClock.fps
      );
      const clamped = core.clampMarker({
        value: snapped,
        other: trimDrag === 'in' ? loopOut : loopIn,
        which: trimDrag,
        duration: video.duration,
        fps: frameClock.fps,
        minFrames: LOOP_MIN_FRAMES
      });
      if (clamped === null) return;
      if (trimDrag === 'in') loopIn = clamped;
      else loopOut = clamped;
      dragTargetTime = clamped;
      dragDirty = true;
      timeEl.textContent = renderTime(clamped);
      // Both marker times must track the drag, not show where they started.
      refreshHint();
      paintLoopMarks();
      flushDragSeek();
    };

    const bindTrimHandle = (handle, which) => {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Stop the press reaching the seek bar underneath, which would otherwise
        // start a playhead scrub at the same time.
        e.stopPropagation();
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        trimDrag = which;
        wasPlaying = !video.paused;
        if (wasPlaying) requestPause();
        pendingDelta = 0;
        intendedFrame = null;
        freezeView();
        showHint(which);
        revealBar(true);
        moveTrim(e.clientX);
      });
      handle.addEventListener('pointermove', (e) => {
        if (trimDrag !== which || !handle.hasPointerCapture(e.pointerId)) return;
        moveTrim(e.clientX);
      });
      for (const evt of ['pointerup', 'pointercancel']) {
        handle.addEventListener(evt, (e) => {
          if (trimDrag !== which || !handle.hasPointerCapture(e.pointerId)) return;
          handle.releasePointerCapture(e.pointerId);
          trimDrag = null;
          dragTargetTime = null;
          dragDirty = false;
          thawView();
          showHint(null);
          // Trimming while looping should resume inside the new range, not from
          // wherever the handle was dropped.
          if (wasPlaying) requestPlay();
          sync();
          updateTime();
          writeLoopToUrl();
        });
      }
    };

    bindTrimHandle(handleA, 'in');
    bindTrimHandle(handleB, 'out');

    // The hotkey hint shown while dragging, so the marker shortcuts are
    // discoverable at the moment they are useful rather than only in the README.
    let hintMode = null;

    // Both marker times, always both, so the relationship between them is
    // visible while either is moving and a lone marker still shows where it is.
    const renderMarkers = () => {
      const a = loopIn === null ? '—' : formatTime(loopIn, 2);
      const b = loopOut === null ? '—' : formatTime(loopOut, 2);
      const span = loopIn !== null && loopOut !== null
        ? `  (${(loopOut - loopIn).toFixed(2)}s)`
        : '';
      return `A ${a}   B ${b}${span}`;
    };

    const showHint = (mode) => {
      hintMode = mode;
      const lines = [];
      // Marker times lead, since they are what the eye needs while trimming.
      if (loopIn !== null || loopOut !== null) lines.push(renderMarkers());
      if (mode === 'in') lines.push('moving A');
      else if (mode === 'out') lines.push('moving B');
      else if (mode === 'playhead') {
        if (loopIn === null) lines.push('press  [  to set A here');
        else if (loopOut === null) lines.push('press  ]  to set B here');
        else lines.push('press  [  or  ]  to move A or B here');
      }
      hintEl.textContent = lines.join('\n');
      hintEl.classList.toggle('visible', lines.length > 0);
    };

    // Setting a marker mid-drag changes both the times shown and which hotkey is
    // useful next, so the hint is re-rendered rather than left stale.
    const refreshHint = () => showHint(hintMode);

    // While dragging, a marker belongs at the pointer, not at the video's
    // position: paced seeking means currentTime lags behind the pointer, so
    // reading it would place the marker a few frames off where it looks.
    const markerTimeNow = () => core.frameCenter(
      core.frameIndexAt(dragTargetTime ?? video.currentTime, frameClock.fps),
      frameClock.fps
    );

    // Applies a loop carried in the launch URL, once, to the first player that
    // can take it. Clamped to the media, since a shared link may name times past
    // the end of a different or re-encoded video.
    const applyUrlLoop = () => {
      if (!pendingUrlLoop) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const wanted = pendingUrlLoop;
      pendingUrlLoop = null;
      const fps = frameClock.fps;
      const snap = (t) => core.frameCenter(
        core.clampFrame(core.frameIndexAt(Math.min(t, video.duration), fps), core.lastFrameIndexFor(video.duration, fps)),
        fps
      );
      loopIn = snap(wanted.start);
      loopOut = snap(wanted.end);
      if (Number.isFinite(wanted.rate)) saveSettings({ loopRate: core.clampPlaybackRate(wanted.rate, 1) });
      if (loopRange()) {
        looping = true;
        startLoopWatcher();
        // A shared loop link is an invitation to watch that passage, so open on
        // it. Without this the video sat wherever the site had left it, and the
        // loop only engaged once playback happened to wander into range.
        intendedFrame = null;
        pendingDelta = 0;
        beginSeek(loopIn);
      } else {
        loopIn = null;
        loopOut = null;
      }
      revealBar(true);
      refreshHint();
      sync();
      updateTime();
    };

    // Records the marked loop and saves it. Real time by necessity: both sites
    // stream through MediaSource, so there is no file to slice and the only
    // source is the element's rendered output. Recorded at 1x regardless of the
    // practice speed, so the clip is the move as filmed; any player can slow it.
    const stopClipRecording = () => {
      if (clipRafHandle !== null) {
        cancelAnimationFrame(clipRafHandle);
        clipRafHandle = null;
      }
      if (clipRecorder && clipRecorder.state !== 'inactive') {
        try { clipRecorder.stop(); } catch (e) {}
      }
      if (clipStream) {
        for (const track of clipStream.getTracks()) track.stop();
        clipStream = null;
      }
    };

    const recordClip = async () => {
      if (clipState === 'recording') {
        clipCancelled = true;
        stopClipRecording();
        return;
      }
      const range = loopRange();
      if (!range) return;
      if (typeof video.captureStream !== 'function' || typeof window.MediaRecorder !== 'function') {
        clipState = 'unsupported';
        sync();
        return;
      }
      const mimeType = core.pickRecorderMime(CLIP_MIME_CANDIDATES, (m) => window.MediaRecorder.isTypeSupported(m));
      if (!mimeType) {
        clipState = 'unsupported';
        sync();
        return;
      }

      // The recording borrows playback, so remember what to give back.
      const priorRate = video.playbackRate;
      const priorMuted = video.muted;
      const priorLooping = looping;
      const priorPaused = video.paused;
      looping = false;
      stopLoopWatcher();

      clipCancelled = false;
      clipState = 'recording';
      clipProgress = 0;
      clipPercentShown = -1;
      revealBar(true);
      sync();

      const chunks = [];
      try {
        clipStream = video.captureStream();
        clipRecorder = new window.MediaRecorder(clipStream, { mimeType });
      } catch (e) {
        clipState = 'error';
        clipStream = null;
        clipRecorder = null;
        sync();
        return;
      }
      clipRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };

      const finished = new Promise((resolve) => { clipRecorder.onstop = resolve; });

      // Park at A and let the decoder settle before the recorder opens, or the
      // first frames are whatever was on screen beforehand.
      video.playbackRate = 1;
      // Unmuted so the clip carries the music, which is the point for a dance
      // move. Keyboard navigation may well have muted it.
      video.muted = false;
      intendedFrame = null;
      pendingDelta = 0;
      video.currentTime = range.start;
      await new Promise((r) => setTimeout(r, CLIP_LEAD_IN_MS));
      await video.play().catch(() => {});

      clipRecorder.start(200);
      const endAt = Math.min(range.end, range.start + CLIP_MAX_SECONDS);
      const tick = () => {
        clipRafHandle = null;
        if (clipState !== 'recording') return;
        const span = endAt - range.start;
        clipProgress = span > 0 ? Math.min(1, Math.max(0, (video.currentTime - range.start) / span)) : 0;
        const percent = Math.round(clipProgress * 100);
        if (percent !== clipPercentShown) {
          clipPercentShown = percent;
          sync();
        }
        if (video.currentTime >= endAt || video.ended) {
          stopClipRecording();
          return;
        }
        clipRafHandle = requestAnimationFrame(tick);
      };
      clipRafHandle = requestAnimationFrame(tick);

      await finished;
      video.pause();
      video.playbackRate = priorRate;
      video.muted = priorMuted;
      if (priorLooping) {
        looping = true;
        startLoopWatcher();
      }
      if (!priorPaused && !priorLooping) video.play().catch(() => {});

      clipRecorder = null;
      clipState = 'idle';
      clipProgress = 0;

      if (clipCancelled || !chunks.length) {
        sync();
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const filename = core.clipFilename(location.hostname, location.pathname, range.start, range.end);
      const url = URL.createObjectURL(blob);
      downloadUrl(url, filename);
      // Then show it, so the move can be studied immediately. The overlay owns
      // the blob URL from here and revokes it when dismissed.
      openTheater({
        src: url,
        revokeUrl: url,
        filename,
        label: `${filename}  ·  ${formatTime(range.end - range.start, 2)}  ·  ${(blob.size / 1048576).toFixed(1)} MB`
      });
      sync();
    };

    // Theater mode: a page overlay showing only the video, leaving the browser's
    // own chrome in place. Reached with `t` or by right-clicking fullscreen.
    const openVideoTheater = () => {
      // Adopt the player container so the video and our own bar move together,
      // keeping the loop controls usable in theater mode. Pointing a second
      // <video> at the page's blob URL would load nothing, since a MediaSource
      // URL can only ever be attached to one element.
      const container = currentContainer || resolvePlayerContainer(video);
      if (!container) return false;
      openTheater({ adopt: container, label: 'theater mode  ·  Esc or click outside to close' });
      return true;
    };

    const loopTick = () => {
      loopRafHandle = null;
      if (!looping) return;
      const range = loopRange();
      if (range && !seekBlocked()
          && core.loopShouldRestart({ currentTime: video.currentTime, loopEnd: range.end, paused: video.paused })) {
        intendedFrame = null;
        pendingDelta = 0;
        beginSeek(range.start);
      }
      loopRafHandle = requestAnimationFrame(loopTick);
    };

    const startLoopWatcher = () => {
      // A practice loop plays at its own rate, borrowed from whatever was in
      // effect and handed back when looping stops.
      if (preLoopRate === null) preLoopRate = video.playbackRate;
      video.playbackRate = core.clampPlaybackRate(settings.loopRate, 1);
      if (loopRafHandle === null) loopRafHandle = requestAnimationFrame(loopTick);
    };

    const stopLoopWatcher = () => {
      if (loopRafHandle !== null) {
        cancelAnimationFrame(loopRafHandle);
        loopRafHandle = null;
      }
      if (preLoopRate !== null) {
        // In augment mode the host site owns playback speed, so the only correct
        // thing to restore is whatever was actually in effect beforehand.
        const restore = augmenting ? preLoopRate : (Number(settings.playbackRate) || 1);
        preLoopRate = null;
        video.playbackRate = core.clampPlaybackRate(restore, 1);
      }
    };

    // Markers snap to the current frame's centre so they sit on the same grid the
    // arrow keys step along. Set either one at any time, in any order, while
    // playing or paused — refine by stepping to the frame you want and setting
    // it again.
    const setLoopIn = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
      loopIn = markerTimeNow();
      if (loopOut !== null && loopOut <= loopIn) loopOut = null;
      revealBar(true);
      refreshHint();
      sync();
      writeLoopToUrl();
      return true;
    };

    const setLoopOut = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
      loopOut = markerTimeNow();
      if (loopIn !== null && loopIn >= loopOut) loopIn = null;
      // Marking the end of a move is the natural moment to start practising it.
      if (loopIn !== null && loopRange()) {
        looping = true;
        startLoopWatcher();
      }
      revealBar(true);
      refreshHint();
      sync();
      writeLoopToUrl();
      return true;
    };

    const toggleLoop = () => {
      if (!loopRange()) {
        revealBar(true);
        sync();
        return false;
      }
      looping = !looping;
      if (looping) startLoopWatcher();
      else stopLoopWatcher();
      revealBar(true);
      sync();
      return true;
    };

    const restartLoop = () => {
      if (loopIn === null || !Number.isFinite(video.duration) || video.duration <= 0) return false;
      intendedFrame = null;
      pendingDelta = 0;
      beginSeek(loopIn);
      revealBar(true);
      return true;
    };

    const clearLoop = () => {
      loopIn = null;
      loopOut = null;
      looping = false;
      stopLoopWatcher();
      revealBar(true);
      refreshHint();
      sync();
      updateTime();
      // Clearing the loop strips the fragment, so a copied URL does not carry
      // a loop the page is no longer showing.
      writeLoopToUrl();
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
      preScrubRate = video.playbackRate;
      revealBar(true);
      if (direction > 0) {
        // Forward motion hands the work back to the decoder's normal playback
        // path. No seeking at all, frames presented on schedule: the only way to
        // get genuinely smooth output. Audio at a scrub rate is just noise.
        enterKeyboardSilence();
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
      // Mute is deliberately NOT restored here — keyboard navigation stays
      // silent until playback is actually resumed.
      video.playbackRate = augmenting ? preScrubRate : (Number(settings.playbackRate) || 1);
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



    playBtn.addEventListener('click', () => (video.paused ? requestPlay() : requestPause()));
    muteBtn.addEventListener('click', () => {
      const muted = !settings.muted;
      saveSettings({ volume: !muted && settings.volume === 0 ? 0.5 : settings.volume, muted });
      video.muted = muted;
    });
    for (const opt of speedOpts) opt.addEventListener('click', () => saveSettings({ playbackRate: Number(opt.dataset.speed) }));
    speedBtn.addEventListener('contextmenu', () => saveSettings({ playbackRate: 1 }));
    loopInBtn.addEventListener('click', setLoopIn);
    loopOutBtn.addEventListener('click', setLoopOut);
    loopToggleBtn.addEventListener('click', toggleLoop);
    loopToggleBtn.addEventListener('contextmenu', clearLoop);
    for (const opt of loopSpeedOpts) {
      opt.addEventListener('click', () => {
        const rate = core.clampPlaybackRate(opt.dataset.loopSpeed, 1);
        saveSettings({ loopRate: rate });
        // Picking a practice speed is a request to hear the loop at that speed
        // now. With a loop marked but the toggle off, this used to light the
        // button and change nothing, so the control looked broken: it claimed
        // an effect it had not had. Engage the loop instead.
        if (loopRange()) {
          if (!looping) {
            looping = true;
            startLoopWatcher();
          }
          video.playbackRate = rate;
        }
        revealBar(true);
        sync();
        writeLoopToUrl();
      });
    }
    clipBtn.addEventListener('click', recordClip);
    // Theater mode on the fullscreen button's right-click: a page overlay that
    // shows only the video while leaving the browser's tabs and address bar in
    // place, unlike real fullscreen on the left-click.
    // Theater mode is the default for this button: it covers the page but leaves
    // the browser's tabs and address bar visible. Real fullscreen lives inside
    // the overlay, where a click is a fresh gesture requestFullscreen accepts.
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }
      openVideoTheater();
    });
    fsBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openVideoTheater();
    });
    loopLinkBtn.addEventListener('click', async () => {
      const range = loopRange();
      if (!range) {
        revealBar(true);
        sync();
        return;
      }
      const url = core.formatLoopUrl(location.href, range.start, range.end, settings.loopRate);
      if (!url) return;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (e) {
        // The async clipboard API needs a trusted gesture and a focused
        // document, and refuses otherwise. Fall back to the older selection
        // route, which succeeds in some of those cases.
        try {
          const scratch = document.createElement('textarea');
          scratch.value = url;
          scratch.setAttribute('readonly', '');
          scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
          document.body.appendChild(scratch);
          scratch.select();
          copied = document.execCommand('copy');
          scratch.remove();
        } catch (err) {
          // Both routes refused; the URL is still offered in the tooltip so the
          // loop is not lost.
        }
      }
      loopLinkBtn.textContent = copied ? 'ok' : 'err';
      // The bar button is a 22px icon slot, so short feedback text needs the
      // same widened treatment the clip progress label used.
      loopLinkBtn.classList.add('ig-vc-clip-text');
      loopLinkBtn.title = copied ? `Copied ${url}` : `Could not reach the clipboard. The link is: ${url}`;
      clearTimeout(linkFeedbackTimer);
      linkFeedbackTimer = setTimeout(() => {
        linkFeedbackTimer = null;
        sync();
      }, 1600);
      revealBar(true);
    });
    loopClearBtn.addEventListener('click', clearLoop);
    loopZoomBtn.addEventListener('click', () => {
      zoomDisabled = !zoomDisabled;
      revealBar(true);
      sync();
      updateTime();
    });
    loopRestartBtn.addEventListener('click', restartLoop);

    for (const evt of ['play', 'playing', 'pause', 'volumechange', 'ratechange']) {
      video.addEventListener(evt, sync, { signal });
    }
    // Any genuine resume ends keyboard silence. The scrub's own play() is
    // excluded, since that motion is exactly what should stay quiet.
    for (const evt of ['play', 'playing']) {
      video.addEventListener(evt, () => {
        if (!scrubbing) exitKeyboardSilence();
      }, { signal });
    }
    video.addEventListener('loadedmetadata', () => {
      frameClock.reset();
      intendedFrame = null;
      pendingDelta = 0;
      seekInFlight = false;
      dragTargetTime = null;
      dragDirty = false;
      preloadNudged = false;
      // Loop markers belong to the video that was playing, not to a recycled
      // element showing something else.
      loopIn = null;
      loopOut = null;
      looping = false;
      stopLoopWatcher();
      keyboardMuted = false;
      mount();
      sync();
      updateTime();
      applyUrlLoop();
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
    applyUrlLoop();

    controllers.set(video, {
      mount, sync, destroy, stepFrames, togglePlay, beginScrub, endScrub,
      setLoopIn, setLoopOut, toggleLoop, restartLoop, clearLoop,
      openTheater: openVideoTheater,
      container: () => currentContainer
    });
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
    const loopIn = KEYS_LOOP_IN.has(e.key);
    const loopOut = KEYS_LOOP_OUT.has(e.key);
    const loopToggle = KEYS_LOOP_TOGGLE.has(e.key);
    const loopRestart = KEYS_LOOP_RESTART.has(e.key);
    const loopClear = KEYS_LOOP_CLEAR.has(e.key);
    const theater = KEYS_THEATER.has(e.key);
    const isLoopKey = loopIn || loopOut || loopToggle || loopRestart || loopClear;
    if (!space && !back && !forward && !isLoopKey && !theater) return;
    if (isTypingContext(e.target) || isTypingContext(document.activeElement)) return;
    const video = resolveActiveVideo();
    const ctrl = controllers.get(video);
    if (!ctrl) return;

    if (theater) {
      if (!e.repeat) ctrl.openTheater();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (space) {
      stopHold();
      ctrl.togglePlay();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Loop keys act once per press; holding one repeats harmlessly but is not
    // motion, so repeats are simply swallowed along with the key.
    if (isLoopKey) {
      if (!e.repeat) {
        if (loopIn) ctrl.setLoopIn();
        else if (loopOut) ctrl.setLoopOut();
        else if (loopToggle) ctrl.toggleLoop();
        else if (loopRestart) ctrl.restartLoop();
        else ctrl.clearLoop();
      }
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
