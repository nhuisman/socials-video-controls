# Socials Video Controls

A browser extension that adds video playback controls to Instagram and frame-accurate navigation to both Instagram and Facebook: a timeline scrubber, persistent volume, playback speed, frame-by-frame stepping, smooth jog scrubbing, and optional whole-video caching.

> **Fork notice.** This project began as [Instagram Video Control](https://git.skp.my.id/surya/instagram-video-control) by Surya Kencana Putra, MIT licensed, and retains that license and copyright notice. It has since diverged substantially: frame-accurate stepping, jog scrubbing, live drag scrubbing, A-B loop practice, clip export, theater mode, a test suite, and Facebook support were added here. It is unrelated to the similarly named [Arcus92/instagram-video-control](https://github.com/Arcus92/instagram-video-control), which is an independent project.

[![Manifest](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Microsoft%20Edge%20%7C%20Chrome-0078D4?logo=microsoftedge&logoColor=white)](https://learn.microsoft.com/en-us/microsoft-edge/extensions/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0%20(Pure%20JS%2FCSS)-success)](#architecture)

<p align="center">
  <img src="screenshot-1280x800.png" alt="Socials Video Controls preview" width="720">
</p>

---

## Features

- **Seek Timeline Scrubber**: Click and drag the progress bar to scrub, with the picture updating live as you move rather than only on release.
- **Frame-by-Frame Stepping**: Press `←` and `→` to walk a video one frame at a time (hold `Shift` for 10, or hold the key to scrub continuously). The true frame rate is measured from the video itself, so steps land on real frame boundaries instead of drifting.
- **Space to Resume**: `Space` toggles play/pause on the player you are working with, so playback picks back up after stepping without reaching for the mouse.
- **Clip Export**: With a loop marked, save that segment as a video file and review it in theater mode. Recorded locally from the player's own output; nothing is uploaded.
- **Theater Mode**: Covers the page so only the video is visible, without hiding the browser's tabs and address bar. Real fullscreen is available from its menu.
- **Persistent Volume Memory**: Remembers your preferred volume level and mute state across videos, reels, and browser restarts using local storage.
- **Dynamic Speaker Icons**: Automatically updates volume icons (Muted, Low, Medium, High) based on audio levels using official Lucide vector paths.
- **Playback Speed Selector**: Instant speed controls supporting `0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`, and `2x` playback rates (right-click to quickly reset to `1x`).
- **Fullscreen Mode**: One-click native video fullscreen toggle with automated control-bar auto-hide on cursor idle.
- **Background Tab Persistence**: Prevents Instagram from automatically pausing playback when you switch browser tabs.
- **Zero Remote Code & Trackers**: 100% private and client-side. No analytics, no telemetry, no network calls, and no cookies accessed.

---

## Installation

### Developer Mode (Edge / Chrome / Brave / Opera)

1. Clone this repository:
   ```bash
   git clone https://git.skp.my.id/surya/instagram-video-control.git
   ```
2. Open the extension manager in your browser:
   - **Microsoft Edge**: Navigate to `edge://extensions`
   - **Google Chrome / Chromium**: Navigate to `chrome://extensions`
3. Toggle on **Developer mode** (top-right or bottom-left).
4. Click **Load unpacked** and select the cloned `instagram-video-control` directory.
5. Open [instagram.com](https://www.instagram.com) and start playing any video post or Reel.

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `←` / `→` tap | Step back / forward exactly one frame |
| `Shift` + tap | Step 10 frames |
| `←` / `→` hold | Smooth jog scrub at half speed |
| `Shift` + hold | Smooth jog scrub at double speed |
| `Space` | Play / pause |
| `t` | Theater mode |
| `[` | Set loop start (A) at the current frame |
| `]` | Set loop end (B) at the current frame |
| `\` | Toggle looping |
| `Home` | Jump back to A |
| `\|` | Clear both markers |

A tap and a hold do deliberately different things. A tap issues one precise seek and lands on an exact frame. Holding past a short threshold switches to continuous motion, then releasing stops it; the frame you land on is still exact, so you can tap to fine-tune straight afterwards.

**Keyboard navigation is silent.** The first keyboard move mutes the video and it stays muted until playback is deliberately resumed — with `Space`, the play button, or the host site's own. A half-speed soundtrack during a jog scrub is noise, and a single frame's worth of audio is a click. Muting is re-asserted on every keyboard move rather than only the first, since the site or you may unmute in between.

While the keyboard is in use the control bar surfaces on its own and the readout switches to a precise form showing the frame index, for example `0:04.53 / 0:12 · f136`.

### Which player the keys act on

Arrow keys move Instagram's own carousels and `Space` scrolls the feed, so these shortcuts are claimed only for a player that is **visibly engaged** — one that is in fullscreen, under the mouse pointer, or still in keyboard mode from a recent press. The rule is therefore visible rather than hidden: *the keys act on the player whose control bar is showing.* Anywhere else, Instagram's own arrow and space handling is left completely untouched.

Shortcuts are also suppressed whenever focus sits in a text field, search box, or comment composer, and keys combined with `Ctrl`, `Cmd`, or `Alt` pass straight through to the browser. `↑` and `↓` are never intercepted, so page scrolling and Reels navigation keep working.

### How frame stepping stays accurate

HTML5 video exposes no frame rate, and advancing by a guessed `1/30` second accumulates rounding error until steps skip or repeat frames. Instead, the extension samples `requestVideoFrameCallback` metadata during playback, derives the frame duration from the median of `mediaTime` deltas divided by the frames each delta actually covered (which keeps dropped frames from skewing it), and snaps the result to a standard rate when it falls within 2%. Rates such as `29.97` and `23.976` are therefore recognised exactly rather than rounded to `30` or `24`.

Each step then seeks to the *centre* of the target frame rather than its edge, which keeps float rounding from landing on a neighbour and makes stepping exactly reversible. Samples are collected only while the video is genuinely playing: a seek presents a single frame no matter how far it jumped, so measuring during stepping would confirm whatever rate was already assumed rather than the real one.

Until enough samples arrive, or on browsers without `requestVideoFrameCallback`, stepping falls back to 30 fps. Letting a clip play for about a second is enough to pin the rate down, after which stepping is frame-exact for the rest of that video.

### How held-key scrubbing stays smooth

Assigning `currentTime` while a previous seek is still running makes the browser abandon and restart it, so a naive handler that seeks once per key-repeat event spends its time cancelling its own work. Instead, at most one seek is ever in flight: further presses accumulate into a pending delta and collapse into a single next seek once the current one lands. A burst of 50 presses therefore issues two seeks rather than fifty, and because intent is tracked separately from `currentTime` — which lags behind during a burst — no press is dropped and the position stays exact.

The seek bar also draws the buffered range behind the playback fill, so stepping past the end of the buffer is visible on screen rather than just feeling slow.

### Why holding uses a different mechanism

Stepping and scrubbing want opposite things from the browser, so they are implemented separately.

Repeated seeking cannot look smooth. Every seek flushes the decode pipeline and decodes forward from the nearest keyframe, which takes an irregular amount of time, so frames arrive unevenly. Worse, the coalescing that keeps a fast key-repeat accurate deliberately merges queued presses into one larger jump — excellent for not losing steps, but it turns a held key into visible lurching.

So **forward holding does not seek at all.** It sets a low `playbackRate` and simply plays, handing the work back to the decoder's normal sequential path where frames are presented on schedule. That is the only way to get genuinely smooth output. Audio is muted for the duration, since a scrub-rate soundtrack is just noise, and both the rate and the mute state are restored on release.

**Backward holding cannot use that trick,** because no browser implements negative `playbackRate`. It therefore remains seek-based, but paced deliberately: a time accumulator issues steps at even wall-clock intervals rather than as fast as the decoder will go, which is what actually reads as smooth. When a seek is still decoding, the backlog is dropped instead of banked — falling behind makes the scrub move slower, where banking would make it lurch when the decoder caught up. A long stall is capped so it can never produce an unbounded jump.

Expect backward scrubbing to look choppier than forward. That asymmetry is inherent to how video compression and browser decoders work, not something the extension can tune away. There is no cache button to help here: both sites stream through MediaSource, so there is no file to pre-download.

Motion is also driven from an internal timer rather than from OS key-repeat events, which avoids the 300–500 ms repeat delay and the per-machine repeat rate that would otherwise set the scrub speed.

### Why dragging the bar needed the same treatment

Dragging had the same root cause in its most extreme form. Assigning `currentTime` aborts any seek already running and starts a new one, so a drag generating 60+ `pointermove` events per second cancelled every seek before it could finish: nothing ever completed, no frame was ever presented, and the picture stayed frozen until the drag ended.

Dragging now uses the same one-seek-in-flight discipline, with one deliberate difference in the queuing rule. Key repeat *accumulates* deltas, because ten presses mean ten frames and none may be lost. A drag does the opposite: it keeps only the newest pointer position and discards everything passed through on the way, since where the pointer was 80 ms ago does not matter. Each completed seek therefore aims at wherever the pointer is at that moment.

Supporting details:

- **The bar is decoupled from the decoder.** The fill and the time readout follow the pointer on every move, while only seeking is paced. The bar stays responsive even when the picture trails it by a frame or two.
- **The release is exact.** The last paced seek landed wherever the pointer happened to be while it was in flight, so releasing issues one final frame-aligned seek to the true release position. Playback resumes if it was playing.
- **`fastSeek` is used when available.** It trades precision for speed, which is the right trade mid-drag, with the exact seek saved for the release. Firefox implements it; Chrome does not, so there it falls back to exact seeks throughout.
- **A stalled seek cannot freeze the bar.** A seek into unbuffered data may pend indefinitely and never report completion. After a short grace period a new seek is allowed to supersede it, so one stall cannot wedge dragging or stepping permanently.

Dragging will not feel as smooth as the forward jog scrub, which avoids seeking altogether by letting the decoder play. A drag has to seek, so it is bounded by keyframe spacing and dragging backwards feels heavier than forwards. There is no way to pre-download around this, since both sites stream through MediaSource.

---

## Exporting a Clip

With a loop marked, **clip** in the loop menu saves that segment as a video file and
opens it in theater mode so the move can be studied straight away.

Recording is **real time by necessity**. Both sites stream through Media Source
Extensions, so there is no file sitting behind the player to slice: the only
available source is the element's own rendered output, captured through
`captureStream` into a `MediaRecorder`. A 4-second loop therefore takes about 4
seconds to record, and the loop plays through once while it happens.

- Recorded at **1x** regardless of the practice speed, so the clip is the move as
  filmed. Any player can slow it down afterwards.
- Audio is included, because for a dance clip the music is half the point. The
  video is unmuted for the recording and put back as it was.
- Output is WebM. Browsers that record from a video element produce a streamed
  container with no duration header, so some tools report the length as unknown.
- Clips are capped at 60 seconds.
- The filename names the site, the video and the bounds, for example
  `facebook-1046756455114845-20p02-22p52.webm`.
- The button is **hidden until both A and B are set**, since it means nothing
  without a segment. An unexplained greyed-out button is worse than no button.

Everything happens locally. The extension makes no network requests at all.

---

## Theater Mode

The fullscreen button opens **theater mode**: a page overlay that covers
everything so only the video is visible, while leaving the browser's own tabs
and address bar exactly where they are. Press `t`, or right-click the button, for
the same thing.

Real browser fullscreen is one click further in, from the overlay's own menu.
That is deliberate: a click inside the overlay is a fresh user gesture, which is
what `requestFullscreen` requires and what a recording several seconds long no
longer has by the time it finishes.

Theater mode **relocates the live player** rather than cloning it. A
MediaSource blob URL can only be attached to one element, so a second `<video>`
pointed at the page's source loads nothing at all. Moving the player container
also brings this extension's own control bar along, so the loop controls stay
usable in theater mode. The player is put back exactly where it was on close.

Dismiss with `Esc`, the close button, or a click on the backdrop.

## Supported Sites

| Site | Mode | What you get |
| :--- | :--- | :--- |
| Instagram | **Replace** | Full control bar: seek timeline, volume, speed, theater mode, A-B loop with clip export, frame stepping and jog scrubbing |
| Facebook | **Replace** | The same, with Facebook's own progress slider hidden where the bar takes its place |

Both sites now get the same bar at the bottom of the player. Facebook ran in **augment** mode for a while — a stripped bar pinned to the top-left, offering only the frame readout and the loop controls, leaving their player untouched — because their player already ships a progress bar and volume, and because a volume set by the extension was reverted within about a second, which would have made our volume slider look broken.

Re-measured on a live Reel, that no longer happens: `volume` holds at 0.3 across twelve samples over three seconds, and `playbackRate` and `muted` stick as they always did. With the reason gone, the asymmetry went with it.

Everything site-specific lives in one `SITE_ADAPTERS` map in `content/content.js`: the player container, native-control detection, which paths to skip, which of the site's own controls to hide, and the mode. Augment mode is still implemented but no site uses it.

### Facebook specifics

Verified against a live Reel rather than assumed:

- **`data-video-id` is the anchor.** It is language-independent, already `position: relative`, contains exactly one video, and — unlike the ancestors above it — contains none of Facebook's own sliders. Walking the DOM the way the Instagram adapter does overshoots and reaches Facebook's progress slider, which would look like a competing player and suppress the extension entirely.
- **Their progress slider is hidden, and it is found structurally.** The bar occupies the bottom of the player, which is exactly where Facebook draws its own progress bar, so the two would sit on top of each other. Theirs is located by walking up from a slider whose `aria-valuetext` looks like a time position — not by its English label — and stopping while the ancestor still holds no buttons, no video, and less than a quarter of the player's height. On a live Reel that lands on a 654x20 strip containing nothing else; one level higher is the whole 670x1191 player with 29 buttons in it.
- **Their mute button is left alone.** It is a 44x44 overlay in the *top*-left corner, so it does not collide with the bar, and the only reliable handle on it is its English label. Two mute controls is a better outcome than a positional guess that breaks on a redesign.
- **Volume, mute and speed are now the extension's**, since Facebook stopped reverting volume. A jog scrub still mutes briefly and then restores the saved preference, as on Instagram.
- **Frame stepping, jog scrubbing and frame-rate detection all work.** Seeks land and hold, Facebook does not fight `currentTime`, `playbackRate` sticks, and the frame rate measured off a real Reel came out at 30.0003 fps, snapping correctly to 30.
- **Facebook re-pauses a video that no genuine gesture started.** A bare `play()` with the extension uninvolved behaves identically, so this is their player rather than an extension bug. Clicking the bar's play button works; a *scripted* click does not, which is why the browser suite uses a real dispatched click there.
- **Hiding their controls must not be recomputed while theater mode is open.** The overlay lifts the player out of the page, so its original ancestors are briefly empty and every structural guard reads clean on elements that are about to have the video put back inside them. Measured: this hid the player itself, and closing the overlay restored the video into a `display: none` parent, collapsing it to 0x0. Facebook's page carries two players, so the guard has to be "any overlay is open", not "my own player is in it".

---

## Practising a Move (A–B Loop)

The workflow this was built for: watch a dance video, find a move, bracket it, and loop it until you have it.

1. Play until just before the move, then press `[` to set the start.
2. Let it run past the end of the move and press `]`. **Looping starts immediately** — marking the end of a move is the moment you want to begin practising it.
3. Refine with the arrow keys. Step to the exact frame you want and press `[` or `]` again to move that marker.
4. Press `Home` at any time to jump back to the start, whether or not looping is on.
5. `\` stops and starts looping; `|` clears both markers.
6. Pick a **loop speed** from the menu on the loop button — `0.1x`, `0.25x`, `0.5x`, `0.75x` or `1x`. Studying a fast move at a quarter speed is the point of the whole feature. Choosing a speed starts the loop if it was stopped, since picking a practice speed means you want to hear it.
7. Press the **link** button on the bar to copy a URL that opens the video at this loop, at this speed. Open that URL later, or send it to someone, and the video opens on the move with the markers already placed. The button appears once both markers are set.

### Sharing a loop by link

The **link** button on the control bar copies the page URL with the loop appended as a fragment:

```
https://www.instagram.com/p/Dfo3mUzgJQJ/#loop=30,34.5,0.25
```

Start, end, and an optional practice speed. The speed is left out when it is `1x`. Opening a URL like this places the markers, seeks to A, starts looping, and applies the speed, so the link lands on the move rather than at the top of the video. Times are clamped to the video, so a link naming times past the end of a shorter video degrades rather than breaking, and markers snap to frame centres, which can shift a shared time by up to half a frame.

A link applies to the first player that can take it, then is consumed — so opening a link while a feed is on screen does not stamp the same loop onto every video in it.

**This required reading the URL earlier than the rest of the extension runs.** Facebook rewrites the address bar about 1.3 seconds into page load and removes the fragment, comfortably before `DOMContentLoaded`. A script at `document_idle`, where everything else here runs, would read an address that has already been cleaned. So `content/capture-url.js` runs at `document_start`, does nothing but record the URL, and exits; the rest of the extension reads that recorded copy. Instagram keeps the fragment indefinitely, but reading early is correct on both and avoids a per-site special case.

**The address bar follows the loop.** Setting or moving a marker, trimming a handle, or changing the practice speed rewrites the fragment in place, so the page can be bookmarked or copied straight from the browser. Clearing the loop removes it again, so a copied URL never carries a loop the page is no longer showing.

This is done with `history.replaceState`, not by assigning `location.hash`. Assigning would push a history entry per edit and bury the back button under a few minutes of trimming; measured, three loop edits now add **zero** entries. Writes are debounced, because dragging a handle changes the loop on every pointer move.

Facebook's stripping turned out to apply only to the fragment it finds **on load**, not to later writes: once the page has settled, a `replaceState` fragment persists there as it does on Instagram. That was worth measuring rather than assuming, since an earlier version of this README concluded the opposite and skipped the feature on that basis.

The **link** button is still the route when you want the URL on the clipboard rather than in the address bar. If the clipboard refuses — it needs a trusted click and a focused document — the link appears in the button's tooltip instead so it is never lost.

### Loop speed

The loop button carries a menu: speeds above a divider, the loop actions below it.

Loop speed is deliberately **separate from the general playback speed**, so you can watch a video at normal speed and practise a bracketed move at `0.25x` without changing one to adjust the other. The loop borrows the rate when looping starts and hands it back when looping stops, and the speed you pick is remembered for the next loop.

Changing the speed while a loop is running applies immediately, so the menu is a live control rather than a setting for next time. The rate is clamped to what browsers accept — assigning one outside that range throws and would otherwise take the player down.

On Facebook this is the one case where the extension does set playback speed, which it otherwise leaves alone: a loop speed is a deliberate request rather than a background assertion, and the previous rate is restored when looping ends.

If you used the arrow keys to find the move, keyboard navigation will have muted the video. Press `Space` to play the loop and the sound comes back with it, which matters when the music is the point.

The same controls are on the bar: a loop toggle that carries the state, a jump-back-to-A button, and a popup on the toggle holding `A`, `B`, `clr` and the zoom switch. Right-clicking the loop toggle clears the markers. They are available on Facebook too, where most of the bar is hidden, because looping is the point of the tool on a dance video.

### Trim handles

The marked segment is painted on the seek bar with a draggable handle at each end, the way a clip trimmer works. Grab either handle and slide it to move that marker — the video previews the frame you are trimming to as you drag, so you can see exactly where the segment starts or ends.

- **Both marker times are always shown.** A floating readout above the bar names A and B and the span between them, updating live as either one moves, so a lone marker still shows where it is and the relationship between the two is visible while trimming: `A 0:22.68   B 0:31.18  (8.50s)`.
- Handles appear as soon as their marker is set, so you can place A, drag it to taste, then place B.
- **A distinct playhead marks the current position.** The playback fill's leading edge was indistinguishable from the loop span, so position is now its own high-contrast marker with a dark outline that reads against white fill, blue span and bare track alike.
- **The hotkeys are shown while you drag.** Dragging the playhead surfaces a hint above the bar: `press [ to set A here`, then `press ] to set B here` once A exists. The hint updates the moment you set a marker, so the next useful shortcut is always the one on screen. Dragging a handle names which marker you are moving instead.
- Markers set during a drag land at the **pointer**, not at the video's position. Paced seeking means `currentTime` lags behind the pointer, so reading it would place the marker a few frames from where it looks.
- **The timeline zooms when the handles get too close to aim at.** The decision is made in pixels rather than as a fraction of the video, because what matters is the on-screen gap: below roughly two inches the bar switches to a window around the loop. The same markers that sat two pixels apart end up about 75 apart.
- **Zoom is capped**, so the window never narrows past five seconds however short the loop. A three-frame loop will not zoom without limit.
- **The window is sticky and the thresholds are scale-free.** It is held as state, not recalculated on every change, and it only moves when it stops working: when a marker falls outside it, when the loop has become too small a share of it to aim at, or when the loop has grown large enough that zooming is pointless.

  An earlier version compared the handle gap against an absolute 190 pixels. On a seek bar only 130–180 pixels wide that target can never be met, so "needs more zoom" stayed true and the window tracked the span on every single call — the bar appeared to reset and skip around while a handle was being dragged closer. The thresholds are now fractions of the bar, which are achievable by construction: a zoom targets 50% and re-triggers below 20%, so each one settles. The absolute pixel figure survives only as a guard that suppresses zooming on a bar wide enough not to need it.

- **The window is frozen for the duration of a drag.** Moving a marker changes the window, which changes the pointer-to-time mapping, which moves the handle away from the pointer — a feedback loop. The window is re-evaluated once on release instead, so a drag never rescales underneath you. Walking a marker 11 seconds inwards across 45 positions now changes the window three times rather than 45.
- **The timeline runs a little past the end of the video.** With B inside a second of the end, the window would stop exactly at the media, putting the B handle on the track's right edge with nothing after it — measured at **1 pixel** of track beyond it, which is not something you can grab. The window is now extended past the end of the video by enough to leave about 20 pixels of empty track, the post-roll a clip trimmer leaves for the same reason.

  Widening the window **in time** was the first attempt and it was wrong. A 20-second window does buy a wider view, but the window still ends at the media, so B stays on the edge, and the markers are squeezed together on the way: measured at 45 pixels apart mid-video against **11** at the end. Padding in pixels past the media keeps the gap at 39 and puts 21 pixels behind B.
- The track is tinted and bracketed while zoomed, since it is then showing a slice rather than the whole video, and the `fit` / `full` entry in the loop popup switches it off for coarse navigation.
- Everything on the bar reads through the window, so while zoomed the playhead drag is fine-grained too.
- A handle cannot pass its partner: dragging the in point towards the out point stops three frames short, and vice versa.
- Each position snaps to a frame centre, the same grid the arrow keys step along, so dragging and frame-stepping agree.
- A press on a handle does not start a playhead scrub, even though the handle sits on the seek bar.
- Previews are paced through the same single-seek-in-flight path as every other drag, so a fast drag cannot thrash the decoder.

On Facebook the extension shows a compact 150px trim timeline for this purpose. It is not a replacement for Facebook's progress bar, which stays exactly where it was — it exists to carry the handles, which their player has no equivalent for.

### Notes on the design

- **Markers are deliberately soft.** Set them roughly while the video plays, then refine either by frame-stepping and re-pressing, or by dragging the handle on the seek bar. There is no separate edit mode, and no need to be precise the first time. Each marker snaps to the centre of the current frame, so it sits on the same grid the arrow keys step along.
- **Order does not matter.** Mark the end before the start if that is how you spotted it; the range sorts itself.
- **Very short loops are refused.** A range under three frames thrashes the decoder and shows nothing useful, so the loop toggle stays disabled until the span is worth playing.
- **Restarts are paced** through the same single-seek-in-flight path as everything else, so a tight loop cannot issue a new seek before the last one landed.
- **Slow it down.** The loop speed menu on the loop button is the control for this. On Instagram the bar's separate speed control still sets the general playback speed; on Facebook that one belongs to their player.
- **Export it.** **clip** in the loop menu saves the marked segment and opens it in theater mode.
- Markers belong to the video. They clear when the player loads something else, since Instagram and Facebook both recycle `<video>` elements between posts.

---

## Architecture

Built with a clean, single-script content architecture adhering to modern Manifest V3 standards:

```text
instagram-video-control/
├── manifest.json         # Extension Manifest V3 configuration
├── service-worker.js     # Background worker for automatic tab injection
├── icons/                # High-res extension icons (16px, 48px, 128px)
├── content/
│   ├── core.js           # Pure logic: frame math, seek coalescing, scrub pacing
│   ├── content.js        # Controller: DOM observer, timeline, volume, speeds
│   └── content.css       # Control bar layout, transitions, and slider styles
├── tests/
│   ├── run.js            # Unit suite (`node tests/run.js`, no browser)
│   └── browser/          # Browser suite (drives a real Chrome over CDP)
│       ├── launch-chrome.sh
│       ├── run.js
│       ├── cdp.js        # Minimal DevTools Protocol client
│       ├── harness.js    # Extension loading and page helpers
│       ├── config.js     # Fixture URLs and timings
│       └── specs/        # One file per area under test
├── AGENTS.md             # Instructions for AI agents working on this code
├── PRIVACY.md            # Privacy Policy
├── LICENSE               # MIT License
└── README.md
```

- **MutationObserver**: Monitors dynamic DOM mutations to attach controls seamlessly to freshly loaded videos or virtualized feeds without layout shifts.
- **Passive Listeners & RequestAnimationFrame**: Smooth timeline scrubbing and minimal CPU idle overhead.
- **Lucide Icons**: Built-in SVG vector paths; zero external web font or asset loading.
- **`content/core.js`**: Holds the logic with non-obvious invariants — frame indexing, frame-rate snapping, seek coalescing, scrub pacing, loop and marker clamping, timeline zoom windowing, URL loop parsing — deliberately free of DOM and video-element access. `content.js` keeps the orchestration that cannot be separated from a `<video>`. The split exists so the test suite can exercise the shipping code rather than a copy of it.

---

## Tests

Two tiers. The first needs nothing; the second needs a browser.

### Unit suite — run it always

```bash
node tests/run.js           # run everything
node tests/run.js frame     # run only groups matching "frame"
```

No dependencies and no build step, and it finishes in well under a second. It
loads `content/core.js` directly, so it tests the same code the extension
ships. Logic that needs a `<video>` is driven through a fake element whose
seeks complete only when a test says so, which is what makes the
one-seek-in-flight sequencing observable.

Covered: time formatting, frame-rate snapping, frame-index and frame-centre
math, frame-step coalescing, drag-seek coalescing and release, the stall
watchdog, scrub pacing, buffered-range lookup, loop normalisation and marker
clamping, timeline zoom windowing, URL loop parsing and formatting, and clip
filename construction.

### Browser suite — run it before a release

```bash
tests/browser/launch-chrome.sh      # once, in a separate terminal
node tests/browser/run.js           # everything, both sites
node tests/browser/run.js --site=instagram
node tests/browser/run.js theater   # filter by group or test name
node tests/browser/run.js --list    # show what would run
```

This drives a real Chrome against real Instagram and Facebook posts over the
DevTools Protocol, which is the only way to test the parts that depend on the
sites themselves. It takes minutes and needs a signed-in profile. The launcher
uses a dedicated `--user-data-dir`, because Chrome 136 and later silently
ignore `--remote-debugging-port` on the default profile, and binds to
`127.0.0.1` only.

It covers what the unit suite structurally cannot:

- Control bar layout on a real player, including that nothing is clipped off a
  narrow bar
- Which player the keyboard acts on, typing-context suppression, and silence
  while the arrow keys drive
- Marker placement, trim-handle dragging, and that the timeline stays frozen
  mid-drag
- That a loop actually confines playback, wraps at B, and holds its own rate
- That `capture-url.js` wins the race against Facebook stripping the URL
  fragment, roughly 1.3 seconds after navigation
- Theater mode sizing, bar reachability, and restoring the player on close
- Clip recording end to end, including the saved filename

A missing or private fixture video **skips** rather than fails, and skips are
listed separately at the end of a run.

Still not automated: entering real fullscreen, which Chrome refuses to grant to
synthetic input, and anything requiring a clipboard read. `AGENTS.md` records
why, along with the harness traps worth knowing before writing a new spec.

---

## Permissions & Privacy

This extension requests only the minimum host and API permissions strictly necessary:

| Permission | Justification |
| :--- | :--- |
| `storage` | Saves your volume level, mute state, and speed preference locally via `chrome.storage.local`. |
| `scripting` | Injects controls into already-open tabs when the extension is updated or installed. |
| `*://*.instagram.com/*` | Restricts script execution to Instagram web domains. |
| `*://*.facebook.com/*` | Restricts script execution to Facebook web domains. |

The extension makes no network requests of any kind.

Read the full [Privacy Policy](PRIVACY.md).

---

## Building Store Package

To package the extension for Microsoft Edge Add-ons or Chrome Web Store submission:

```powershell
tar -a -cf .\instagram-video-control.zip manifest.json service-worker.js icons content
```

---

## Disclaimer

This is an independent open-source project created by Surya Kencana Putra. This extension is not affiliated with, endorsed by, or sponsored by Instagram, Meta Platforms, Inc., or any of their affiliates.

---

## License

Distributed under the [MIT License](LICENSE). Copyright (c) 2026 Surya Kencana Putra.
