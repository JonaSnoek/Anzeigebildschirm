/*
 * Digital Signage – Player für den Anzeigebildschirm.
 *
 * - Lädt Medienliste + Einstellungen über /api/display
 * - Bilder: Diashow mit konfigurierbarer Dauer und Fade-Übergang
 * - Videos: automatischer Start, danach weiter zur nächsten Datei
 * - Audio: Hintergrundmusik in Endlosschleife (falls aktiviert)
 * - Uhr: klein unten rechts bei Medien, groß mittig ohne Medien
 * - Aktualisiert die Daten alle 60 Sekunden
 */

"use strict";

(function () {
  const LAYER_A = document.getElementById("layer-a");
  const LAYER_B = document.getElementById("layer-b");
  const PLAYER = document.getElementById("player");
  const EMPTY = document.getElementById("empty-state");
  const SMALL_CLOCK = document.getElementById("clock-small");
  const BIG_CLOCK = document.getElementById("clock-big");
  const DATE_BIG = document.getElementById("date-big");
  const AUDIO = document.getElementById("bg-audio");

  const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  const state = {
    settings: {},
    items: [],       // Bilder + Videos (gemeinsame Playlist)
    audio: [],       // Audiodateien
    index: 0,
    timer: null,
    current: null,   // gerade sichtbare Ebene
    next: LAYER_A,   // unsichtbare Ebene für den nächsten Inhalt
    signature: "",
  };

  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- Uhr ---------- */
  function updateClock() {
    const now = new Date();
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const date = `${WEEKDAYS[now.getDay()]}, ${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
    SMALL_CLOCK.innerHTML = `${time}<span class="clock-date">${date}</span>`;
    BIG_CLOCK.textContent = time;
    DATE_BIG.textContent = date;
  }

  /* ---------- Einstellungen ---------- */
  function toInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function cfg() {
    return {
      slideDuration: toInt(state.settings.slide_duration, 8, 3, 300) * 1000,
      transition: state.settings.transition === "none" ? "none" : "fade",
      autoplay: state.settings.autoplay !== "false",
      loop: state.settings.loop !== "false",
      volume: toInt(state.settings.volume, 70, 0, 100) / 100,
      music: state.settings.music_enabled !== "false",
    };
  }

  const fadeMs = () => (cfg().transition === "none" ? 0 : 800);

  /* ---------- Hilfsfunktionen ---------- */
  function clearLayer(layer) {
    if (layer) layer.innerHTML = "";
  }

  function stopTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function visibleVideo() {
    return state.current ? state.current.querySelector("video") : null;
  }

  function setupAudio() {
    AUDIO.pause();
    AUDIO.removeAttribute("src");
    AUDIO.load();
    const s = cfg();
    if (s.music && state.audio.length) {
      AUDIO.src = state.audio[0].url;
      AUDIO.volume = s.volume;
      AUDIO.loop = true;
      AUDIO.play().catch(() => { /* Autoplay kann blockiert werden */ });
    }
  }

  /* ---------- Leerzustand / Player ---------- */
  function showEmpty() {
    stopTimer();
    const video = visibleVideo();
    if (video) video.pause();
    clearLayer(LAYER_A);
    clearLayer(LAYER_B);
    state.current = null;
    state.next = LAYER_A;
    PLAYER.classList.add("hidden");
    EMPTY.classList.remove("hidden");
    setupAudio();
  }

  function showPlayer() {
    EMPTY.classList.add("hidden");
    PLAYER.classList.remove("hidden");
  }

  /* ---------- Wiedergabe ---------- */
  function showCurrent() {
    const item = state.items[state.index];
    if (item.type === "video") renderVideo(item);
    else renderImage(item);
  }

  function renderImage(item) {
    const layer = state.next;
    clearLayer(layer);
    const img = document.createElement("img");
    img.className = "media";
    img.src = item.url;
    img.alt = item.name || "Bild";
    layer.appendChild(img);
    img.onload = () => { swap(layer); scheduleNext(); };
    img.onerror = () => skipToNext("Bild nicht ladbar: " + item.url);
  }

  function renderVideo(item) {
    const layer = state.next;
    clearLayer(layer);
    const video = document.createElement("video");
    video.className = "media";
    video.src = item.url;
    video.autoplay = true;
    video.playsInline = true;
    video.volume = cfg().volume;
    layer.appendChild(video);
    video.onplay = () => swap(layer);
    video.onended = () => next();
    video.onerror = () => skipToNext("Video nicht ladbar: " + item.url);
  }

  function scheduleNext() {
    if (!cfg().autoplay) return;
    stopTimer();
    state.timer = setTimeout(next, cfg().slideDuration + fadeMs());
  }

  function swap(layer) {
    stopTimer();
    const out = state.current;
    if (out) {
      const video = out.querySelector("video");
      if (video) video.pause();
      out.classList.remove("visible");
    }
    layer.classList.add("visible");
    state.current = layer;
    state.next = out || (layer === LAYER_A ? LAYER_B : LAYER_A);
    clearLayer(state.next);
  }

  function next() {
    const s = cfg();
    stopTimer();
    if (!s.autoplay) return;
    const len = state.items.length;
    if (len === 0) { showEmpty(); return; }
    if (state.index >= len - 1 && !s.loop) { showEmpty(); return; }
    state.index = (state.index + 1) % len;
    showCurrent();
  }

  function skipToNext(why) {
    if (why) console.warn(why);
    const len = state.items.length;
    if (len === 0) { showEmpty(); return; }
    state.index = (state.index + 1) % len;
    showCurrent();
  }

  /* ---------- Neuladen bei Änderungen ---------- */
  function restart() {
    stopTimer();
    const video = visibleVideo();
    if (video) video.pause();
    clearLayer(LAYER_A);
    clearLayer(LAYER_B);
    state.index = 0;
    state.current = null;
    state.next = LAYER_A;

    if (state.items.length === 0) {
      showEmpty();
    } else {
      showPlayer();
      setupAudio();
      showCurrent();
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/display", { cache: "no-store" });
      if (!res.ok) throw new Error("Anzeige-API nicht erreichbar");
      const data = await res.json();
      const signature = JSON.stringify([data.settings, data.media, data.audio]);
      const changed = signature !== state.signature;
      state.signature = signature;
      state.settings = data.settings || {};
      state.items = data.media || [];
      state.audio = data.audio || [];
      if (changed) restart();
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------- Start ---------- */
  function start() {
    updateClock();
    setInterval(updateClock, 1000);
    refresh();
    setInterval(refresh, 60000);
  }

  document.addEventListener("DOMContentLoaded", start);
})();
