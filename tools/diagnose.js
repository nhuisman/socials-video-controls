// Paste this whole file into Safari's Web Inspector console on the page where
// the bug happens, then reproduce the bug. It prints a running log of what the
// video element actually does, which is the thing no Chromium-based test here
// can observe.
//
//   Mac Safari:  Develop > Show Web Inspector > Console
//   iPhone:      Settings > Safari > Advanced > Web Inspector, then connect by
//                cable and use Develop > <device> on the Mac
//
// It records for 30 seconds. Reproduce the bug during that window, then copy
// everything it printed and send it back. It only reads state and listens for
// events; it never changes playback.

(() => {
  const video = document.querySelector('video');
  if (!video) return console.log('IGVC-DIAG: no <video> on this page');

  const bar = document.querySelector('.ig-vc-player .ig-vc-bar') || document.querySelector('.ig-vc-bar');
  const t0 = performance.now();
  const at = () => `+${((performance.now() - t0) / 1000).toFixed(2)}s`;

  const snapshot = () => {
    const loopToggle = bar && bar.querySelector('.ig-vc-loop-toggle');
    const seek = bar && bar.querySelector('.ig-vc-seek');
    return {
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      t: Number(video.currentTime.toFixed(3)),
      rate: video.playbackRate,
      muted: video.muted,
      readyState: video.readyState,
      // What the bar believes, which is how we tell a UI problem from a media one.
      looping: loopToggle ? loopToggle.classList.contains('active') : null,
      fill: seek ? seek.style.getPropertyValue('--v') : null,
      readout: bar ? bar.querySelector('.ig-vc-time').textContent : null
    };
  };

  console.log('IGVC-DIAG version:', (() => {
    // The bundle stamps no version into the page, so report what is loaded by
    // feature instead: these tell us which build is running.
    const has = (s) => Boolean(bar && bar.querySelector(s));
    return {
      touchMode: document.documentElement.classList.contains('ig-vc-touch'),
      noClip: document.documentElement.classList.contains('ig-vc-no-clip'),
      hasStepButtons: has('.ig-vc-step-fwd'),
      hasLoopOnOff: has('.ig-vc-loop-onoff'),
      hasLoopLinkOnBar: has('.ig-vc-loop-link'),
      // Gone in 1.19.0; if true you are on an older build.
      hasLoopSpeedMenu: has('.ig-vc-loop-speed'),
      fastSeekExists: typeof video.fastSeek === 'function'
    };
  })());
  console.log('IGVC-DIAG start:', snapshot());

  // Every media event that could explain a dead play button, with the state at
  // the moment it fired.
  const events = ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting',
    'stalled', 'ratechange', 'volumechange', 'ended', 'emptied', 'timeupdate'];
  let timeupdates = 0;
  const onEvent = (e) => {
    // timeupdate fires several times a second; count them and report
    // occasionally rather than flooding the log.
    if (e.type === 'timeupdate') {
      timeupdates += 1;
      if (timeupdates % 8 !== 1) return;
    }
    console.log(`IGVC-DIAG ${at()} ${e.type}`, snapshot());
  };
  for (const name of events) video.addEventListener(name, onEvent, true);

  // Anything that calls pause() or play() on the element, and where from. This
  // is what identifies whether the site, our code, or nothing at all is acting.
  const realPlay = video.play.bind(video);
  const realPause = video.pause.bind(video);
  video.play = function () {
    console.log(`IGVC-DIAG ${at()} play() called from:`, new Error().stack.split('\n').slice(1, 4).join(' | '));
    return realPlay();
  };
  video.pause = function () {
    console.log(`IGVC-DIAG ${at()} pause() called from:`, new Error().stack.split('\n').slice(1, 4).join(' | '));
    return realPause();
  };

  setTimeout(() => {
    for (const name of events) video.removeEventListener(name, onEvent, true);
    video.play = realPlay;
    video.pause = realPause;
    console.log('IGVC-DIAG end:', snapshot());
    console.log('IGVC-DIAG done. Copy everything above and send it back.');
  }, 30000);

  console.log('IGVC-DIAG recording for 30s - reproduce the bug now.');
})();
