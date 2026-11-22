# Socials Video Controls

A browser extension that adds video playback controls to Instagram and frame-accurate navigation to both Instagram and Facebook: a timeline scrubber, persistent volume, playback speed, frame-by-frame stepping, smooth jog scrubbing, and optional whole-video caching.

> **Fork notice.** This project began as [Instagram Video Control](https://git.skp.my.id/surya/instagram-video-control) by Surya Kencana Putra, MIT licensed, and retains that license and copyright notice. It has since diverged substantially: frame-accurate stepping, jog scrubbing, live drag scrubbing, a whole-video cache, a test suite, and Facebook support were added here. It is unrelated to the similarly named [Arcus92/instagram-video-control](https://github.com/Arcus92/instagram-video-control), which is an independent project.

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
- **Optional Whole-Video Cache**: A download button on the control bar pulls the entire video into memory, after which scrubbing and frame stepping never wait on the network. Off by default, released the moment you leave the video.
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

The seek bar also draws the downloaded range behind the playback fill, so stepping past the end of the buffer is visible on screen rather than just feeling slow.

### Why holding uses a different mechanism

Stepping and scrubbing want opposite things from the browser, so they are implemented separately.

Repeated seeking cannot look smooth. Every seek flushes the decode pipeline and decodes forward from the nearest keyframe, which takes an irregular amount of time, so frames arrive unevenly. Worse, the coalescing that keeps a fast key-repeat accurate deliberately merges queued presses into one larger jump — excellent for not losing steps, but it turns a held key into visible lurching.

So **forward holding does not seek at all.** It sets a low `playbackRate` and simply plays, handing the work back to the decoder's normal sequential path where frames are presented on schedule. That is the only way to get genuinely smooth output. Audio is muted for the duration, since a scrub-rate soundtrack is just noise, and both the rate and the mute state are restored on release.

**Backward holding cannot use that trick,** because no browser implements negative `playbackRate`. It therefore remains seek-based, but paced deliberately: a time accumulator issues steps at even wall-clock intervals rather than as fast as the decoder will go, which is what actually reads as smooth. When a seek is still decoding, the backlog is dropped instead of banked — falling behind makes the scrub move slower, where banking would make it lurch when the decoder caught up. A long stall is capped so it can never produce an unbounded jump.

Expect backward scrubbing to look choppier than forward. That asymmetry is inherent to how video compression and browser decoders work, not something the extension can tune away. Pre-downloading the video with the cache button removes network waits during a scrub but does not change decode cost.

Motion is also driven from an internal timer rather than from OS key-repeat events, which avoids the 300–500 ms repeat delay and the per-machine repeat rate that would otherwise set the scrub speed.

### Why dragging the bar needed the same treatment

Dragging had the same root cause in its most extreme form. Assigning `currentTime` aborts any seek already running and starts a new one, so a drag generating 60+ `pointermove` events per second cancelled every seek before it could finish: nothing ever completed, no frame was ever presented, and the picture stayed frozen until the drag ended.

Dragging now uses the same one-seek-in-flight discipline, with one deliberate difference in the queuing rule. Key repeat *accumulates* deltas, because ten presses mean ten frames and none may be lost. A drag does the opposite: it keeps only the newest pointer position and discards everything passed through on the way, since where the pointer was 80 ms ago does not matter. Each completed seek therefore aims at wherever the pointer is at that moment.

Supporting details:

- **The bar is decoupled from the decoder.** The fill and the time readout follow the pointer on every move, while only seeking is paced. The bar stays responsive even when the picture trails it by a frame or two.
- **The release is exact.** The last paced seek landed wherever the pointer happened to be while it was in flight, so releasing issues one final frame-aligned seek to the true release position. Playback resumes if it was playing.
- **`fastSeek` is used when available.** It trades precision for speed, which is the right trade mid-drag, with the exact seek saved for the release. Firefox implements it; Chrome does not, so there it falls back to exact seeks throughout.
- **A stalled seek cannot freeze the bar.** A seek into unbuffered data may pend indefinitely and never report completion. After a short grace period a new seek is allowed to supersede it, so one stall cannot wedge dragging or stepping permanently.

Dragging will not feel as smooth as the forward jog scrub, which avoids seeking altogether by letting the decoder play. A drag has to seek, so it is bounded by keyframe spacing and dragging backwards feels heavier than forwards. Pre-downloading with the cache button removes network latency from each seek, though not decode cost.

---

## Whole-Video Cache

Longer videos are the case where seeking genuinely does hit the network: the browser only keeps part of a several-minute file buffered, so scrubbing into an unbuffered region waits on a range request. The download button on the control bar removes that wait.

Clicking it fetches the entire video file once, shows progress as a percentage in place of the icon, then repoints the video element at an in-memory copy. From that moment every seek is served locally and the buffer bar reads full. Click again to release it. Clicking during the download cancels it.

| Button state | Meaning |
| :--- | :--- |
| Download icon | Not cached; click to pre-download |
| `42%` | Downloading; click to cancel |
| Check icon | Cached in memory; click to release |
| Dimmed icon | Unavailable for this video, or the last attempt failed |

### Cost and limits

- **Memory.** The video is held as a blob for as long as it stays cached — roughly 60–120 MB for a typical 2–4 minute Instagram video. Downloads above 256 MB are refused rather than allowed to exhaust the tab.
- **Lifetime.** Memory only. Nothing is written to disk, and the copy is dropped when you release it, navigate away, or the video scrolls out of view and its player is torn down. Instagram recycles `<video>` elements between posts, so the extension also detects when an element has been reclaimed and frees the cache with it.
- **Segmented videos cannot be cached.** When Instagram streams a video through Media Source Extensions, the element's source is a `blob:` URL fed by Instagram's own JavaScript rather than a fetchable file. There is nothing to download, and overwriting the source would break their player, so the button reports the video as unavailable and issues no request.
- **This removes network waits, not decode cost.** Inter-frame compression means a seek still decodes forward from the nearest keyframe, which is why stepping backwards stays slower than stepping forwards even when fully cached.

### What it means for privacy

This feature is the extension's only network request, and the first in its history. It asks for the same video file the page is already playing, from the same Instagram address, with cookies deliberately omitted. It is opt-in per video, never automatic, and sends no information anywhere. Caching requires no additional permissions. See the [Privacy Policy](PRIVACY.md) for the full statement.

---

## Supported Sites

| Site | Mode | What you get |
| :--- | :--- | :--- |
| Instagram | **Replace** | Full control bar: seek timeline, volume, speed, fullscreen, whole-video cache, plus frame stepping and jog scrubbing |
| Facebook | **Augment** | Frame stepping, jog scrubbing and a frame readout only — Facebook's own player is left completely intact |

The two modes exist because the sites differ. Instagram ships almost no video controls, so there is nothing to compete with and the bar replaces the gap. Facebook already ships a full player — progress bar, volume, fullscreen, quality — so duplicating it would be redundant and would fight their controls. On Facebook the extension contributes only what is missing and suppresses nothing.

Everything site-specific lives in one `SITE_ADAPTERS` map in `content/content.js`: the player container, native-control detection, which paths to skip, and the mode. Adding another site means adding an adapter, not touching the rest.

### Facebook specifics

Verified against a live Reel rather than assumed:

- **`data-video-id` is the anchor.** It is language-independent, already `position: relative`, contains exactly one video, and — unlike the ancestors above it — contains none of Facebook's own sliders. Walking the DOM the way the Instagram adapter does overshoots and reaches Facebook's progress slider, which would look like a competing player and suppress the extension entirely.
- **Volume, mute and speed are Facebook's.** A volume written by the extension is reverted by their player within a second, so in augment mode the extension does not assert any of them. A jog scrub still mutes briefly, then restores whatever was actually in effect rather than the extension's saved preference.
- **The whole-video cache does not apply.** Facebook streams through Media Source Extensions, so there is no fetchable file behind the player.
- **Frame stepping, jog scrubbing and frame-rate detection all work.** Seeks land and hold, Facebook does not fight `currentTime`, `playbackRate` sticks, and the frame rate measured off a real Reel came out at 30.0003 fps, snapping correctly to 30.
- **Facebook sometimes re-pauses a video it did not start.** A bare `play()` with the extension uninvolved behaves identically, so this is their player's behaviour rather than an extension bug. It can make `Space` appear not to resume.

---

## Practising a Move (A–B Loop)

The workflow this was built for: watch a dance video, find a move, bracket it, and loop it until you have it.

1. Play until just before the move, then press `[` to set the start.
2. Let it run past the end of the move and press `]`. **Looping starts immediately** — marking the end of a move is the moment you want to begin practising it.
3. Refine with the arrow keys. Step to the exact frame you want and press `[` or `]` again to move that marker.
4. Press `Home` at any time to jump back to the start, whether or not looping is on.
5. `\` stops and starts looping; `|` clears both markers.

The same four controls are on the bar: `A`, `B`, a loop toggle, and a jump-back-to-A button. Right-clicking the loop toggle clears the markers. They are available on Facebook too, where the rest of the bar is hidden, because looping is the point of the tool on a dance video.

### Trim handles

The marked segment is painted on the seek bar with a draggable handle at each end, the way a clip trimmer works. Grab either handle and slide it to move that marker — the video previews the frame you are trimming to as you drag, so you can see exactly where the segment starts or ends.

- Handles appear as soon as their marker is set, so you can place A, drag it to taste, then place B.
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
- **Slow it down.** On Instagram, combine the loop with the speed control (`0.5x` or `0.25x`) to study a fast move. On Facebook, use their own speed control — the extension does not touch playback speed there.
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
│   └── run.js            # Test suite (`node tests/run.js`, no dependencies)
├── PRIVACY.md            # Privacy Policy
├── LICENSE               # MIT License
└── README.md
```

- **MutationObserver**: Monitors dynamic DOM mutations to attach controls seamlessly to freshly loaded videos or virtualized feeds without layout shifts.
- **Passive Listeners & RequestAnimationFrame**: Smooth timeline scrubbing and minimal CPU idle overhead.
- **Lucide Icons**: Built-in SVG vector paths; zero external web font or asset loading.
- **`content/core.js`**: Holds the logic with non-obvious invariants — frame indexing, frame-rate snapping, seek coalescing, scrub pacing, cache eligibility — deliberately free of DOM and video-element access. `content.js` keeps the orchestration that cannot be separated from a `<video>`. The split exists so the test suite can exercise the shipping code rather than a copy of it.

---

## Tests

```bash
node tests/run.js           # run everything
node tests/run.js frame     # run only groups matching "frame"
```

No dependencies and no build step. The suite loads `content/core.js` directly, so it tests the same code the extension ships. Logic that needs a `<video>` is driven through a fake element whose seeks complete only when a test says so, which is what makes the one-seek-in-flight sequencing observable.

Covered: time formatting, frame-rate snapping, frame-index and frame-centre math, frame-step coalescing, drag-seek coalescing and release, the stall watchdog, scrub pacing, buffered-range lookup, and cache eligibility.

**Not covered**, because it cannot be separated from a real element or DOM without a headless browser:

- Blob lifetime ordering in the cache — the `src` must move off a blob URL before that URL is revoked, or playback breaks
- Forward jog scrub, which sets `playbackRate` and plays rather than seeking
- Restoring rate and mute after a scrub, and `sync()` not fighting them
- Which player the keyboard acts on, and typing-context suppression
- Player discovery, native-control detection, bar mounting, and recycled-element teardown

Those need manual verification in the browser. The same list is repeated at the bottom of `tests/run.js` so it stays with the code.

---

## Permissions & Privacy

This extension requests only the minimum host and API permissions strictly necessary:

| Permission | Justification |
| :--- | :--- |
| `storage` | Saves your volume level, mute state, and speed preference locally via `chrome.storage.local`. |
| `scripting` | Injects controls into already-open Instagram tabs when the extension is updated or installed. |
| `*://*.instagram.com/*` | Restricts script execution exclusively to Instagram web domains. |

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
