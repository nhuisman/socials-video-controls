# Working on this extension

Instructions for an AI agent making changes here. Read this before touching code.

## What this is

A Chrome extension that adds frame-accurate navigation and A–B loop practice to
Instagram and Facebook videos. It exists to study dance moves: mark a few
seconds, loop them slowly, step frame by frame, export the clip.

There is no build step. The files in `content/` are what ships.

## Project layout

| Path | What it is |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions and host matches live here. |
| `content/capture-url.js` | Runs at `document_start`. Stashes the launch URL before the page can strip it. |
| `content/core.js` | Pure logic. No DOM, no browser APIs. Everything testable without a browser. |
| `content/content.js` | Everything that touches the page: the control bar, keys, loop, clip, theater. |
| `content/content.css` | All styling, including theater mode. |
| `service-worker.js` | Settings storage. |
| `tests/run.js` | Unit suite. No browser. Runs in well under a second. |
| `tests/browser/` | Browser suite. Drives a real Chrome against real pages. |
| `tools/build-userscript.js` | Generates the userscript bundle from `content/`. |
| `dist/socials-video-controls.user.js` | **Generated.** Never edit by hand. |

## Testing

Two tiers, and the distinction matters.

### During development — always

```bash
node tests/run.js
```

Run this after every change. It needs nothing, takes no time, and covers all of
`core.js`. There is no excuse for skipping it, and no change should be committed
without it passing.

### Release test — only when asked

```bash
tests/browser/launch-chrome.sh      # once, in a separate terminal
node tests/browser/run.js
```

Run the browser suite when the user asks for a "release test", and **not
otherwise**. It takes minutes, needs a signed-in Chrome, and depends on real
Instagram and Facebook posts that can disappear without warning.

Useful flags:

```bash
node tests/browser/run.js --site=instagram    # one site
node tests/browser/run.js theater             # filter by group or test name
node tests/browser/run.js --list              # show what would run
```

A failing fixture **skips** rather than fails: a deleted video is not a defect
in the extension. Skips are listed separately at the end of a run.

### When you drive the browser, leave a test behind

If you connect to Chrome to investigate or verify something — measuring a
layout, checking whether a site strips a URL, confirming a control is
reachable — **consider adding a spec for it** in `tests/browser/specs/`.

This project has repeatedly lost knowledge to throwaway `/tmp` probes: the
measurement was made, the conclusion acted on, and nothing was left that could
catch the same problem again. Every trap listed below cost real time precisely
because no test encoded it.

A spec file exports a function taking the site config and registers groups with
the harness:

```js
const h = require('../harness');

module.exports = (site) => {
  h.describe(`${site.label}: thing`, () => {
    h.it('does what it should', async (page) => {
      await h.hoverVideo(page);
      // ... drive the page, then assert
    });
  });
};
```

New files in `specs/` are picked up automatically. `tests/browser/run.js` has an
explicit order list for readability; anything not in it runs afterwards.

### A test that cannot fail is not a test

Before claiming a fix works, **verify the test fails without it**:

```bash
git stash push content/content.css && node tests/browser/run.js "your test"   # must fail
git stash pop                                                                  # must pass
```

This is not optional ceremony. A test asserting the theater video filled its
stage passed on the broken build, because the stage shrink-wrapped the
undersized video — the reference moved with the bug. Measuring against the
viewport, which cannot move, turned the same test red. Pick a reference the bug
cannot influence.

## Harness traps

Every one of these was discovered the hard way. They are also commented at the
point of use in `cdp.js` and `harness.js`.

1. **Chrome 136+ ignores `--remote-debugging-port` on the default profile.** The
   launcher passes its own `--user-data-dir`. Without it, nothing connects.
2. **Navigating to the same URL with a different fragment is a same-document
   change.** No new document means init scripts never run, so a
   `document_start` capture is never exercised. `page.goto` routes via
   `about:blank` first.
3. **Synthetic `PointerEvent` breaks drags.** A constructed event carries a
   `pointerId` that was never a live pointer, so `setPointerCapture` throws and
   the drag handler aborts. Use `Input.dispatchMouseEvent` (`page.drag`).
4. **Do not add the reveal class by hand.** Adding `.ig-vc-kb` to the first
   `.ig-vc-player` may pick the wrong element, leaving the bar at opacity 0.
   Hover the video instead (`h.hoverVideo`).
5. **Feed pages have several videos, each with its own bar.** Scope every query
   to the engaged player via `h.barExpr` / `h.ACTIVE_BAR`. Not doing this
   produced three false failures: ten speed options instead of five, a clip
   button reported hidden, markers reported unset.

   Resolving the bar afresh on each call is not enough, because every signal
   for "engaged" expires: the keyboard reveal lapses after 4s, and the last
   resort is the first bar in the document. Facebook grows a **second** player
   after load (`barCount: 2`), so a test read one bar while the keys acted on
   another and reported a marker handle as missing when it was displayed. So
   `hoverVideo` now tags its player `.ig-vc-test-target` and `ACTIVE_BAR`
   prefers that tag. Always reach a player through `h.hoverVideo`.
6. **`innerWidth` includes the scrollbar; a fixed element's rect does not.**
   Comparing them makes a correct overlay look 15px narrow. Use
   `h.VIEWPORT_EXPR` (`documentElement.clientWidth`).
7. **Clipboard access needs a trusted gesture** that a scripted `.click()` does
   not supply. Assert on what the button reports, not on clipboard contents.
8. **Fixture pages need a signed-in profile.** The harness detects a login page
   and skips.
9. **CDP input cannot enter fullscreen.** `requestFullscreen` rejects with
   `TypeError: not granted` from synthetic clicks *and* keypresses — a plain
   div with its own handler fails identically, so this is the harness, not the
   extension. Assert the button is present, permitted and un-covered; skip the
   rest. Never "fix" code to satisfy this.
10. **Theater mode needs a retry to open.** After a previous overlay closes, the
    host page is still settling the relocated player, so `t` can land on
    nothing. Use `h.openTheaterOverlay`, which retries and waits for layout.
11. **Recording from an unbuffered position stalls** and looks like a broken
    recorder. Call `h.waitForSeekable` before starting a clip.
12. **Chromium cannot see a `fastSeek` code path.** Chromium does not implement
    `HTMLMediaElement.fastSeek`, so any `typeof video.fastSeek === 'function'`
    branch is dead in this suite and live in WebKit, where the API originated.
    The marker-drag preview went through it and drifted up to 0.89s from the
    handle, which no test could catch. If you write a branch on a feature
    Chromium lacks, install a stand-in and test both sides -- see
    `markers.spec.js` → "previews the exact frame under the handle". More
    generally: `fastSeek` is imprecise by specification, so never use it
    anywhere in this project.
13. **Facebook re-pauses a video that no real gesture started.** A scripted
    `el.click()` on the play button leaves `paused: true`, and a bare
    `video.play()` does the same, so it is the site and not us. A real
    dispatched click plays and keeps playing. Use `h.clickBarControlReal` for
    anything gated on user activation.
14. **Facebook has two player surfaces and the suite only drives one.** The
    fixture is a Reel permalink, and Facebook now redirects classic
    `/<page>/videos/<id>` permalinks to `/reel/<id>` as well, so nothing in
    the suite reaches a feed post. The two DOMs differ in ways that break
    structural selectors written against one of them:
    - A feed post's player group does **not** contain the `<video>` element —
      it sits in a sibling subtree — so `ancestor.contains(video)` never fires
      while walking up. On a Reel it does. Any walk out of the player needs a
      size guard as well.
    - Facebook builds its controls as `[role="button"]` divs, never real
      `<button>` elements, on both surfaces. A selector using `:has(button)`
      matches nothing. The CSS shift rule in `content.css` still uses one; it
      survives only because it matches on Instagram.
    - A feed post draws Play, Settings, Fullscreen and Unmute in a 44px row at
      the bottom of the video. A Reel draws no such row.
    This is how the overlapping-control-bars bug shipped. The decision the
    walk makes now lives in `core.isControlStripAncestor`, tested against
    measurements from both surfaces, because a browser spec cannot reach one
    of them.
15. **Hovering a feed video under CDP is unreliable.** The feed re-renders
    under a stationary pointer, so a dispatched `mouseMoved` reveals the bar
    perhaps one attempt in six. Retry the hover and assert a bar is actually
    revealed before measuring; a collision count of zero against a hidden bar
    is meaningless. Hidden bars also sit slid down by `translateY(100%)` at
    `opacity: 0`, so their rects overlap page content that nobody can see —
    filter on computed opacity and transform, not just on geometry.

## The userscript bundle

`dist/socials-video-controls.user.js` is the iOS delivery route, since iOS
cannot load an unpacked extension. It is **generated** from `content/`:

```bash
node tools/build-userscript.js                        # rebuild
node tools/build-userscript.js --check                 # non-zero if the committed copy is stale
node tools/build-userscript.js --dest ~/path/to/dir    # also copy into a manager's directory
```

`--dest` (or `IGVC_USERSCRIPT_DEST`) saves a manual copy while iterating. Never
commit a personal path for it.

**If you change anything in `content/`, rebuild it.** The unit suite runs
`--check`, so forgetting fails `node tests/run.js` with the command to fix it.
`--check` compares in memory without writing: building first and then comparing
would be a check that cannot fail.

Do not hand-maintain a second copy of the logic. The suites only cover
`content/`, so a forked bundle would be untested code shipped to a device.

To run the browser suite against the bundle rather than the loose files:

```bash
IGVC_USERSCRIPT=1 node tests/browser/run.js --site=instagram
```

Worth doing after touching the bundle's own concerns, which can break
independently of the extension: runtime CSS injection under the page's CSP, the
`localStorage` storage shim, and everything arriving at `document-start`
instead of `document_idle`.

## Rules for changes

- **`core.js` stays DOM-free.** No `document`, no `window`, no browser APIs. It
  is the only part that can be tested without a browser, and that is worth
  protecting. Logic that can live there should.
- **Never widen `manifest.json` permissions without asking.** It currently holds
  `storage` and `scripting`, with hosts limited to Instagram and Facebook. The
  extension makes **no network requests at all**, which is the strongest thing
  it can say about itself in `PRIVACY.md`. Do not spend that casually.
- **Do not add `aria-label` selectors in English.** The CSS already depends on
  `"Adjust volume"`, `"Toggle audio"` and `"Video player"`, which break on a
  non-English Instagram UI. This is a known bug; do not deepen it.
- **Prefer measuring to reasoning** about either site. Both are
  MediaSource-backed, undocumented, and change without notice. Facebook reverts
  volume, re-pauses videos it did not start, and strips the URL fragment about
  1.3 seconds in. If a belief about site behaviour matters, verify it in a
  browser and write the number into a test or a comment.
- **Commit messages** follow Conventional Commits. Build and test before
  committing.

## Touch mode

Touch support lives in the same files as everything else, keyed off input
capability at runtime. There is no separate touch build, and there must not be:
delivery and input are independent axes. An iPad with a keyboard wants the
desktop bar through a userscript; a touchscreen laptop wants touch through the
extension. A build-time split gets both wrong, and a forked copy would be
untested code, since the suites only cover `content/`.

The gate is one constant, read in one place:

```js
const TOUCH = Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches);
document.documentElement.classList.toggle('ig-vc-touch', TOUCH);
```

`(hover: none) and (pointer: coarse)` rather than `pointer: coarse` alone, so a
touchscreen laptop driven by a trackpad keeps the desktop bar. Turning the whole
redesign off is a one-line edit.

Three rules keep desktop safe, and a change that breaks one should be rejected:

1. **Every touch CSS rule is scoped under `.ig-vc-touch`** (a class on `html`).
   The only unscoped additions hide the two new elements -- `.ig-vc-step` and
   `.ig-vc-loop-onoff` -- which is the safe direction.
2. **Every touch JS branch is guarded by `TOUCH`.** New code is added alongside
   existing branches, never inside them.
3. **The desktop specs are the regression gate.** They run unchanged; passing
   means desktop is unchanged.

Measured under iPhone emulation: bar 28px -> 86px and two rows, buttons
22px -> 40px, frame-step buttons shown, in-menu loop toggle shown. On desktop
every one of those is unchanged.

`html.ig-vc-no-clip` is set when `HTMLMediaElement.prototype.captureStream` is
missing, which hides clip export on iOS rather than offering a control that
cannot work.

### Provenance

Touch mode was developed separately in `~/iphone_app/socials-ext`, a `git
archive` copy of this repository taken at `1c775ff`. It was brought in as a
three-way merge against that fork point rather than copied over, because this
repository had moved three commits ahead and a copy would have silently
reverted Facebook replace mode. `core.js` and `manifest.json` were untouched by
the import.

If you port more from that project, do the same: diff against the commit in its
`UPSTREAM_COMMIT`, never copy the files.

## When a bug does not reproduce in Chromium

This suite drives Chromium only. The extension's users are increasingly on
WebKit, where several reported bugs have lived, and four consecutive reports
have failed to reproduce here.

**Do not ship a speculative fix for one.** It was tried: a guard was added for
an unreproducible "play button does nothing" report, the reporter came back
saying the symptom was worse, and the guard had to be reverted. An unverified
fix in a file this size costs more than the bug, because it adds a path nobody
has observed and makes the next report harder to reason about.

Instead:

1. Reproduce the MECHANISM, not the bug. `fastSeek` was found this way: the
   code branched on an API Chromium lacks, so a stand-in was installed and the
   broken branch measured (0.89s of drift). That is a fix with evidence behind
   it, not a guess.
2. Ask the reporter for the state when it happens. `tools/diagnose.js` is a
   paste-into-the-console recorder that logs every media event, the bar's own
   state, and the stack of whatever called `play()` or `pause()`. It turns their
   browser into the measuring instrument.
3. Say plainly that it does not reproduce, and what that means, rather than
   implying a fix is verified when it is not.

## Known flakes

- **`bar layout > plays and pauses from the bar` on Facebook** can fail in a
  full run and pass twice out of two in isolation. Facebook re-pauses a video
  that no genuine gesture started, and whether it does so depends on what the
  previous test left the player doing. Re-run in isolation before believing it.
- **`loop in the URL > applies the loop from the URL to the player`** can fail
  in bundle mode when run directly after other URL-loop tests, then pass three
  times out of three in isolation. A URL loop is consumed by the first player
  that can take it, and the bundle initialises earlier than the extension does,
  so a neighbouring player can claim it first. Re-run in isolation before
  treating it as a real failure.

## Known gaps

Live issues, so a red test here may be expected rather than new:

- **Instagram's seek track collapses to ~48px** on a narrow (338px) player,
  which is too small to place markers accurately. Several marker specs skip on
  Instagram for this reason, reporting the measured track width. Fixing it
  needs container queries to drop controls at narrow widths.
- **English-only `aria-label` selectors**, as above.
- **No browser coverage of Facebook's feed**, which is where most videos are
  actually watched. See harness trap 14: the suite cannot reach a feed post,
  and hover there is too flaky to assert against. Changes to the Facebook
  adapter's structural walks need a manual check on `https://www.facebook.com/`
  as well as on the Reel fixture.
- **Facebook's Reel navigation arrows sit on our end buttons.** The Previous
  and Next items buttons are 40x40 and straddle the video's bottom edge, at the
  same x as our jump-to-A and fullscreen buttons. Measured on the Reel fixture;
  not yet fixed. Insetting our end buttons on Facebook is the likely fix rather
  than hiding their navigation.

## Measurements worth keeping

Numbers that cost a browser session to obtain, and that a future change should
not have to rediscover:

- Both sites stream through **MediaSource**. There is no file to pre-download,
  which is why the cache feature was removed and why a second `<video>` pointed
  at the page's source loads nothing.
- Facebook strips the URL fragment at about **1314ms**, before
  `DOMContentLoaded` at ~1468ms. Instagram keeps it indefinitely. The stripping
  applies only to the fragment present on load: a `history.replaceState` write
  after the page settles persists on both sites. An earlier reading of this
  concluded writing was futile on Facebook, which was wrong.
- Facebook **no longer reverts volume**: re-measured on a live Reel it holds
  0.3 across twelve samples over three seconds. It used to revert within about
  a second, which is why Facebook ran in augment mode; that constraint is gone.
  It still re-pauses videos no real gesture started. `playbackRate` and `muted`
  stick.
- Facebook's progress slider is a **654x20** strip at the video's bottom edge
  whose container holds no buttons, one level inside the 670x1191 player that
  holds 29. That gap is what makes it safe to hide structurally. Their mute
  button is a 44x44 overlay at the TOP-left, so it does not collide with our
  bar and is left alone.
- No site uses **augment mode** now. The mode is one field in the adapter, but
  removing it means unpicking `augmenting` branches in `sync()`,
  `stopLoopWatcher()` and `endScrub()`, which was not worth mixing into a
  behaviour switch.
- Instagram's player on a single-post page is **338px** wide with a seek track
  that collapses to **48px**. Facebook's reel player is **670px** with a 150px
  track.
- Theater mode before the sizing fix rendered the video at its intrinsic
  **360x640 in a 1279px-tall window** — 51% of the available height — with the
  control bar dead at `opacity: 0` from every pointer position.
- A B marker at the end of the video left **1px** of track behind it before the
  end padding; 21px after.
- The end padding has to be reported on the view (`padSeconds`) and subtracted
  before any zoom decision. Measuring the padded width against the 5s zoom cap
  meant a padded window never counted as capped, so a tight loop recomputed on
  every call and the timeline appeared to stick.
