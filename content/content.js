(() => {
  'use strict';

  window.__igVcCleanup?.();
  for (const el of document.querySelectorAll('.ig-vc-bar')) el.remove();
  for (const el of document.querySelectorAll('.ig-vc-player')) el.classList.remove('ig-vc-player');
  for (const el of document.querySelectorAll('.ig-vc-host')) el.classList.remove('ig-vc-host');
  for (const el of document.querySelectorAll('.ig-vc-series-overlay')) el.classList.remove('ig-vc-series-overlay');

  const DEFAULT_SETTINGS = { volume: 1, muted: false, playbackRate: 1 };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
    minimize: svg(`<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>`)
  };

  let settings = { ...DEFAULT_SETTINGS };
  const controllers = new Map();

  const formatTime = (s) => {
    if (!Number.isFinite(s) || s <= 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  async function saveSettings(partial) {
    settings = { ...settings, ...partial };
    for (const ctrl of controllers.values()) ctrl.sync();
    try { await chrome.storage.local.set(partial); } catch (e) {}
  }

  function hasNativeControls(video) {
    const root = video.closest('article, [role="dialog"], [role="presentation"]') || video.parentElement;
    return Boolean(root?.querySelector('[aria-label="Video progress"], [role="slider"][aria-label="Video progress"], [aria-label="Enter fullscreen"], [aria-label="Exit fullscreen"]'));
  }

  function findPlayerContainer(video) {
    let cur = video.parentElement;
    let best = cur;
    for (let i = 0; i < 14 && cur && cur !== document.body; i++) {
      if (cur.querySelectorAll('video').length > 1) break;
      best = cur;
      if (cur.querySelector('[data-instancekey], [role="group"][aria-label="Video player"]')) break;
      cur = cur.parentElement;
    }
    if (best && getComputedStyle(best).position === 'static') best.style.position = 'relative';
    return best;
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
    bar.className = 'ig-vc-bar';
    bar.innerHTML = `
      <button type="button" class="ig-vc-btn ig-vc-play"></button>
      <span class="ig-vc-time">0:00 / 0:00</span>
      <div class="ig-vc-seek"><div class="ig-vc-track"><div class="ig-vc-fill"></div></div></div>
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
      <button type="button" class="ig-vc-btn ig-vc-fs"></button>
    `;

    const [playBtn, timeEl, seekEl, muteBtn, volEl, speedBtn, fsBtn] = [
      '.ig-vc-play', '.ig-vc-time', '.ig-vc-seek', '.ig-vc-mute', '.ig-vc-vol', '.ig-vc-speed-btn', '.ig-vc-fs'
    ].map((sel) => bar.querySelector(sel));
    const speedOpts = bar.querySelectorAll('.ig-vc-opt');

    for (const evt of ['click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dragstart']) {
      bar.addEventListener(evt, (e) => { e.stopPropagation(); e.preventDefault(); });
    }

    function sync() {
      video.controls = false;
      const vol = Math.min(1, Math.max(0, Number(settings.volume) ?? 1));
      if (Math.abs(video.volume - vol) > 0.005) video.volume = vol;
      if (!video.paused && video.muted !== Boolean(settings.muted)) video.muted = Boolean(settings.muted);
      const rate = Number(settings.playbackRate) || 1;
      if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;

      playBtn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
      const effVol = settings.muted ? 0 : vol;
      volEl.style.setProperty('--v', `${(effVol * 100).toFixed(1)}%`);
      muteBtn.innerHTML = effVol === 0 ? ICONS.volumeX : effVol < 0.25 ? ICONS.volume : effVol < 0.65 ? ICONS.volume1 : ICONS.volume2;

      speedBtn.textContent = `${Number(rate.toFixed(2))}x`;
      for (const opt of speedOpts) opt.classList.toggle('active', Math.abs(Number(opt.dataset.speed) - rate) < 0.01);
      fsBtn.innerHTML = document.fullscreenElement?.contains(video) ? ICONS.minimize : ICONS.maximize;
    }

    const updateTime = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        if (!isSeeking()) seekEl.style.setProperty('--v', `${((video.currentTime / video.duration) * 100).toFixed(1)}%`);
        timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
      }
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
        seekEl.style.setProperty('--v', `${(ratio * 100).toFixed(1)}%`);
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = ratio * video.duration;
          timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
        }
      },
      () => {
        wasPlaying = !video.paused;
        if (wasPlaying) requestPause();
      },
      () => {
        if (wasPlaying) requestPlay();
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
      if (hasNativeControls(video)) {
        destroy();
        controllers.delete(video);
        return;
      }
      const container = video.isConnected && findPlayerContainer(video);
      if (container) {
        if (currentContainer && currentContainer !== container) {
          currentContainer.classList.remove('ig-vc-player');
        }
        currentContainer = container;
        if (bar.parentElement !== container) {
          container.classList.add('ig-vc-player');
          container.appendChild(bar);
        }
        const series = findSeriesOverlay(container);
        if (series?.host !== currentHost || series?.overlay !== currentSeriesOverlay) {
          clearSeriesOverlay();
          if (series) {
            currentHost = series.host;
            currentSeriesOverlay = series.overlay;
            currentHost.classList.add('ig-vc-host');
            currentSeriesOverlay.classList.add('ig-vc-series-overlay');
          }
        }
      }
    };

    const destroy = () => {
      ro.disconnect();
      ac.abort();
      bar.remove();
      clearSeriesOverlay();
      const container = currentContainer || (video.isConnected && findPlayerContainer(video));
      container?.classList.remove('ig-vc-player');
      currentContainer = null;
    };

    playBtn.addEventListener('click', () => (video.paused ? requestPlay() : requestPause()));
    muteBtn.addEventListener('click', () => {
      const muted = !settings.muted;
      saveSettings({ volume: !muted && settings.volume === 0 ? 0.5 : settings.volume, muted });
      video.muted = muted;
    });
    for (const opt of speedOpts) opt.addEventListener('click', () => saveSettings({ playbackRate: Number(opt.dataset.speed) }));
    speedBtn.addEventListener('contextmenu', () => saveSettings({ playbackRate: 1 }));
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else (findPlayerContainer(video) || video).requestFullscreen().catch(() => {});
    });

    for (const evt of ['play', 'playing', 'pause', 'volumechange', 'ratechange']) {
      video.addEventListener(evt, sync, { signal });
    }
    video.addEventListener('loadedmetadata', () => { mount(); sync(); updateTime(); }, { signal });
    video.addEventListener('timeupdate', updateTime, { signal });

    const ro = new ResizeObserver(mount);
    ro.observe(video);
    mount();
    sync();
    updateTime();

    controllers.set(video, { mount, sync, destroy });
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
  const stopVis = (e) => e.stopImmediatePropagation();
  document.addEventListener('visibilitychange', stopVis, true);
  window.addEventListener('pointermove', onFsMove, { passive: true });
  window.addEventListener('click', onFsClick, true);
  document.addEventListener('fullscreenchange', onFsSync);

  function scanVideos() {
    if (location.pathname.startsWith('/stories/')) {
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
    document.removeEventListener('fullscreenchange', onFsSync);
    observer.disconnect();
    for (const ctrl of controllers.values()) ctrl.destroy();
    controllers.clear();
  };

  (async () => {
    try { settings = { ...DEFAULT_SETTINGS, ...(await chrome.storage.local.get(DEFAULT_SETTINGS)) }; } catch (e) {}
    scanVideos();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
