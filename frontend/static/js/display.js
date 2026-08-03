/*
 * Digital Signage – Player für den Anzeigebildschirm.
 *
 * - Lädt Medienliste, Einstellungen und Wetter über /api/display
 * - Bilder: Diashow mit konfigurierbarer Dauer und Fade-Übergang
 * - Videos: automatischer Start, danach weiter zur nächsten Datei
 * - Audio: Hintergrundmusik in Endlosschleife (falls aktiviert)
 * - Uhr + Wetter: frei konfigurierbar (Größe per Schieberegler,
 *   Position automatisch oder frei per X/Y)
 * - Aktualisiert die Daten alle 30 Sekunden (Live-Vorschau/Änderungen)
 *
 * Symbole, Übersetzungen und Widget-Markup kommen aus der gemeinsamen
 * Render-Engine `Signage` (js/widgets.js) – identisch mit der Vorschau.
 */

"use strict";

(function () {
  const LAYER_A = document.getElementById("layer-a");
  const LAYER_B = document.getElementById("layer-b");
  const PLAYER = document.getElementById("player");
  const CLOCK_SCREEN = document.getElementById("clock-screen");
  const CLOCK_BLOCK = document.getElementById("clock-screen-block");
  const CLOCK_BIG = document.getElementById("clock-big");
  const DATE_BIG = document.getElementById("date-big");
  const CLOCK_WIDGET = document.getElementById("clock-widget");
  const WEATHER = document.getElementById("weather-widget");
  const AUDIO = document.getElementById("bg-audio");
  const LANG_BTN = document.getElementById("lang-toggle");

  const LANGS = Signage.LANGS;

  let lang = localStorage.getItem("display_lang");
  if (!LANGS.includes(lang)) lang = "de";

  const state = {
    settings: {},
    items: [],       // Bilder + Videos (gemeinsame Playlist)
    audio: [],       // Audiodateien
    weather: null,   // Wetterdaten
    index: 0,
    timer: null,
    current: null,   // gerade sichtbare Ebene
    next: LAYER_A,   // unsichtbare Ebene für den nächsten Inhalt
    clockScreenShown: false,
    signature: "",
  };

  /* ---------- Uhr ---------- */
  function updateClock() {
    const now = new Date();
    const time = Signage.formatTime(now);
    const date = Signage.formatDate(now, lang);
    CLOCK_BIG.textContent = time;
    DATE_BIG.textContent = date;
    CLOCK_WIDGET.querySelector(".clock-time").textContent = time;
    CLOCK_WIDGET.querySelector(".clock-date").textContent = date;
  }

  /* ---------- Einstellungen ---------- */
  function toInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function cfg() {
    const s = state.settings;
    return {
      slideDuration: toInt(s.slide_duration, 8, 3, 300) * 1000,
      transition: s.transition === "none" ? "none" : "fade",
      autoplay: s.autoplay !== "false",
      loop: s.loop !== "false",
      volume: toInt(s.volume, 70, 0, 100) / 100,
      music: s.music_enabled !== "false",

      // Uhr
      clockEnabled: s.clock_enabled !== "false",
      clockMode: s.clock_mode === "custom" ? "custom" : "auto",
      clockX: toInt(s.clock_x, 50, 0, 100),
      clockY: toInt(s.clock_y, 50, 0, 100),
      clockSizePct: toInt(s.clock_size_pct, 100, 30, 600) / 100,
      interstitial: s.clock_interstitial === "true",

      // Wetter
      weatherEnabled: s.weather_enabled !== "false",
      weatherDisplay: s.weather_display === "small" ? "small" : "large",
      weatherMode: s.weather_mode === "custom" ? "custom" : "auto",
      weatherX: toInt(s.weather_x, 50, 0, 100),
      weatherY: toInt(s.weather_y, 50, 0, 100),
      weatherSizePct: toInt(s.weather_size_pct, 100, 30, 600) / 100,
    };
  }

  const fadeMs = () => (cfg().transition === "none" ? 0 : 800);

  /* ---------- Uhr anwenden (Größe + Position) ---------- */
  function applyClock() {
    const c = cfg();

    // Uhr-Ansicht (Leerzustand / Interstitial)
    CLOCK_SCREEN.classList.toggle("no-clock", !c.clockEnabled);
    CLOCK_BLOCK.style.setProperty("--widget-scale", c.clockSizePct);
    if (c.clockMode === "custom") {
      CLOCK_BLOCK.classList.add("clock-custom");
      CLOCK_BLOCK.style.left = c.clockX + "%";
      CLOCK_BLOCK.style.top = c.clockY + "%";
    } else {
      CLOCK_BLOCK.classList.remove("clock-custom");
      CLOCK_BLOCK.style.left = "";
      CLOCK_BLOCK.style.top = "";
    }

    // Uhr-Overlay während der Medienwiedergabe
    CLOCK_WIDGET.classList.remove("hidden");
    CLOCK_WIDGET.style.setProperty("--widget-scale", c.clockSizePct);
    if (c.clockMode === "custom") {
      CLOCK_WIDGET.className = "widget-clock clock-custom";
      CLOCK_WIDGET.style.left = c.clockX + "%";
      CLOCK_WIDGET.style.top = c.clockY + "%";
    } else {
      CLOCK_WIDGET.className = "widget-clock clock-auto";
      CLOCK_WIDGET.style.left = "";
      CLOCK_WIDGET.style.top = "";
    }
    if (!c.clockEnabled || state.clockScreenShown) CLOCK_WIDGET.classList.add("hidden");
  }

  /* ---------- Wetter-Widget anwenden (Größe + Position + Inhalt) ---------- */
  function renderWeather() {
    const c = cfg();
    const display = c.weatherDisplay === "small" ? "small" : "large";
    WEATHER.className = "widget-weather weather-" + display;
    WEATHER.classList.remove("hidden");
    WEATHER.style.setProperty("--widget-scale", c.weatherSizePct);
    if (c.weatherMode === "custom") {
      WEATHER.classList.add("weather-custom");
      WEATHER.style.left = c.weatherX + "%";
      WEATHER.style.top = c.weatherY + "%";
    } else {
      WEATHER.classList.add("weather-auto");
      WEATHER.style.left = "";
      WEATHER.style.top = "";
    }

    if (!c.weatherEnabled || !state.weather || !state.weather.location) {
      WEATHER.classList.add("hidden");
      WEATHER.innerHTML = "";
      return;
    }

    WEATHER.innerHTML = Signage.weatherMarkup(state.weather, display, lang);
  }

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

  /* ---------- Uhr-Ansicht (Leerzustand / Interstitial) / Player ---------- */
  function showClockScreen() {
    stopTimer();
    const video = visibleVideo();
    if (video) video.pause();
    clearLayer(LAYER_A);
    clearLayer(LAYER_B);
    state.current = null;
    state.next = LAYER_A;
    state.clockScreenShown = true;
    PLAYER.classList.add("hidden");
    CLOCK_SCREEN.classList.remove("hidden");
    applyClock();
  }

  function showPlayer() {
    state.clockScreenShown = false;
    CLOCK_SCREEN.classList.add("hidden");
    PLAYER.classList.remove("hidden");
    applyClock();
    renderWeather();
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
    if (len === 0) { showClockScreen(); return; }
    if (state.index >= len - 1 && !s.loop) { showClockScreen(); return; }
    state.index = (state.index + 1) % len;

    if (s.interstitial) {
      // Erst die Uhr-Ansicht zeigen, dann das nächste Medium
      showClockScreen();
      state.timer = setTimeout(() => {
        showPlayer();
        showCurrent();
      }, s.slideDuration);
    } else {
      showCurrent();
    }
  }

  function skipToNext(why) {
    if (why) console.warn(why);
    const len = state.items.length;
    if (len === 0) { showClockScreen(); return; }
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
      showClockScreen();
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
      const signature = JSON.stringify([
        data.settings,
        data.media,
        data.audio,
        data.weather && data.weather.updated_at,
      ]);
      const changed = signature !== state.signature;
      state.signature = signature;
      state.settings = data.settings || {};
      state.items = data.media || [];
      state.audio = data.audio || [];
      state.weather = data.weather || null;
      renderWeather();
      if (changed) restart();
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------- Sprache ---------- */
  function setLang(next) {
    if (!LANGS.includes(next)) next = "de";
    lang = next;
    localStorage.setItem("display_lang", lang);
    document.documentElement.lang = lang;
    if (LANG_BTN) LANG_BTN.textContent = lang.toUpperCase();
    updateClock();
    renderWeather();
  }

  /* ---------- Start ---------- */
  function start() {
    if (LANG_BTN) {
      LANG_BTN.textContent = lang.toUpperCase();
      LANG_BTN.addEventListener("click", () => setLang(lang === "de" ? "en" : "de"));
    }
    updateClock();
    setInterval(updateClock, 1000);
    refresh();
    setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }

  document.addEventListener("DOMContentLoaded", start);
})();
