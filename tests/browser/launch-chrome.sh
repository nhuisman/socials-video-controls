#!/usr/bin/env bash
#
# Launches a Chrome the browser tests can drive over the DevTools protocol.
#
# Why a dedicated profile: since Chrome 136 the remote debugging port is
# silently ignored for the default profile. Without --user-data-dir you get a
# browser with no CDP endpoint and no error explaining why. The profile here is
# throwaway, which also keeps your real cookies and history out of reach of
# anything on the debug port.
#
# The port binds to 127.0.0.1 only, which is Chrome's default and what we want.
# Never add --remote-debugging-address: anything able to reach that port has
# full control of this browser profile, including its cookies.
#
#   ./tests/browser/launch-chrome.sh          # launch and wait
#   ./tests/browser/launch-chrome.sh --check  # only report whether it is up
#
set -uo pipefail

PORT="${IGVC_CDP_PORT:-9223}"
# Defaults to the profile this project has been using, which is already signed
# in to both sites. Override with IGVC_CDP_PROFILE for a clean one.
PROFILE="${IGVC_CDP_PROFILE:-$HOME/chrome-cdp-profile}"

find_chrome() {
  if [ -n "${IGVC_CHROME:-}" ]; then printf '%s' "$IGVC_CHROME"; return; fi
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
    "/usr/bin/google-chrome" \
    "/usr/bin/chromium" \
    "/usr/bin/chromium-browser"
  do
    [ -x "$candidate" ] && printf '%s' "$candidate" && return
  done
  printf ''
}

cdp_up() {
  curl -s --max-time 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1
}

if cdp_up; then
  echo "CDP already listening on 127.0.0.1:${PORT}"
  curl -s --max-time 2 "http://127.0.0.1:${PORT}/json/version" | sed 's/^/  /'
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  echo "CDP is NOT listening on 127.0.0.1:${PORT}"
  exit 1
fi

CHROME="$(find_chrome)"
if [ -z "$CHROME" ]; then
  echo "Could not find Chrome or Chromium. Set IGVC_CHROME to its full path." >&2
  exit 1
fi

# A stale listener with no process behind it will refuse the bind. Report it
# rather than failing cryptically; killing someone's browser is not our call.
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} is held but not answering CDP. Inspect and clear it:" >&2
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >&2
  echo "Then re-run, or set IGVC_CDP_PORT to another port." >&2
  exit 1
fi

mkdir -p "$PROFILE"
echo "Chrome   : $CHROME"
echo "Profile  : $PROFILE"
echo "CDP port : 127.0.0.1:${PORT}"

"$CHROME" \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-popup-blocking \
  --autoplay-policy=no-user-gesture-required \
  about:blank \
  >/dev/null 2>&1 &

CHROME_PID=$!
for _ in $(seq 1 40); do
  if cdp_up; then
    echo
    echo "Ready (pid ${CHROME_PID})."
    echo
    echo "If this profile is signed out, log in to Instagram and Facebook in"
    echo "this window once; the profile persists, so later runs reuse it."
    echo
    echo "Then:  node tests/browser/run.js"
    exit 0
  fi
  sleep 0.25
done

echo "Chrome started but CDP never answered on ${PORT}." >&2
exit 1
