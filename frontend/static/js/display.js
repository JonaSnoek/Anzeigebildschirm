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

  const LANGS = ["de", "en"];

  const I18N = {
    de: {
      today: "Heute",
      tomorrow: "Morgen",
      "no-data": "Keine Daten",
      sun: "Sonnig",
      "cloud-sun": "Leicht bewölkt",
      cloud: "Bewölkt",
      fog: "Nebel",
      rain: "Regen",
      showers: "Regenschauer",
      storm: "Gewitter",
      snow: "Schnee",
    },
    en: {
      today: "Today",
      tomorrow: "Tomorrow",
      "no-data": "No data",
      sun: "Sunny",
      "cloud-sun": "Partly Cloudy",
      cloud: "Cloudy",
      fog: "Fog",
      rain: "Rain",
      showers: "Showers",
      storm: "Thunderstorm",
      snow: "Snow",
    },
  };

  let lang = localStorage.getItem("display_lang");
  if (!LANGS.includes(lang)) lang = "de";
  const t = (key) => (I18N[lang] && I18N[lang][key]) || key;
  const tWeather = (stateKey, fallback) => {
    if (fallback && fallback.trim() === "Keine Daten") return t("no-data");
    return (I18N[lang] && I18N[lang][stateKey]) || fallback || stateKey || t("no-data");
  };

  const WEATHER_ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    "cloud-sun": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="6" r="3"/><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4z"/><path d="M11 4.2V3M5.8 6H4.5M6.5 8.5l-.9.9"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4z"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM4 16h4M4 19h8M4 13h2"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM8 15l-1 2M13 15l-1 2M18 15l-1 2"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM9 15l-1 1M13 15l-1 1M17 15l-1 1M9 18l-1 1M13 18l-1 1"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM11 17l-1.5 3H13l-2 4"/></svg>',
    showers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM8 14l-1 1M13 14l-1 1M17 14l-1 1M8 18l-1 1M13 18l-1 1"/></svg>',
  };

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

  const pad = (n) => String(n).padStart(2, "0");

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ---------- Uhr ---------- */
  function updateClock() {
    const now = new Date();
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const date = now.toLocaleDateString(lang, {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
    CLOCK_BIG.textContent = time;
    DATE_BIG.textContent = date;
    CLOCK_WIDGET.innerHTML = `<span class="clock-time">${time}</span><span class="clock-date">${date}</span>`;
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
      clockSizePct: toInt(s.clock_size_pct, 100, 30, 300) / 100,
      interstitial: s.clock_interstitial === "true",

      // Wetter
      weatherEnabled: s.weather_enabled !== "false",
      weatherDisplay: s.weather_display === "small" ? "small" : "large",
      weatherMode: s.weather_mode === "custom" ? "custom" : "auto",
      weatherX: toInt(s.weather_x, 50, 0, 100),
      weatherY: toInt(s.weather_y, 50, 0, 100),
      weatherSizePct: toInt(s.weather_size_pct, 100, 30, 300) / 100,
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
      CLOCK_WIDGET.className = "clock-custom";
      CLOCK_WIDGET.style.left = c.clockX + "%";
      CLOCK_WIDGET.style.top = c.clockY + "%";
    } else {
      CLOCK_WIDGET.className = "clock-auto";
      CLOCK_WIDGET.style.left = "";
      CLOCK_WIDGET.style.top = "";
    }
    if (!c.clockEnabled || state.clockScreenShown) CLOCK_WIDGET.classList.add("hidden");
  }

  /* ---------- Wetter-Widget anwenden (Größe + Position + Inhalt) ---------- */
  function renderWeather() {
    const c = cfg();
    const display = c.weatherDisplay === "small" ? "small" : "large";
    WEATHER.className = "weather-widget weather-" + display;
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
      return;
    }

    const w = state.weather;
    const icon = (key) => WEATHER_ICONS[key] || WEATHER_ICONS.cloud;

    const block = (label, day) => {
      const d = day || { temp: "", desc: "", icon: "cloud" };
      const stateKey = d.state || d.icon || "cloud";
      const head = label === "today" ? t("today") : t("tomorrow");
      const desc = tWeather(stateKey, d.desc);
      return `
      <div class="weather-block weather-${label}">
        ${display === "large" ? `<div class="weather-head">${head}</div>` : ""}
        <div class="weather-body">
          <span class="weather-icon">${icon(stateKey)}</span>
          <div class="weather-info">
            <span class="weather-temp">${esc(d.temp)}°</span>
            ${display === "large" ? `<span class="weather-desc">${esc(desc)}</span>` : ""}
          </div>
          ${display === "small" ? `<span class="weather-day">${head}</span>` : ""}
        </div>
      </div>`;
    };

    WEATHER.innerHTML =
      `<div class="weather-location">${esc(w.location)}</div>` +
      block("today", w.today) +
      block("tomorrow", w.tomorrow);
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
