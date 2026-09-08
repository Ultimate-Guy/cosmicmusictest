(() => {
  const CONFIG = window.COSMIC_MUSIC_CONFIG || {};
  let root;
  let tracks = [];
  let queue = [];
  let currentIndex = -1;
  let currentTrack = null;
  let mounted = false;
  const audio = new Audio();
  audio.preload = "metadata";
  audio.volume = 0.8;

  const esc = (value = "") => String(value).replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const fmt = seconds => {
    if (!Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };
  const readStorage = key => {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  };
  const saveStorage = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const state = {
    view: "browse",
    query: "",
    favorites: readStorage("cosmicMusicFavorites"),
    recent: readStorage("cosmicMusicRecent"),
    repeat: false,
    shuffle: false
  };

  function mount(target) {
    if (!target) return;
    root = target;
    renderShell();
    bindShell();
    renderPlayer();
    mounted = true;
    loadBrowse();
  }

  function renderShell() {
    root.innerHTML = `
      <section class="cosmic-music">
        <aside class="music-sidebar">
          <div class="music-logo"><span class="logo-dot"></span>COSMIC <b>MUSIC</b></div>
          <div class="sidebar-label">LIBRARY</div>
          <nav class="music-nav" aria-label="Music navigation">
            <button data-view="browse" class="active"><span>⌂</span> Music</button>
            <button data-view="discover"><span>✦</span> Discover</button>
            <button data-view="search"><span>⌕</span> Search</button>
            <button data-view="favorites"><span>♡</span> Favorites</button>
            <button data-view="recent"><span>◷</span> Recent</button>
            <button data-view="queue"><span>≡</span> Queue</button>
          </nav>
          <div class="sidebar-label sidebar-playlists">PLAYLISTS</div>
          <div class="playlist-note">Your playlists can be added here later without changing the player API.</div>
        </aside>

        <div class="music-main">
          <header class="music-header">
            <div class="music-search">
              <span class="search-icon">⌕</span>
              <input id="music-search" type="search" placeholder="What do you want to listen to?" autocomplete="off">
            </div>
            <button class="icon-btn" id="refresh-music" title="Refresh catalog">↻</button>
            <button class="icon-btn" id="shuffle-music" title="Shuffle">⤨</button>
            <button class="icon-btn" id="theme-music" title="Toggle player glow">◐</button>
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
      if (state.view === "favorites") renderTracks(state.favorites, "Favorites", "Tracks you saved for later.");
      else if (state.view === "recent") renderTracks(state.recent, "Recently played", "Your last played tracks are kept locally in this browser.");
      else if (state.view === "queue") renderQueue();
      else if (state.view === "search") runSearch(state.query);
      else if (state.view === "discover") loadDiscover();
      else loadBrowse();
    }));

    const search = root.querySelector("#music-search");
    search.addEventListener("input", () => {
      state.query = search.value.trim();
      if (state.query) {
        state.view = "search";
        setActiveView("search");
        runSearch(state.query);
      } else {
        state.view = "browse";
        setActiveView("browse");
        loadBrowse();
      }
    });

    root.querySelector("#refresh-music").addEventListener("click", () => state.view === "discover" ? loadDiscover() : loadBrowse());
    root.querySelector("#shuffle-music").addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      root.querySelector("#shuffle-music").classList.toggle("active", state.shuffle);
      if (state.shuffle) shuffle();
    });
    root.querySelector("#theme-music").addEventListener("click", () => root.querySelector(".cosmic-music").classList.toggle("soft-glow"));

    audio.addEventListener("timeupdate", renderPlayerProgress);
    audio.addEventListener("loadedmetadata", renderPlayerProgress);
    audio.addEventListener("play", renderPlayer);
    audio.addEventListener("pause", renderPlayer);
    audio.addEventListener("ended", handleEnded);
  }

  function setActiveView(view) {
    root.querySelectorAll("[data-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  }

  async function loadBrowse() {
    renderLoading("Browse", "Finding something good to play...");
    if (!CONFIG.jamendoClientId) return renderSetup();
    try {
      const groups = await Promise.all([
        requestTracks({ featured: 1, order: "popularity_total", groupby: "artist_id", limit: 10 }),
        requestTracks({ tags: "pop", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 10 }),
        requestTracks({ tags: "electronic", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 10 }),
        requestTracks({ tags: "relaxation", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 10 })
      ]);
      tracks = uniqueTracks(groups.flat());
      renderBrowse(groups[0], groups[1], groups[2], groups[3]);
    } catch (error) {
      renderError(error);
    }
  }

  async function loadDiscover() {
    renderLoading("Discover", "Mixing genres and moods from the catalog...");
    if (!CONFIG.jamendoClientId) return renderSetup("Discover is ready too — add your Jamendo client ID in js/config.js to enable live results.");
    try {
      const groups = await Promise.all([
        requestTracks({ tags: "rock", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 8 }),
        requestTracks({ tags: "classical", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 8 }),
        requestTracks({ tags: "hiphop", featured: 1, groupby: "artist_id", boost: "popularity_month", limit: 8 }),
        requestTracks({ fuzzytags: "k-pop pop", boost: "popularity_month", limit: 8 })
      ]);
      tracks = uniqueTracks(groups.flat());
      renderDiscover(groups);
    } catch (error) {
      renderError(error);
    }
  }

  async function runSearch(query) {
    if (!query) return loadBrowse();
    renderLoading("Search", `Searching for “${query}”...`);
    if (!CONFIG.jamendoClientId) return renderSetup("Search is ready, but the Jamendo client ID is not configured yet.");
    try {
      const results = await requestTracks({ search: query, limit: CONFIG.defaultLimit || 18 });
      tracks = uniqueTracks(results);
      renderTracks(results, `Results for “${query}”`, `${results.length} result${results.length === 1 ? "" : "s"} from the music catalog.`);
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
      audioformat: "mp32",
      ...params
    });
    const response = await fetch(`${CONFIG.apiBase || "https://api.jamendo.com/v3.0"}/tracks/?${query}`);
    if (!response.ok) throw new Error(`Music catalog request failed (${response.status}).`);
    const data = await response.json();
    if (data.headers?.status !== "success") throw new Error(data.headers?.error_message || "The music catalog returned an error.");
    return (data.results || []).map(normalizeTrack).filter(track => track.audio);
  }

  function normalizeTrack(track) {
    return {
      id: String(track.id),
      title: track.name || "Untitled",
      artist: track.artist_name || "Unknown artist",
      album: track.album_name || "Single",
      image: track.image || track.album_image || "",
      audio: track.audio || "",
      duration: Number(track.duration) || 0,
      license: track.license_ccurl || "",
      tags: track.musicinfo?.tags?.genres || []
    };
  }

  function uniqueTracks(items) {
    const map = new Map();
    items.forEach(track => map.set(String(track.id), track));
    return [...map.values()];
  }

  function renderLoading(title, subtitle) {
    root.querySelector("#music-content").innerHTML = `
      <div class="hero loading-hero">
        <div><span class="eyebrow">COSMIC MUSIC</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
        <div class="loading-orb"></div>
      </div>
      <div class="skeleton-row">${Array.from({length: 6}, () => `<div class="skeleton-card"></div>`).join("")}</div>`;
  }

  function renderSetup(message = "Connect the Jamendo catalog to make this player live.") {
    root.querySelector("#music-content").innerHTML = `
      <div class="hero">
        <div><span class="eyebrow">COSMIC MUSIC</span><h1>Your music hub.</h1><p>Browse, search, favorite, queue, and play music from an external catalog.</p></div>
        <div class="hero-badge">EXTERNAL CATALOG</div>
      </div>
      <div class="notice setup-notice">
        <strong>One setup step left.</strong>
        <p>${esc(message)}</p>
        <p>Add your Jamendo API client ID to <code>js/config.js</code>. The player already supports external stream URLs, search, genre discovery, favorites, recent tracks, queue, shuffle, repeat, volume, and progress controls.</p>
      </div>
      <section class="section"><div class="section-heading"><div><h2>Plug-in ready</h2><p>This component mounts inside one Cosmic container, so the lessons page can open it as a Music overlay later.</p></div></div></section>`;
  }

  function renderError(error) {
    root.querySelector("#music-content").innerHTML = `<div class="notice error-notice"><strong>Music could not load.</strong><p>${esc(error.message || error)}</p><button class="text-button" id="retry-music">Try again</button></div>`;
    root.querySelector("#retry-music")?.addEventListener("click", loadBrowse);
  }

  function renderBrowse(top, pop, electronic, chill) {
    const content = root.querySelector("#music-content");
    content.innerHTML = `
      <div class="hero">
        <div><span class="eyebrow">GOOD EVENING</span><h1>Browse</h1><p>Find something to soundtrack your Cosmic session.</p></div>
        <button class="hero-action" id="hero-shuffle">⤨ Shuffle something</button>
      </div>
      ${sectionMarkup("Top Hits", "Popular tracks from the featured catalog.", "top-tracks")}
      ${sectionMarkup("Pop Picks", "Bright, catchy tracks to keep things moving.", "pop-tracks")}
      ${sectionMarkup("Electronic", "Electronic selections with a late-night Cosmic feel.", "electronic-tracks")}
      ${sectionMarkup("Chill & Relax", "Slower picks for focus and cooldowns.", "chill-tracks")}`;
    renderCardRow(content.querySelector("#top-tracks"), top);
    renderCardRow(content.querySelector("#pop-tracks"), pop);
    renderCardRow(content.querySelector("#electronic-tracks"), electronic);
    renderCardRow(content.querySelector("#chill-tracks"), chill);
    content.querySelector("#hero-shuffle")?.addEventListener("click", () => shuffle(top.concat(pop, electronic, chill)));
  }

  function renderDiscover(groups) {
    const content = root.querySelector("#music-content");
    content.innerHTML = `
      <div class="hero compact-hero"><div><span class="eyebrow">DISCOVERY MODE</span><h1>Discover</h1><p>Explore different corners of the catalog.</p></div></div>
      ${sectionMarkup("Rock", "Guitars, drums, and bigger energy.", "discover-rock")}
      ${sectionMarkup("Classical", "Instrumental and orchestral selections.", "discover-classical")}
      ${sectionMarkup("Hip-Hop", "Beat-driven picks from the catalog.", "discover-hiphop")}
      ${sectionMarkup("K-Pop search", "Tracks returned by the catalog's K-pop/pop tagging.", "discover-kpop")}`;
    ["rock", "classical", "hiphop", "kpop"].forEach((name, i) => renderCardRow(content.querySelector(`#discover-${name}`), groups[i]));
  }

  function sectionMarkup(title, subtitle, id) {
    return `<section class="section"><div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="section-link" data-section="${esc(id)}">See all</button></div><div class="card-row" id="${esc(id)}"></div></section>`;
  }

  function renderTracks(items, title, subtitle = "") {
    const content = root.querySelector("#music-content");
    content.innerHTML = `<div class="page-heading"><span class="eyebrow">YOUR LIBRARY</span><h1>${esc(title)}</h1><p>${esc(subtitle || `${items.length} track${items.length === 1 ? "" : "s"}`)}</p></div><section class="section"><div class="track-list" id="track-results"></div></section>`;
    renderTrackList(content.querySelector("#track-results"), items);
  }

  function renderQueue() {
    renderTracks(queue, "Queue", queue.length ? `${queue.length} track${queue.length === 1 ? "" : "s"} queued.` : "Play a track to start building your queue.");
  }

  function renderCardRow(container, items = []) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<div class="notice mini-notice">No tracks were returned for this section.</div>`;
      return;
    }
    container.innerHTML = items.map(track => `
      <article class="track-card" data-track-id="${esc(track.id)}">
        <div class="cover">${track.image ? `<img src="${esc(track.image)}" alt="" loading="lazy">` : `<span>♪</span>`}<button class="card-play" aria-label="Play ${esc(track.title)}">▶</button></div>
        <div class="track-title">${esc(track.title)}</div>
        <div class="track-artist">${esc(track.artist)}</div>
      </article>`).join("");
    container.querySelectorAll(".track-card").forEach(card => card.addEventListener("click", () => {
      const track = findTrack(card.dataset.trackId);
      if (track) play(track);
    }));
  }

  function renderTrackList(container, items = []) {
    if (!items.length) {
      container.innerHTML = `<div class="notice">Nothing here yet.</div>`;
      return;
    }
    container.innerHTML = items.map((track, index) => `
      <button class="list-track" data-track-id="${esc(track.id)}">
        <span class="list-number">${index + 1}</span>
        ${track.image ? `<img src="${esc(track.image)}" alt="" loading="lazy">` : `<span class="list-cover">♪</span>`}
        <span class="list-main"><b>${esc(track.title)}</b><small>${esc(track.artist)} · ${esc(track.album)}</small></span>
        <span class="list-duration">${fmt(track.duration)}</span>
        <span class="list-play">▶</span>
      </button>`).join("");
    container.querySelectorAll(".list-track").forEach(button => button.addEventListener("click", () => {
      const track = findTrack(button.dataset.trackId);
      if (track) play(track);
    }));
  }

  function findTrack(id) {
    return [...tracks, ...queue, ...state.favorites, ...state.recent].find(t => String(t.id) === String(id));
  }

  function play(track, source = []) {
    if (!track?.audio) return;
    currentTrack = track;
    const pool = source.length ? source : tracks;
    if (state.shuffle && pool.length > 1) {
      queue = [track, ...shuffleArray(pool.filter(t => String(t.id) !== String(track.id)))];
    } else {
      queue = [track, ...queue.filter(t => String(t.id) !== String(track.id))];
    }
    currentIndex = 0;
    audio.src = track.audio;
    audio.play().catch(() => {});
    addRecent(track);
    renderPlayer();
  }

  function addRecent(track) {
    state.recent = [track, ...state.recent.filter(t => String(t.id) !== String(track.id))].slice(0, 20);
    saveStorage("cosmicMusicRecent", state.recent);
  }

  function toggleFavorite() {
    if (!currentTrack) return;
    const exists = state.favorites.some(t => String(t.id) === String(currentTrack.id));
    state.favorites = exists
      ? state.favorites.filter(t => String(t.id) !== String(currentTrack.id))
      : [currentTrack, ...state.favorites];
    saveStorage("cosmicMusicFavorites", state.favorites);
    renderPlayer();
  }

  function handleEnded() {
    if (state.repeat) return playCurrent();
    next();
  }

  function playCurrent() {
    if (!currentTrack?.audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function next() {
    if (!queue.length) return;
    if (state.shuffle && queue.length > 1) currentIndex = Math.floor(Math.random() * queue.length);
    else currentIndex = (currentIndex + 1) % queue.length;
    const track = queue[currentIndex];
    if (!track?.audio) return;
    currentTrack = track;
    audio.src = track.audio;
    audio.play().catch(() => {});
    addRecent(track);
    renderPlayer();
  }

  function previous() {
    if (!queue.length) return;
    if (audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    currentIndex = (currentIndex - 1 + queue.length) % queue.length;
    const track = queue[currentIndex];
    if (!track?.audio) return;
    currentTrack = track;
    audio.src = track.audio;
    audio.play().catch(() => {});
    renderPlayer();
  }

  function shuffle(pool = tracks) {
    const available = pool.filter(t => t.audio);
    if (!available.length) return;
    const track = available[Math.floor(Math.random() * available.length)];
    state.shuffle = true;
    root.querySelector("#shuffle-music")?.classList.add("active");
    play(track, available);
  }

  function shuffleArray(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function renderPlayer() {
    if (!mounted && !root) return;
    const player = root.querySelector("#music-player");
    if (!player) return;
    if (!currentTrack) {
      player.innerHTML = `<div class="now-playing"><div class="mini-cover"></div><div class="player-meta"><div class="track-title">Nothing playing</div><div class="track-artist">Choose a track to start</div></div></div><div class="player-center"><div class="player-controls"><button disabled>◀</button><button class="play" disabled>▶</button><button disabled>▶</button></div><div class="progress-wrap"><span>0:00</span><input type="range" min="0" max="100" value="0" disabled><span>0:00</span></div></div><div class="player-options">Ready</div>`;
      return;
    }

    const favorite = state.favorites.some(t => String(t.id) === String(currentTrack.id));
    player.innerHTML = `
      <div class="now-playing">
        ${currentTrack.image ? `<img class="mini-cover" src="${esc(currentTrack.image)}" alt="">` : `<div class="mini-cover">♪</div>`}
        <div class="player-meta"><div class="track-title">${esc(currentTrack.title)}</div><div class="track-artist">${esc(currentTrack.artist)}</div></div>
        <button class="heart-btn ${favorite ? "liked" : ""}" id="favorite-track" title="Favorite">${favorite ? "♥" : "♡"}</button>
      </div>
      <div class="player-center">
        <div class="player-controls">
          <button id="shuffle-track" class="control-toggle ${state.shuffle ? "active" : ""}" title="Shuffle">⤨</button>
          <button id="previous-track" title="Previous">◀</button>
          <button class="play" id="toggle-play" title="Play/Pause">${audio.paused ? "▶" : "Ⅱ"}</button>
          <button id="next-track" title="Next">▶</button>
          <button id="repeat-track" class="control-toggle ${state.repeat ? "active" : ""}" title="Repeat">↻</button>
        </div>
        <div class="progress-wrap"><span id="current-time">0:00</span><input id="progress" type="range" min="0" max="100" value="0"><span id="total-time">${fmt(currentTrack.duration)}</span></div>
      </div>
      <div class="player-options"><span>🔊</span><input class="volume" id="volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}"></div>`;

    player.querySelector("#favorite-track").addEventListener("click", toggleFavorite);
    player.querySelector("#previous-track").addEventListener("click", previous);
    player.querySelector("#next-track").addEventListener("click", next);
    player.querySelector("#shuffle-track").addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      renderPlayer();
    });
    player.querySelector("#repeat-track").addEventListener("click", () => {
      state.repeat = !state.repeat;
      renderPlayer();
    });
    player.querySelector("#toggle-play").addEventListener("click", () => {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
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
