# Cosmic Music

A standalone music player prototype designed to be embedded into the Cosmic website.

## Current architecture

- `index.html` — standalone test page.
- `css/music.css` — Cosmic-style music UI.
- `js/config.js` — provider configuration.
- `js/music.js` — player, search, favorites, recent tracks, queue, shuffle, and UI mounting.

The component exposes:

```js
CosmicMusic.mount(document.getElementById('cosmic-music-root'));
```

That means the same component can later be mounted inside a Music overlay in `pages/lessons/lessons.html` without turning the lessons page into a separate music site.

## Music source

The prototype is prepared for the Jamendo API. It expects the API to provide track metadata plus a browser-playable audio URL. No MP3 collection needs to live in this repository.

Before using the live catalog, put the appropriate Jamendo API client ID in `js/config.js`. Do not put private server credentials in client-side code.

## Cosmic integration plan

1. Keep this repo as the music development/test environment.
2. Finish and test the player here.
3. Add a **Music** button beside **Apps** and **Settings** in Cosmic's lessons top bar.
4. Load the music CSS/JS into the lessons page.
5. Open the player in an overlay instead of navigating away from lessons.
6. Reuse the same `CosmicMusic` component so future changes can be tested here first.

The first version intentionally avoids modifying the main Cosmic repository until the music player is working reliably.
