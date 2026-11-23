# Socials Video Controls

Frame-accurate video controls for Instagram and Facebook, built for learning
dance: bracket a move, loop it, slow it down, step through it one frame at a
time. Works on desktop as an extension and on iPhone or iPad as a userscript.

> **Fork notice.** This began as [Instagram Video Control](https://git.skp.my.id/surya/instagram-video-control)
> by Surya Kencana Putra, MIT licensed, and keeps that licence and copyright
> notice. It has since diverged substantially: frame stepping, jog scrubbing,
> drag scrubbing, A–B loop practice, clip export, theater mode, touch support, a
> test suite and Facebook support were added here. It is unrelated to the
> similarly named [Arcus92/instagram-video-control](https://github.com/Arcus92/instagram-video-control).

[![Manifest](https://img.shields.io/badge/Manifest-V3-blue?logo=googlechrome&logoColor=white)](manifest.json)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0%20(Pure%20JS%2FCSS)-success)](ARCHITECTURE.md)

<p align="center">
  <img src="screenshot-1280x800.png" alt="Socials Video Controls preview" width="720">
</p>

---

## What it does

- **A–B loop practice.** Bracket a few seconds and loop them until you have the
  move. Markers are soft: set them roughly, then refine.
- **Frame-by-frame stepping**, with the frame rate measured off the video rather
  than guessed, so steps do not drift or repeat.
- **Smooth jog scrubbing** on a held key, and live drag scrubbing where the
  picture follows the pointer instead of waiting for release.
- **Speed from 0.1× to 2×**, which applies to loops too.
- **A real seek timeline** with a buffered-range indicator, on sites that ship
  almost no controls.
- **Shareable loop links** — a URL that reopens the video on the move.
- **Clip export** of the marked segment (desktop only).
- **Theater mode** that fills the screen without hiding the browser.
- **Persistent volume and speed** across videos and sessions.

It makes **no network requests of any kind**. See
[PRIVACY.md](PRIVACY.md).

---

## Install on iPhone or iPad

iOS cannot load an unpacked extension, so the same code ships as a single
userscript.

1. Install a userscript manager from the App Store —
   [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887) is free
   and open source. Tampermonkey and Stay also work.
2. Open the app and point it at a folder.
3. Open this link on the device and the manager will offer to install it:

   ```
   https://raw.githubusercontent.com/nhuisman/socials-video-controls/main/dist/socials-video-controls.user.js
   ```

   Or copy `dist/socials-video-controls.user.js` into that folder by hand.
4. In **Settings → Apps → Safari → Extensions**, enable the manager and allow it
   on `instagram.com` and `facebook.com`.

Re-open the same link after an update to upgrade.

**Touch controls differ from desktop**, because there is no hover to reveal the
bar and no keyboard to step frames:

| On touch | |
| :--- | :--- |
| Tap the video | Show the control bar (it hides again while playing) |
| `◀∣` `∣▶` buttons | Tap for one frame, hold to scrub — the arrow keys' job |
| Long-press the track | Start painting a loop: A lands under your finger, drag and lift to set B |
| Tap the speed or loop button | Opens its menu; loop on/off lives inside the loop menu |

Clip export is hidden on iOS: Safari does not implement
`HTMLMediaElement.captureStream`, so there is nothing to record from.

### Testing it on a Mac first

Userscripts is also on the Mac App Store. Drop the same file in its folder and
use Safari's **Develop → Responsive Design Mode** to get an iPhone viewport with
touch events. That exercises WebKit, the same engine Safari and Orion use,
without an iOS install.

---

## Install on desktop

Chrome, Edge, Brave, Opera, or any Chromium browser:

1. Clone the repository:
   ```bash
   git clone https://github.com/nhuisman/socials-video-controls.git
   ```
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the cloned folder.
5. Open a video post or Reel.

---

## Using the controls

The bar appears at the bottom of the player when you hover it (or tap, on
touch).

| Control | What it does |
| :--- | :--- |
| Jump-to-A | Snaps back to the loop start. Leftmost, because it is the one you press most while practising. |
| Play / pause | Also `Space`. |
| Readout | Position and duration, gaining decimals while you step frames. |
| Seek track | Drag to scrub. Carries the loop span, both handles and the playhead. |
| Mute | Volume slider on desktop; mute only on iOS, which will not let a page set volume. |
| Speed | `0.1×` to `2×`. Applies to loops as well. |
| Loop | Loop controls: `A`, `B`, `clr`, `clip` and the timeline zoom switch. |
| Link | Copies a URL that reopens the video at this loop. Appears once A and B are set. |
| Theater | Fills the screen with just the video. Real fullscreen is inside that overlay. |

### Keyboard shortcuts

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

The shortcuts only apply to the player whose control bar is showing, so
Instagram's own arrow-key and `Space` handling is untouched everywhere else.
They are ignored while focus is in a text field, and `Ctrl`, `Cmd` or `Alt`
combinations pass through to the browser.

**Keyboard navigation is silent.** The first keyboard move mutes the video and
it stays muted until you deliberately resume playback. A half-speed soundtrack
during a jog scrub is noise, and a single frame of audio is a click.

### Practising a move

1. Play until just before the move and press `[` to set the start.
2. Let it run past the end and press `]`. **Looping starts immediately** —
   marking the end of a move is when you want to begin practising it.
3. Refine with the arrow keys: step to the exact frame and press `[` or `]`
   again to move that marker. Or drag either handle on the seek bar; the picture
   follows the handle so you can see the frame you are setting.
4. Slow it down with the speed control. A quarter speed is the point of the
   whole feature.
5. `Home` jumps back to the start, `\` stops and starts looping, `|` clears both
   markers.
6. The **link** button copies a URL that reopens the video on this loop, at this
   speed — useful for sending someone a specific eight bars.

A loop under three frames is refused, because it thrashes the decoder and shows
nothing useful. The timeline zooms in automatically when the handles get too
close together to aim at.

---

## Supported sites

| Site | What you get |
| :--- | :--- |
| Instagram | The full bar, replacing a player that ships almost no controls |
| Facebook | The same bar, with Facebook's own progress slider hidden where ours sits |

Everything site-specific lives in one `SITE_ADAPTERS` map, so adding a site means
adding an adapter rather than touching the rest.

---

## Permissions

| Permission | Why |
| :--- | :--- |
| `storage` | Saves your volume, mute and speed locally via `chrome.storage.local`. |
| `scripting` | Injects controls into already-open tabs when the extension is installed or updated. |
| `*://*.instagram.com/*` | Limits the extension to Instagram. |
| `*://*.facebook.com/*` | Limits the extension to Facebook. |

No network requests, no analytics, no remote code, no `eval`. The userscript
build asks for `@grant none` and the test suite asserts all of that against the
built file.

---

## Further reading

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — why it works the way it does: frame
  rate measurement, seek coalescing, why a held key plays instead of seeking,
  the timeline zoom, site adapters, and how to run the tests.
- **[AGENTS.md](AGENTS.md)** — rules for AI agents changing this code, including
  the harness traps worth knowing before writing a browser test.
- **[PRIVACY.md](PRIVACY.md)** — privacy policy.

---

## Disclaimer

This is an unofficial, independent project. It is not affiliated with,
endorsed by, or connected to Instagram, Facebook, or Meta Platforms, Inc. It
only controls playback your browser is already doing: no downloading of other
people's media, no stream extraction, no credential handling, no DRM
circumvention.

---

## License

MIT — see [LICENSE](LICENSE).
