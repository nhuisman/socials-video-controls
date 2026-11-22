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

The Extension makes no network requests of any kind. Everything it does happens locally in your browser.

---

### 2. Permissions & Local Storage Usage
The Extension requires minimal browser permissions to operate:

- **`storage`**: Used solely to persist your chosen video preferences (playback volume, mute state, playback speed, and loop practice speed) locally on your device via the browser's `chrome.storage.local` API. This data never leaves your browser.
- **`scripting`**: Used to attach the video control UI and styles into already-open Instagram tabs when the extension is installed or updated.
- **`*://*.instagram.com/*`** and **`*://*.facebook.com/*`**: Restricts the extension's execution strictly to Instagram and Facebook web pages, to inject the custom playback bar, listen for video element events, and enable seek, frame-stepping and fullscreen functionality. The Extension reads only video elements and their surrounding player markup. It does not read, collect or transmit your feed, messages, profile, friends, or any account information on either site.

No additional permissions are requested for the video cache feature.

---

### 2a. Clip Export
The loop controls can record the marked segment and save it as a video file:

- Recording captures the player's own output locally, in your browser. Nothing is uploaded, and no server is contacted.
- The file is saved by your browser's normal download mechanism, to wherever you have told it to put downloads.
- The recording exists only for as long as it takes to save and show it, and is discarded when you close the preview.

Recording never starts on its own; it happens only when you click the control.

### 2b. Page URL and Clipboard
The loop feature can share a marked segment as a link:

- The Extension reads the page's own URL fragment at page load, so a link such as `.../p/abc/#loop=30,34.5` opens at that loop. It reads the address of the page you are already on and nothing else; no browsing history and no other tabs are accessed.
- The **link** button writes a URL to your clipboard when you click it, and only then. That URL is the page you are viewing plus the loop times. Nothing is ever read from your clipboard, and nothing is transmitted anywhere.

---

### 3. Third-Party Services
The Extension operates entirely within your browser client and does not bundle or load any third-party analytics, advertisements, or tracking libraries. It contains no remote code, no `eval`, and makes no connection to any server.

---

### 4. Changes to This Policy
If this Privacy Policy is updated in future releases, changes will be posted directly to this document with a revised "Last updated" date.

---

### 5. Contact
If you have questions regarding this Privacy Policy or the Extension, please reach out via email:
- **Email:** [surya@skp.my.id](mailto:surya@skp.my.id)
- **Website:** [https://skncana.skp.my.id](https://skncana.skp.my.id)
