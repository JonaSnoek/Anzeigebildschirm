/*
 * Digital Signage – Gemeinsame Widget-Render-Engine.
 *
 * Diese Datei wird von der Anzeige (display.js) UND der Live-Vorschau
 * (admin.js) verwendet, damit Vorschau und echtes Display 1:1
 * übereinstimmen: gleiche Symbole, gleiche Texte (Sprach-Übersetzung),
 * gleiche Darstellung von Uhr und Wetter.
 *
 * Skalierung und Positionierung laufen über CSS-Variablen:
 *   --widget-scale  (Größe des Widgets in %)
 *   --screen-w / --screen-h  (Breite/Höhe des Anzeigebereichs)
 * Dadurch skalieren Schriftgrößen und automatische Abstände exakt mit
 * der Bildschirmgröße – auf dem echten Display ebenso wie in der
 * Vorschau (dort setzt die Vorschau die Werte auf die Boxgröße).
 */

window.Signage = (function () {
  "use strict";

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* Wetter-Symbole: identisch für Anzeige und Vorschau. */
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

  /* Zustände inkl. deutscher Beschreibung (Admin-Auswahl). */
  const WEATHER_STATES = [
    { id: "sun", label: "Sonnig" },
    { id: "cloud-sun", label: "Leicht bewölkt" },
    { id: "cloud", label: "Bewölkt" },
    { id: "rain", label: "Regen" },
    { id: "showers", label: "Regenschauer" },
    { id: "storm", label: "Gewitter" },
    { id: "snow", label: "Schnee" },
    { id: "fog", label: "Nebel" },
  ];

    const I18N = {
    de: {
      today: "Heute",
      tomorrow: "Morgen",
      morning: "Morgen",
      noon: "Mittag",
      evening: "Abend",
      "no-data": "Keine Daten",
      sun: "Sonnig",
      "cloud-sun": "Leicht bewölkt",
      cloud: "Bewölkt",
      fog: "Nebel",
      rain: "Regen",
      showers: "Regenschauer",
      storm: "Gewitter",
      snow: "Schnee",
      "rain-yes": "Regen",
      "rain-no": "Kein Regen",
      "rain-prob": "Regenwahrscheinlichkeit",
    },
    en: {
      today: "Today",
      tomorrow: "Tomorrow",
      morning: "Morning",
      noon: "Noon",
      evening: "Evening",
      "no-data": "No data",
      sun: "Sunny",
      "cloud-sun": "Partly Cloudy",
      cloud: "Cloudy",
      fog: "Fog",
      rain: "Rain",
      showers: "Showers",
      storm: "Thunderstorm",
      snow: "Snow",
      "rain-yes": "Rain",
      "rain-no": "No rain",
      "rain-prob": "Rain probability",
    },
  };

  const LANGS = Object.keys(I18N);

  function t(lang, key) {
    return (I18N[lang] && I18N[lang][key]) || key || "";
  }

  function weatherText(lang, state, fallback) {
    if (fallback && String(fallback).trim() === "Keine Daten") return t(lang, "no-data");
    return (I18N[lang] && I18N[lang][state]) || fallback || state || t(lang, "no-data");
  }

  const pad = (n) => String(n).padStart(2, "0");

  function formatTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatDate(d, lang) {
    return d.toLocaleDateString(lang || "de", {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
  }

  /*
   * Wetter-Widget als HTML. `data` = { location, today, tomorrow } mit
   * je { state, icon, temp, temp_max, temp_min, desc, course }. `display`
   * = "small" | "medium" | "large". Die Übersetzung ("Heute"/"Morgen",
   * Zustände, Tageszeiträume) erfolgt über `lang`.
   *
   * - Klein:  Symbol + Tag + Höchst-/Mindesttemperatur
   * - Mittel: zusätzlich die Beschreibung
   * - Groß:   zusätzlich der Tagesverlauf (Morgen/Mittag/Abend) je Tag
   *
   * Optionen `opts` (für die Wetterseite eines Ankündigungsbildes):
   *   heading       – große Überschrift oberhalb des Wetters
   *   headingShadow – false, um den Schatten der Überschrift zu deaktivieren
   *   todayOnly     – nur den aktuellen Tag zeigen (keine "Morgen"-Vorhersage)
   *                   sowie "Regen / Kein Regen" und die Regenwahrscheinlichkeit
   */
  function weatherMarkup(data, display, lang, opts) {
    const d = data || {};
    const o = opts || {};
    const size = ["small", "medium", "large"].indexOf(display) >= 0 ? display : "large";
    const icon = (key) => WEATHER_ICONS[key] || WEATHER_ICONS.cloud;
    const show = (v) => {
      const raw = v === "" || v === null || v === undefined ? "--" : String(v);
      if (raw === "--") return "--";
      return `${esc(raw)}<span class="weather-unit">°</span>`;
    };
    const dayLabel = (key) => (key === "today" ? t(lang, "today") : t(lang, "tomorrow"));

    const card = (label, section) => {
      const s = section || {};
      const state = s.state || s.icon || "cloud";
      // Max fällt auf die aktuelle Temperatur zurück; Min NIE (sonst stünde
      // bei beiden dieselbe Zahl – die Anzeige zeigt dann „--“).
      const max = s.temp_max || s.temp || "";
      const min = s.temp_min || "";
      return `
      <div class="weather-card weather-${label}">
        <div class="weather-head">
          <span class="weather-day-ico">${icon(state)}</span>
          <span class="weather-day-label">${esc(dayLabel(label))}</span>
        </div>
        <span class="weather-desc">${esc(weatherText(lang, state, s.desc))}</span>
        <div class="weather-temps">
          <span class="weather-temp weather-temp-max"><span class="temp-arrow">&#8593;</span>${show(max)}</span>
          <span class="weather-temp weather-temp-min"><span class="temp-arrow">&#8595;</span>${show(min)}</span>
        </div>
      </div>`;
    };

    const rain = (section) => {
      const s = section || {};
      if (s.rain === undefined && s.rain_prob === undefined) return "";
      const raining = s.rain ? t(lang, "rain-yes") : t(lang, "rain-no");
      const prob = s.rain_prob > 0 ? `${s.rain_prob}%` : "--";
      return `
      <div class="weather-rain">
        <span class="weather-rain-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6.5 6.9 6.5 11a6.5 6.5 0 01-13 0c0-4.1 6.5-11 6.5-11z"/></svg>
        </span>
        <span class="weather-rain-state">${esc(raining)}</span>
        <span class="weather-rain-prob-label">${esc(t(lang, "rain-prob"))}</span>
        <span class="weather-rain-prob">${esc(String(prob))}</span>
      </div>`;
    };

    const course = (label, section) => {
      const items = ((section && section.course) || []).map((p) => `
        <div class="weather-period">
          <span class="weather-period-ico">${icon(p.state || p.icon || "cloud")}</span>
          <span class="weather-period-temp">${show(p.temp)}</span>
          <span class="weather-period-label">${esc(t(lang, p.period))}</span>
        </div>`).join("");
      if (!items) return "";
      return `
      <div class="weather-course" data-day="${label}">
        <span class="weather-course-day">${esc(dayLabel(label))}</span>
        <span class="weather-course-slots">${items}</span>
      </div>`;
    };

    const today = d.today || {};
    const showTomorrow = !o.todayOnly && !!(d.tomorrow && d.tomorrow.state !== undefined);
    return `
      <div class="weather-blocks ${o.todayOnly ? "weather-today-only" : ""}">
        ${o.heading ? `<div class="weather-heading${o.headingShadow === false ? " no-shadow" : ""}">${esc(o.heading)}</div>` : ""}
        ${d.location ? `<div class="weather-location">${esc(d.location)}</div>` : ""}
        <div class="weather-days">
          ${card("today", today)}
          ${showTomorrow ? card("tomorrow", d.tomorrow) : ""}
        </div>
        ${o.todayOnly ? rain(today) : ""}
        ${size === "large" ? `<div class="weather-courses">${course("today", today)}${showTomorrow ? course("tomorrow", d.tomorrow) : ""}</div>` : ""}
      </div>`;
  }

  /*
   * HTML-Widgets (Ankündigungsbilder): Rendering und Aktualisierung für
   * Display und Live-Vorschau. Jedes Widget wird in einem isolierten iframe
   * gerendert (beliebiger HTML-/CSS-/JavaScript-Code). Position, Größe und
   * Drehung kommen aus dem Projekt (1920×1080-Koordinaten); die Positionierung
   * erfolgt relativ zur "content box" des Bildes (object-fit: contain).
   *
   * Item-Form: { x, y, w, h, rotation, opacity, html, refresh, interval }.
   * Aktualisierung: neues iframe unsichtbar erzeugen, nach dem Laden
   * umschalten (kein Flackern, kein weißer Bildschirm).
   */
  const HtmlWidgets = (function () {
    const toNum = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function contentBox(width, height, container) {
      const cw = container ? (container.clientWidth || container.getBoundingClientRect().width) : window.innerWidth;
      const ch = container ? (container.clientHeight || container.getBoundingClientRect().height) : window.innerHeight;
      const w = toNum(width, 1920), h = toNum(height, 1080);
      const scale = Math.min(cw / w, ch / h);
      return { left: (cw - w * scale) / 2, top: (ch - h * scale) / 2, scale: scale };
    }

    function place(node, item, box) {
      const b = box || { left: 0, top: 0, scale: 1 };
      node.style.left = (b.left + toNum(item.x, 0) * b.scale) + "px";
      node.style.top = (b.top + toNum(item.y, 0) * b.scale) + "px";
      node.style.width = (toNum(item.w, 0) * b.scale) + "px";
      node.style.height = (toNum(item.h, 0) * b.scale) + "px";
      node.style.transform = "rotate(" + toNum(item.rotation, 0) + "deg)";
      node.style.opacity = String(clamp(toNum(item.opacity, 1), 0, 1));
    }

    function frame(item) {
      const f = document.createElement("iframe");
      f.className = "hw-frame";
      f.setAttribute("scrolling", "no");
      f.setAttribute("frameborder", "0");
      f.srcdoc = item.html == null ? "" : String(item.html);
      return f;
    }

    function createNode(item, box) {
      const root = document.createElement("div");
      root.className = "hw";
      root._frame = frame(item);
      root.appendChild(root._frame);
      place(root, item, box);
      return root;
    }

    /* Flackerfreie Aktualisierung: neues iframe unsichtbar darüber legen,
       nach dem Laden (oder spätestens nach 8 s) umschalten. */
    function refresh(node, item) {
      const old = node._frame;
      const fresh = frame(item);
      fresh.style.opacity = "0";
      node.appendChild(fresh);
      node._frame = fresh;
      let done = false;
      const swap = () => {
        if (done) return;
        done = true;
        if (old && old.parentNode === node) node.removeChild(old);
        fresh.style.opacity = "1";
      };
      fresh.addEventListener("load", swap, { once: true });
      setTimeout(swap, 8000);
    }

    /* Startet den Aktualisierungs-Timer eines Widgets (falls aktiviert). */
    function startTimer(item, node) {
      if (item.refresh === false) return null;
      const ms = clamp(Math.round(toNum(item.interval, 5)), 1, 1440) * 60 * 1000;
      return setInterval(() => refresh(node, item), ms);
    }

    return { contentBox, createNode, place, refresh, startTimer };
  })();

  return {
    WEATHER_ICONS,
    WEATHER_STATES,
    I18N,
    LANGS,
    esc,
    t,
    weatherText,
    formatTime,
    formatDate,
    weatherMarkup,
    HtmlWidgets,
  };
})();
