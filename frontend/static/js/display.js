/*
 * Digital Signage – Player für den Anzeigebildschirm.
 *
 * Echtzeit statt Neuladen:
 * - Verbindet sich über /api/events (Server-Sent Events) mit dem Server
 *   und übernimmt Änderungen (Medien, Einstellungen, Wetter) automatisch.
 * - Die Wiedergabe folgt der ZENTRALEN Timeline des Servers: Alle Geräte
 *   zeigen zur selben Zeit dasselbe Medium, unabhängig davon, wann sie
 *   geöffnet wurden. Der Server gibt Reihenfolge und Anzeigedauer vor.
 * - Die Uhrzeit wird über die Serverzeit synchronisiert (Drift-Ausgleich).
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

  let state = {
    settings: {},
    media: [],
    audio: [],
    weather: null,
    timeline: null,
  };

  // Serverzeit - lokale Zeit (Sekunden), wird bei jedem Event korrigiert.
  let skew = 0;

  let currentKey = null;   // "idle" | "weather-screen" | "image:<id>" | "video:<id>"
  let currentLayer = LAYER_A;
  let currentAudioUrl = null;
  let source = null;

  const nowSec = () => Date.now() / 1000 + skew;

  /* ---------- Einstellungen ---------- */
  function toInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function cfg() {
    const s = state.settings;
    return {
      autoplay: s.autoplay !== "false",
      loop: s.loop !== "false",
      volume: toInt(s.volume, 70, 0, 100) / 100,
      music: s.music_enabled !== "false",

      clockEnabled: s.clock_enabled !== "false",
      clockMode: s.clock_mode === "custom" ? "custom" : "auto",
      clockX: toInt(s.clock_x, 50, 0, 100),
      clockY: toInt(s.clock_y, 50, 0, 100),
      clockSizePct: toInt(s.clock_size_pct, 100, 30, 600) / 100,
      clockBigSizePct: toInt(s.clock_big_size_pct, 100, 30, 600) / 100,
      interstitial: s.clock_interstitial === "true",

      weatherEnabled: s.weather_enabled !== "false",
      weatherDisplay: ["small", "medium", "large"].indexOf(s.weather_display) >= 0
        ? s.weather_display
        : "large",
      weatherMode: s.weather_mode === "custom" ? "custom" : "auto",
      weatherX: toInt(s.weather_x, 50, 0, 100),
      weatherY: toInt(s.weather_y, 50, 0, 100),
      weatherSizePct: toInt(s.weather_size_pct, 100, 30, 600) / 100,
      weatherBigSizePct: toInt(s.weather_big_size_pct, 100, 30, 600) / 100,
    };
  }

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

  function applyClock() {
    const c = cfg();

    // Große Uhr-Ansicht nur im Leerzustand (eigener Slot – getrennt vom Wetter).
    // Die Zwischenansicht ist unabhängig vom Widget-Schalter: sie erscheint,
    // sobald das Interstitial aktiv ist. Nur wenn Uhr-Widget UND Interstitial
    // aus sind, bleibt der Bildschirm leer („no-clock“).
    const bigClock = currentKey === "idle";
    CLOCK_SCREEN.classList.toggle("hidden", !bigClock);
    CLOCK_SCREEN.classList.toggle("no-clock", !(c.clockEnabled || c.interstitial));
    if (bigClock) {
      CLOCK_BLOCK.style.setProperty("--widget-scale", c.clockBigSizePct);
      if (c.clockMode === "custom") {
        CLOCK_BLOCK.classList.add("clock-custom");
        CLOCK_BLOCK.style.left = c.clockX + "%";
        CLOCK_BLOCK.style.top = c.clockY + "%";
      } else {
        CLOCK_BLOCK.classList.remove("clock-custom");
        CLOCK_BLOCK.style.left = "";
        CLOCK_BLOCK.style.top = "";
      }
    }

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
    // Uhr-Overlay nur während der Medienwiedergabe zeigen.
    const showingMedia = currentKey !== "idle" && currentKey !== "weather-screen";
    if (!c.clockEnabled || !showingMedia) CLOCK_WIDGET.classList.add("hidden");
  }

  /* ---------- Wetter ---------- */
  // Drei Zustände: groß (eigener Wetter-Slot, bildschirmfüllend), als Widget
  // (während der Medien, frei positionierbar) oder ausgeblendet (Leerzustand).
  function applyWeather() {
    const c = cfg();
    const bigWeather = currentKey === "weather-screen";
    const media = currentKey !== "idle" && currentKey !== "weather-screen";

    if (bigWeather) {
      WEATHER.className = "widget-weather weather-screen";
      WEATHER.style.left = "";
      WEATHER.style.top = "";
      WEATHER.style.setProperty("--widget-scale", c.weatherBigSizePct);
    } else if (media) {
      WEATHER.className = "widget-weather weather-" + c.weatherDisplay;
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
    } else {
      // Leerzustand: die große Uhr übernimmt den Bildschirm – Wetter einzeln.
      WEATHER.classList.add("hidden");
      WEATHER.innerHTML = "";
      return;
    }

    // Das kleine Widget hängt am Widget-Schalter; die große Zwischenansicht
    // erscheint unabhängig davon (nur echte Daten vorausgesetzt).
    if (!bigWeather && !c.weatherEnabled) {
      WEATHER.classList.add("hidden");
      WEATHER.innerHTML = "";
      return;
    }
    if (!state.weather || !state.weather.location) {
      WEATHER.classList.add("hidden");
      WEATHER.innerHTML = "";
      return;
    }
    WEATHER.classList.remove("hidden");
    // Große Wetter-Ansicht zeigt immer die volle Darstellung (inkl. Tagesverlauf).
    const display = bigWeather ? "large" : c.weatherDisplay;
    WEATHER.innerHTML = Signage.weatherMarkup(state.weather, display, lang);
  }

  /* ---------- Zentrale Timeline ---------- */
  function currentSlot() {
    if (!state.timeline || !state.timeline.items || state.timeline.items.length === 0) {
      return null;
    }
    const tl = state.timeline;
    if (!cfg().autoplay) return tl.items[0];
    if (!tl.loop && nowSec() >= tl.cycle_start + tl.cycle_duration) return null;

    const phase = (((nowSec() - tl.cycle_start) % tl.cycle_duration) + tl.cycle_duration) % tl.cycle_duration;
    const items = tl.items;
    for (let i = 0; i < items.length; i++) {
      if (phase >= items[i].start && phase < items[i].end) return items[i];
    }
    return items[items.length - 1];
  }

  /* ---------- Wiedergabe ---------- */
  function clearLayer(layer) {
    if (!layer) return;
    const video = layer.querySelector("video");
    if (video) video.pause();
    layer.innerHTML = "";
  }

  function stopPlayer() {
    clearLayer(LAYER_A);
    clearLayer(LAYER_B);
    currentLayer = LAYER_A;
  }

  function nextLayer() {
    return currentLayer === LAYER_A ? LAYER_B : LAYER_A;
  }

  function activate(layer) {
    const out = currentLayer;
    if (out && out !== layer) {
      const video = out.querySelector("video");
      if (video) video.pause();
      out.classList.remove("visible");
    }
    layer.classList.add("visible");
    currentLayer = layer;
  }

  function visibleVideo() {
    return (currentLayer || PLAYER).querySelector("video");
  }

  function reportDuration(videoId, duration) {
    if (!videoId || !isFinite(duration) || duration <= 0) return;
    fetch("/api/display/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId, duration: Math.round(duration * 100) / 100 }),
    }).catch(() => { /* melden ist optional */ });
  }

  function renderImage(slot) {
    const layer = nextLayer();
    clearLayer(layer);
    const img = document.createElement("img");
    img.className = "media";
    img.src = slot.url;
    img.alt = "";
    layer.appendChild(img);
    img.onload = () => {
      if (currentKey !== "image:" + slot.id) return;
      activate(layer);
    };
    img.onerror = () => { /* Datei nicht ladbar: bis zum Slot-Ende warten */ };
  }

  function renderVideo(slot) {
    const layer = nextLayer();
    clearLayer(layer);
    const video = document.createElement("video");
    video.className = "media";
    video.src = slot.url;
    video.autoplay = true;
    video.playsInline = true;
    video.volume = cfg().volume;
    layer.appendChild(video);

    video.addEventListener("loadedmetadata", () => {
      if (currentKey !== "video:" + slot.id) return;
      const progress = nowSec() - (state.timeline.cycle_start + slot.start);
      if (isFinite(progress) && progress > 0.5 && progress < slot.duration - 0.5) {
        try { video.currentTime = progress; } catch (err) { /* Seeks können fehlschlagen */ }
      }
      if (video.duration > 0) reportDuration(slot.id, video.duration);
      video.play().catch(() => { /* Autoplay kann blockiert werden */ });
    });
    video.onplay = () => activate(layer);
  }

  function showIdle() {
    if (currentKey === "idle") return;
    currentKey = "idle";
    stopPlayer();
    PLAYER.classList.add("hidden");
    applyClock();
    applyWeather();
  }

  // Eigene große Wetter-Ansicht (Wetter-Interstitial) – getrennt von der Uhr.
  function showWeather() {
    if (currentKey === "weather-screen") return;
    currentKey = "weather-screen";
    stopPlayer();
    PLAYER.classList.add("hidden");
    applyClock();
    applyWeather();
  }

  function showSlot(slot) {
    if (!slot || slot.type === "clock") {
      showIdle();
      return;
    }
    if (slot.type === "weather") {
      showWeather();
      return;
    }
    const key = slot.type + ":" + slot.id;
    if (key === currentKey) {
      syncVideo(slot);
      return;
    }
    currentKey = key;
    PLAYER.classList.remove("hidden");
    applyClock();
    applyWeather();
    if (slot.type === "video") renderVideo(slot);
    else renderImage(slot);
  }

  function syncVideo(slot) {
    if (slot.type !== "video") return;
    const video = visibleVideo();
    if (video && video.paused && !video.ended) video.play().catch(() => {});
  }

  /* ---------- Hintergrundmusik ---------- */
  function updateAudio() {
    const c = cfg();
    const desired = c.music && state.audio.length ? state.audio[0].url : null;
    if (desired && desired !== currentAudioUrl) {
      currentAudioUrl = desired;
      AUDIO.src = desired;
      AUDIO.volume = c.volume;
      AUDIO.loop = true;
      AUDIO.play().catch(() => {});
    } else if (!desired && currentAudioUrl !== null) {
      currentAudioUrl = null;
      AUDIO.pause();
      AUDIO.removeAttribute("src");
      AUDIO.load();
    } else if (desired) {
      AUDIO.volume = c.volume;
    }
  }

  /* ---------- Zustand übernehmen ---------- */
  function applyState(data, ts) {
    if (typeof ts === "number") skew = ts - Date.now() / 1000;
    state.settings = data.settings || {};
    state.media = data.media || [];
    state.audio = data.audio || [];
    state.weather = data.weather || null;
    state.timeline = data.timeline || null;
    applyClock();
    applyWeather();
    updateAudio();
    tick();
  }

  function tick() {
    showSlot(currentSlot());
  }

  /* ---------- Echtzeit (SSE) ---------- */
  function connect() {
    if (source) source.close();
    source = new EventSource("/api/events");
    source.addEventListener("state", (event) => {
      try {
        const message = JSON.parse(event.data);
        applyState(message.data || {}, message.ts);
      } catch (err) {
        console.error(err);
      }
    });
    source.onerror = () => {
      // EventSource verbindet sich automatisch neu.
    };
  }

  /* ---------- Sprache ---------- */
  function setLang(next) {
    if (!LANGS.includes(next)) next = "de";
    lang = next;
    localStorage.setItem("display_lang", lang);
    document.documentElement.lang = lang;
    if (LANG_BTN) LANG_BTN.textContent = lang.toUpperCase();
    updateClock();
    applyWeather();
  }

  /* ---------- Start ---------- */
  async function start() {
    if (LANG_BTN) {
      LANG_BTN.textContent = lang.toUpperCase();
      LANG_BTN.addEventListener("click", () => setLang(lang === "de" ? "en" : "de"));
    }
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(tick, 500);

    try {
      const res = await fetch("/api/display", { cache: "no-store" });
      const data = await res.json();
      applyState(data, data.server_time);
    } catch (err) {
      showIdle();
    }

    connect();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && source && source.readyState !== EventSource.OPEN) connect();
    });
  }

  document.addEventListener("DOMContentLoaded", start);
})();
