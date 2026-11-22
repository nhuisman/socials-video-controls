# Privacy Policy for Socials Video Controls

**Last updated:** November 22, 2026  
**Developer:** Surya Kencana Putra (<surya@skp.my.id>)

This Privacy Policy explains how **Socials Video Controls** ("the Extension") handles your information. 

---

### 1. No Data Collection or Transmission
**Socials Video Controls does not collect, store, transmit, or share any personal information, browsing history, cookies, or account credentials.** 

- We do not run any remote analytics, telemetry, or tracking scripts.
- We do not transmit any information about you, your activity, or your device to anyone.
- We do not sell or monetize user data in any form.

The Extension makes exactly one kind of network request, and only when you ask it to: the optional video cache described in section 2 re-requests the video file you are already watching. No request is ever sent to a server operated by the developer or by any third party, and no data about you leaves your browser.

---

### 2. Permissions & Local Storage Usage
The Extension requires minimal browser permissions to operate:

- **`storage`**: Used solely to persist your chosen video preferences (playback volume, mute state, and playback speed) locally on your device via the browser's `chrome.storage.local` API. This data never leaves your browser.
- **`scripting`**: Used to attach the video control UI and styles into already-open Instagram tabs when the extension is installed or updated.
- **`*://*.instagram.com/*`** and **`*://*.facebook.com/*`**: Restricts the extension's execution strictly to Instagram and Facebook web pages, to inject the custom playback bar, listen for video element events, and enable seek, frame-stepping and fullscreen functionality. The Extension reads only video elements and their surrounding player markup. It does not read, collect or transmit your feed, messages, profile, friends, or any account information on either site.

No additional permissions are requested for the video cache feature.

---

### 2a. Optional Video Cache
The control bar includes a download button that pre-loads the current video so you can scrub through it without waiting. When — and only when — you click that button:

- The Extension re-requests **the same video file your browser is already playing**, from the same content delivery address the page itself used. It does not contact any other server.
- The request is sent **without cookies or credentials** (`credentials: 'omit'`).
- The downloaded video is held **in memory only** for the lifetime of that page. Nothing is written to disk, to `chrome.storage`, or to any database.
- The copy is discarded automatically when you click the button again, when you navigate away, or when the video scrolls out of view. It is never retained between page loads or browser sessions.
- Videos that Instagram streams in segments cannot be cached, and in that case the button reports that it is unavailable and no request is made at all.

Caching is never enabled automatically and is off by default.

---

### 3. Third-Party Services
The Extension operates entirely within your browser client and does not bundle or load any third-party analytics, advertisements, or tracking libraries. It contains no remote code, no `eval`, and no connection to any server other than the optional, user-initiated video request described in section 2a.

---

### 4. Changes to This Policy
If this Privacy Policy is updated in future releases, changes will be posted directly to this document with a revised "Last updated" date.

---

### 5. Contact
If you have questions regarding this Privacy Policy or the Extension, please reach out via email:
- **Email:** [surya@skp.my.id](mailto:surya@skp.my.id)
- **Website:** [https://skncana.skp.my.id](https://skncana.skp.my.id)
