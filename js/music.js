(() => {
  const CONFIG = window.COSMIC_MUSIC_CONFIG || {};
  let root;
  let tracks = [];
  let queue = [];
  let currentIndex = -1;
  let currentTrack = null;
  const audio = new Audio();
  audio.preload = "metadata";

  const state = {
    view: "browse",
    query: "",
    favorites: JSON.parse(localStorage.getItem("cosmicMusicFavorites") || "[]"),
    recent: JSON.parse(localStorage.getItem("cosmicMusicRecent") || "[]")
  };

  const esc = (value = "") => String(value).replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmt = seconds => {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  function mount(target) {
    root = target;
    renderShell();
    bindShell();
    renderPlayer();
    loadBrowse();
  }

  function renderShell() {
    root.innerHTML = `
      <section class="cosmic-music">
        <aside class="music-sidebar">
          <div class="music-logo">COSMIC <span>MUSIC</span></div>
          <nav class="music-nav" aria-label="Music navigation">
            <button data-view="browse" class="active">Music</button>
            <button data-view="browse">Browse</button>
            <button data-view="search">Search</button>
            <button data-view="favorites">Favorites</button>
            <button data-view="recent">Recent</button>
            <button data-view="queue">Queue</button>
          </nav>
        </aside>
        <div class="music-main">
          <header class="music-header">
            <div class="music-search">
              <span class="search-icon">⌕</span>
              <input id="music-search" type="search" placeholder="Search songs, artists, albums..." autocomplete="off">
            </div>
            <button class="icon-btn" id="refresh-music" title="Refresh">↻</button>
            <button class="icon-btn" id="shuffle-music" title="Shuffle">⤨</button>
          </header>
          <div class="music-content" id="music-content"></div>
        </div>
        <div class="music-player" id="music-player"></div>
      </section>`;
  }

  function bindShell() {
    root.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      root.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("active", x === btn));
      if (state.view === "favorites") renderTracks(state.favorites, "Favorites");
      else if (state.view === "recent") renderTracks(state.recent, "Recently played");
      else if (state.view === "queue") renderTracks(queue, "Queue");
      else if (state.view === "search") runSearch(state.query);
      else loadBrowse();
    }));

    const search = root.querySelector("#music-search");
    search.addEventListener("input", () => {
      state.query = search.value.trim();
      if (state.query) {
        state.view = "search";
        runSearch(state.query);
      } else {
        state.view = "browse";
        loadBrowse();
      }
    });

    root.querySelector("#refresh-music").addEventListener("click", loadBrowse);
    root.querySelector("#shuffle-music").addEventListener("click", shuffle);
    audio.addEventListener("timeupdate", renderPlayerProgress);
    audio.addEventListener("loadedmetadata", renderPlayerProgress);
    audio.addEventListener("ended", next);
  }

  async function loadBrowse() {
    renderLoading("Browse");
    if (!CONFIG.jamendoClientId) {
      renderSetup();
      return;
    }
    try {
      tracks = await requestTracks({ featured: "featured", order: "popularity_total", limit: CONFIG.defaultLimit || 18 });
      renderBrowse(tracks);
    } catch (error) {
      renderError(error);
    }
  }

  async function runSearch(query) {
    if (!query) return loadBrowse();
    renderLoading(`Search: ${query}`);
    if (!CONFIG.jamendoClientId) {
      renderSetup(`Search is ready, but the Jamendo client ID is not configured yet.`);
      return;
    }
    try {
      const results = await requestTracks({ search: query, limit: CONFIG.defaultLimit || 18 });
      tracks = results;
      renderTracks(results, `Results for “${query}”`);
    } catch (error) {
      renderError(error);
    }
  }

  async function requestTracks(params = {}) {
    const query = new URLSearchParams({
      client_id: CONFIG.jamendoClientId,
      format: "json",
      include: "musicinfo",
      imagesize: "300",
      ...params
    });
    const response = await fetch(`${CONFIG.apiBase}/tracks/?${query}`);
    if (!response.ok) throw new Error(`Music catalog request failed (${response.status}).`);
    const data = await response.json();
    if (data.headers?.status !== "success") throw new Error("The music catalog returned an error.");
    return (data.results || []).map(normalizeTrack);
  }

  function normalizeTrack(track) {
    return {
      id: String(track.id),
      title: track.name || "Untitled",
      artist: track.artist_name || "Unknown artist",
      album: track.album_name || "Unknown album",
      image: track.image || track.album_image || "",
      audio: track.audio || "",
      duration: Number(track.duration) || 0,
      license: track.license_ccurl || ""
    };
  }

  function renderLoading(title) {
    root.querySelector("#music-content").innerHTML = `<div class="music-title-row"><div><h1>${esc(title)}</h1><p>Loading the catalog…</p></div></div>`;
  }

  function renderSetup(message = "Connect the Jamendo catalog to make this player live.") {
    root.querySelector("#music-content").innerHTML = `
      <div class="music-title-row"><div><h1>Music</h1><p>A Cosmic-ready music player prototype.</p></div></div>
      <div class="notice">
        <strong>Catalog setup needed.</strong><br>
        ${esc(message)} Add your Jamendo API client ID to <code>js/config.js</code>. The player is already wired for external audio URLs, search, favorites, recent tracks, queue, shuffle, and playback controls.
      </div>
      <section class="section"><h2>How this plugs into Cosmic</h2><div class="notice">The UI is self-contained under <code>#cosmic-music-root</code>, so Cosmic can mount this same component inside a Music overlay without replacing the lessons page.</div></section>`;
  }

  function renderError(error) {
    root.querySelector("#music-content").innerHTML = `<div class="notice"><strong>Music could not load.</strong><br>${esc(error.message || error)}</div>`;
  }

  function renderBrowse(items) {
    const content = root.querySelector("#music-content");
    content.innerHTML = `
      <div class="music-title-row"><div><h1>Browse</h1><p>Discover music for your Cosmic sessions.</p></div></div>
      <section class="section"><h2>Top tracks</h2><div class="card-row" id="top-tracks"></div></section>
      <section class="section"><h2>More to explore</h2><div class="card-row" id="more-tracks"></div></section>`;
    renderCardRow(content.querySelector("#top-tracks"), items.slice(0, Math.min(9, items.length)));
    renderCardRow(content.querySelector("#more-tracks"), items.slice(9));
  }

  function renderTracks(items, title) {
    const content = root.querySelector("#music-content");
    content.innerHTML = `<div class="music-title-row"><div><h1>${esc(title)}</h1><p>${items.length} track${items.length === 1 ? "" : "s"}</p></div></div><section class="section"><div class="card-row" id="track-results"></div></section>`;
    renderCardRow(content.querySelector("#track-results"), items);
  }

  function renderCardRow(container, items) {
    if (!items.length) {
      container.innerHTML = `<div class="notice">Nothing here yet.</div>`;
      return;
    }
    container.innerHTML = items.map(track => `
      <article class="track-card" data-track-id="${esc(track.id)}">
        <div class="cover">${track.image ? `<img src="${esc(track.image)}" alt="">` : ""}</div>
        <div class="track-title">${esc(track.title)}</div>
        <div class="track-artist">${esc(track.artist)}</div>
      </article>`).join("");
    container.querySelectorAll(".track-card").forEach(card => card.addEventListener("click", () => {
      const track = findTrack(card.dataset.trackId);
      if (track) play(track);
    }));
  }

  function findTrack(id) {
    return [...tracks, ...queue, ...state.favorites, ...state.recent].find(t => String(t.id) === String(id));
  }

  function play(track) {
    if (!track.audio) return;
    currentTrack = track;
    queue = [track, ...queue.filter(t => String(t.id) !== String(track.id))];
    currentIndex = 0;
    audio.src = track.audio;
    audio.play().catch(() => {});
    addRecent(track);
    renderPlayer();
  }

  function addRecent(track) {
    state.recent = [track, ...state.recent.filter(t => String(t.id) !== String(track.id))].slice(0, 20);
    localStorage.setItem("cosmicMusicRecent", JSON.stringify(state.recent));
  }

  function toggleFavorite() {
    if (!currentTrack) return;
    const exists = state.favorites.some(t => String(t.id) === String(currentTrack.id));
    state.favorites = exists
      ? state.favorites.filter(t => String(t.id) !== String(currentTrack.id))
      : [currentTrack, ...state.favorites];
    localStorage.setItem("cosmicMusicFavorites", JSON.stringify(state.favorites));
    renderPlayer();
  }

  function next() {
    if (!queue.length) return;
    const nextIndex = (currentIndex + 1) % queue.length;
    currentIndex = nextIndex;
    const track = queue[currentIndex];
    if (track?.audio) {
      currentTrack = track;
      audio.src = track.audio;
      audio.play().catch(() => {});
      addRecent(track);
      renderPlayer();
    }
  }

  function previous() {
    if (!queue.length) return;
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    currentIndex = prevIndex;
    const track = queue[currentIndex];
    if (track?.audio) {
      currentTrack = track;
      audio.src = track.audio;
      audio.play().catch(() => {});
      renderPlayer();
    }
  }

  function shuffle() {
    const pool = tracks.filter(t => t.audio);
    if (!pool.length) return;
    const track = pool[Math.floor(Math.random() * pool.length)];
    play(track);
  }

  function renderPlayer() {
    const player = root.querySelector("#music-player");
    if (!currentTrack) {
      player.innerHTML = `<div class="now-playing"><div class="mini-cover"></div><div class="player-meta"><div class="track-title">Nothing playing</div><div class="track-artist">Choose a track to start</div></div></div><div class="player-controls"><button class="play" disabled>▶</button></div><div class="player-right">Ready</div>`;
      return;
    }
    const favorite = state.favorites.some(t => String(t.id) === String(currentTrack.id));
    player.innerHTML = `
      <div class="now-playing">
        ${currentTrack.image ? `<img class="mini-cover" src="${esc(currentTrack.image)}" alt="">` : `<div class="mini-cover"></div>`}
        <div class="player-meta"><div class="track-title">${esc(currentTrack.title)}</div><div class="track-artist">${esc(currentTrack.artist)}</div></div>
        <button class="icon-btn" id="favorite-track" title="Favorite">${favorite ? "♥" : "♡"}</button>
      </div>
      <div class="player-controls">
        <button id="previous-track" title="Previous">◀</button>
        <button class="play" id="toggle-play" title="Play/Pause">${audio.paused ? "▶" : "Ⅱ"}</button>
        <button id="next-track" title="Next">▶</button>
      </div>
      <div class="player-right">
        <div class="progress-wrap"><span id="current-time">0:00</span><input id="progress" type="range" min="0" max="100" value="0"><span id="total-time">${fmt(currentTrack.duration)}</span></div>
        <span>🔊</span><input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}">
      </div>`;
    player.querySelector("#favorite-track").addEventListener("click", toggleFavorite);
    player.querySelector("#previous-track").addEventListener("click", previous);
    player.querySelector("#next-track").addEventListener("click", next);
    player.querySelector("#toggle-play").addEventListener("click", () => {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      renderPlayer();
    });
    player.querySelector("#progress").addEventListener("input", e => {
      if (Number.isFinite(audio.duration)) audio.currentTime = (Number(e.target.value) / 100) * audio.duration;
    });
    player.querySelector("#volume").addEventListener("input", e => audio.volume = Number(e.target.value));
    renderPlayerProgress();
  }

  function renderPlayerProgress() {
    if (!root) return;
    const progress = root.querySelector("#progress");
    const current = root.querySelector("#current-time");
    const total = root.querySelector("#total-time");
    if (!progress || !current) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : (currentTrack?.duration || 0);
    progress.value = duration ? (audio.currentTime / duration) * 100 : 0;
    current.textContent = fmt(audio.currentTime);
    if (total) total.textContent = fmt(duration);
  }

  window.CosmicMusic = { mount };
})();
