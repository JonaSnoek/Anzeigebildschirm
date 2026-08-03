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
   * je { state, icon, temp, desc }. `display` = "small" | "large".
   * Die Übersetzung ("Heute"/"Morgen", Zustände) erfolgt über `lang`.
   */
  function weatherMarkup(data, display, lang) {
    const d = data || {};
    const size = display === "small" ? "small" : "large";
    const icon = (key) => WEATHER_ICONS[key] || WEATHER_ICONS.cloud;

    const block = (label, section) => {
      const s = section || {};
      const state = s.state || s.icon || "cloud";
      const head = label === "today" ? t(lang, "today") : t(lang, "tomorrow");
      const desc = weatherText(lang, state, s.desc);
      const temp = s.temp ? esc(s.temp) : "--";
      return `
      <div class="weather-block weather-${label}">
        ${size === "large" ? `<div class="weather-head">${head}</div>` : ""}
        <div class="weather-body">
          <span class="weather-icon">${icon(state)}</span>
          <div class="weather-info">
            <span class="weather-temp">${temp}°</span>
            ${size === "large" ? `<span class="weather-desc">${esc(desc)}</span>` : ""}
          </div>
          ${size === "small" ? `<span class="weather-day">${head}</span>` : ""}
        </div>
      </div>`;
    };

    return (d.location ? `<div class="weather-location">${esc(d.location)}</div>` : "") +
      block("today", d.today) +
      block("tomorrow", d.tomorrow);
  }

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
  };
})();
