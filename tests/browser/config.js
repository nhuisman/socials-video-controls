'use strict';

// Fixture videos the browser suite drives.
//
// These are real posts, so they can be deleted or made private by their owners
// at any time. When a fixture stops loading, the suite skips rather than fails,
// and the URL can be replaced here or overridden by environment variable
// without touching any spec.

module.exports = {
  port: Number(process.env.IGVC_CDP_PORT || 9223),

  sites: {
    instagram: {
      label: 'Instagram',
      // A single post page, where the path carries the shortcode.
      url: process.env.IGVC_INSTAGRAM_URL || 'https://www.instagram.com/p/Dfo3mUzgJQJ/',
      // Instagram gets the full control bar.
      expectedMode: 'replace'
    },
    facebook: {
      label: 'Facebook',
      url: process.env.IGVC_FACEBOOK_URL || 'https://www.facebook.com/reel/1046756455114845',
      // Facebook currently runs in augment mode: its own player stays, and the
      // extension contributes only what it lacks. If that changes, change this.
      expectedMode: 'augment'
    }
  },

  // Recording is real time, so clip specs mark a deliberately short loop.
  clipLoopSeconds: 2.5,

  // How long to let a site settle after navigation before looking for a player.
  settleMs: Number(process.env.IGVC_SETTLE_MS || 10000)
};
