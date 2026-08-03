/*
 * Digital Signage – Administrations-Frontend.
 *
 * Enthält die Logik für:
 * - Medienverwaltung (Upload, Vorschau, Umbenennen, Ersetzen, Löschen,
 *   Sortieren per Drag & Drop und Pfeiltasten)
 * - Wiedergabe-Einstellungen
 * - Benutzerverwaltung
 *
 * Alle schreibenden Anfragen senden das CSRF-Token (Header X-CSRF-Token),
 * das aus dem Meta-Tag im Seitenkopf gelesen wird.
 */

"use strict";

const csrfToken = () => document.querySelector('meta[name="csrf-token"]').content;

async function api(path, options) {
  const opts = options || {};
  opts.headers = Object.assign({}, opts.headers, { "X-CSRF-Token": csrfToken() });
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(data && data.error ? data.error : "Anfrage fehlgeschlagen.");
  }
  return data;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtSize(bytes) {
  if (bytes === null || bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(u ? 1 : 0)} ${units[u]}`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE") + " " +
         d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function toast(message, type) {
  let box = document.getElementById("toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "toast toast-" + (type || "info");
  el.textContent = message;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3500);
}

/* ---------- Modal (Vorschau) ---------- */
function openModal(html) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    `<div class="modal"><button class="modal-close" title="Schließen">&times;</button>` +
    `<div class="modal-body">${html}</div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.classList.contains("modal-close")) closeModal(overlay);
  });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      closeModal(overlay);
    }
  });
  return overlay;
}

function closeModal(overlay) {
  if (overlay) overlay.remove();
}

/* ======================================================================
 * MEDIEN
 * ====================================================================== */
const mediaPage = document.getElementById("media-page");
if (mediaPage) {
  const grid = document.getElementById("media-grid");
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const uploadForm = document.getElementById("upload-form");
  const uploadInput = document.getElementById("upload-input");
  const uploadStatus = document.getElementById("upload-status");

  let currentType = "image";
  let items = [];

  const ACCEPT = {
    image: ".jpg,.jpeg,.png,.gif,.webp",
    video: ".mp4,.webm",
    audio: ".mp3,.wav,.ogg",
  };

  const SVG = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rename: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    replace: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0115.5-6.4L21 8M21 12a9 9 0 01-15.5 6.4L3 16M21 8h-4M3 16h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  async function loadList() {
    const data = await api(`/api/media?type=${currentType}`);
    items = data.items || [];
    updateCounts(data.counts || {});
    renderGrid();
  }

  function updateCounts(counts) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const badge = tab.querySelector("[data-count]");
      if (badge) badge.textContent = counts[tab.dataset.type] || 0;
    });
  }

  function thumb(m) {
    if (m.type === "image") return `<img src="${m.url}" alt="" loading="lazy">`;
    if (m.type === "video") return `<video src="${m.url}" muted preload="metadata"></video>`;
    return `<div class="audio-icon">♪</div>`;
  }

  function actionButton(action, title, svg) {
    return `<button class="icon-btn" data-action="${action}" title="${title}">${svg}</button>`;
  }

  function renderGrid() {
    if (!items.length) {
      grid.innerHTML = '<div class="empty">Keine Dateien in dieser Kategorie.</div>';
      return;
    }
    grid.innerHTML = items.map((m, i) => `
      <div class="media-card ${m.active === false ? "inactive" : ""}" draggable="true" data-id="${m.id}">
        <div class="thumb">${thumb(m)}</div>
        <div class="media-card-body">
          <div class="name" title="${esc(m.name)}">${esc(m.name)}</div>
          <div class="sub">${fmtSize(m.size_bytes)} · ${fmtDate(m.created_at)}</div>
        </div>
        <div class="media-card-actions">
          <div class="media-toggle" title="Im Anzeigebildschirm zeigen">
            <label class="switch">
              <input type="checkbox" data-action="toggle-active" ${m.active === false ? "" : "checked"}>
              <span></span>
            </label>
            <span class="${m.active === false ? "off" : "on"}">${m.active === false ? "Aus" : "An"}</span>
          </div>
          ${i > 0 ? actionButton("up", "Nach oben", SVG.up) : ""}
          ${i < items.length - 1 ? actionButton("down", "Nach unten", SVG.down) : ""}
          ${actionButton("preview", "Vorschau", SVG.eye)}
          ${actionButton("rename", "Umbenennen", SVG.rename)}
          ${actionButton("replace", "Ersetzen", SVG.replace)}
          ${actionButton("delete", "Löschen", SVG.delete)}
        </div>
      </div>`).join("");
  }

  function saveOrder() {
    api("/api/media/reorder", {
      method: "POST",
      body: { ids: items.map((x) => x.id) },
    }).catch((err) => toast(err.message, "error"));
  }

  /* Drag & Drop: Karte auf andere Karte ziehen → Sortierung übernehmen */
  function bindGrid() {
    let draggedId = null;

    grid.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".media-card");
      if (!card) return;
      draggedId = card.dataset.id;
      card.classList.add("dragging");
    });

    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!draggedId) return;
      grid.querySelectorAll(".media-card").forEach((c) => c.classList.remove("drop-target"));
      const card = e.target.closest(".media-card");
      if (card && card.dataset.id !== draggedId) card.classList.add("drop-target");
    });

    grid.addEventListener("dragend", () => {
      const target = grid.querySelector(".media-card.drop-target");
      grid.querySelectorAll(".media-card").forEach((c) => c.classList.remove("dragging", "drop-target"));
      if (draggedId && target) {
        const from = items.findIndex((x) => String(x.id) === draggedId);
        const to = items.findIndex((x) => String(x.id) === target.dataset.id);
        if (from >= 0 && to >= 0) {
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved);
          saveOrder();
        }
      }
      draggedId = null;
      renderGrid();
    });

    grid.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const card = btn.closest(".media-card");
      const id = Number(card.dataset.id);
      const item = items.find((x) => x.id === id);
      const action = btn.dataset.action;

      try {
        if (action === "preview") {
          const inner = item.type === "image"
            ? `<img src="${item.url}" alt="${esc(item.name)}">`
            : item.type === "video"
              ? `<video src="${item.url}" controls autoplay></video>`
              : `<audio src="${item.url}" controls autoplay></audio>`;
          openModal(inner);
        } else if (action === "rename") {
          const name = prompt("Neuer Name:", item.name);
          if (name && name.trim()) {
            await api(`/api/media/${id}/rename`, { method: "POST", body: { name: name.trim() } });
            toast("Umbenannt.", "ok");
            loadList();
          }
        } else if (action === "delete") {
          if (!confirm(`„${item.name}“ wirklich löschen?`)) return;
          await api(`/api/media/${id}/delete`, { method: "POST" });
          toast("Gelöscht.", "ok");
          loadList();
        } else if (action === "replace") {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ACCEPT[currentType];
          input.onchange = async () => {
            if (!input.files.length) return;
            const fd = new FormData();
            fd.append("file", input.files[0]);
            await api(`/api/media/${id}/replace`, { method: "POST", body: fd });
            toast("Ersetzt.", "ok");
            loadList();
          };
          input.click();
        } else if (action === "toggle-active") {
          const active = btn.checked;
          const data = await api(`/api/media/${id}/active`, { method: "POST", body: { active } });
          const updated = items.find((x) => x.id === id);
          if (updated) updated.active = data.item.active;
          renderGrid();
          toast(active ? "Im Anzeigebildschirm aktiv." : "Im Anzeigebildschirm ausgeblendet.", "ok");
        } else if (action === "up" || action === "down") {
          const i = items.findIndex((x) => x.id === id);
          const j = action === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= items.length) return;
          const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
          renderGrid();
          saveOrder();
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentType = tab.dataset.type;
      grid.innerHTML = '<div class="empty">Lade …</div>';
      try { await loadList(); } catch (err) { toast(err.message, "error"); }
    });
  });

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const files = Array.from(uploadInput.files || []);
    if (!files.length) { uploadStatus.textContent = "Bitte Datei(en) auswählen."; return; }

    uploadStatus.classList.remove("error");
    uploadStatus.textContent = "Wird hochgeladen …";
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        await api("/api/media/upload", { method: "POST", body: fd });
      }
      uploadInput.value = "";
      uploadStatus.textContent = "Upload abgeschlossen.";
      await loadList();
    } catch (err) {
      uploadStatus.textContent = err.message;
      uploadStatus.classList.add("error");
    }
  });

  bindGrid();
  loadList().catch((err) => toast(err.message, "error"));
}

/* ======================================================================
 * EINSTELLUNGEN
 * ====================================================================== */
const settingsForm = document.getElementById("settings-form");
if (settingsForm) {
  const WEATHER_ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    "cloud-sun": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="6" r="3"/><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4z"/><path d="M11 4.2V3M5.8 6H4.5M6.5 8.5l-.9.9"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4z"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM4 16h4M4 19h8M4 13h2"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM8 15l-1 2M13 15l-1 2M18 15l-1 2"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM9 15l-1 1M13 15l-1 1M17 15l-1 1M9 18l-1 1M13 18l-1 1"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10a4 4 0 011 7H7.5a3.5 3.5 0 01-.5-6.97 4 4 0 016-4.03h1a3.98 3.98 0 014 4zM11 17l-1.5 3H13l-2 4"/></svg>',
  };

  const WEATHER_STATES = [
    { id: "sun", label: "Sonnig" },
    { id: "cloud-sun", label: "Leicht bewölkt" },
    { id: "cloud", label: "Bewölkt" },
    { id: "rain", label: "Regen" },
    { id: "storm", label: "Gewitter" },
    { id: "snow", label: "Schnee" },
    { id: "fog", label: "Nebel" },
  ];

  const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const pad = (n) => String(n).padStart(2, "0");
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const volumeRange = settingsForm.volume;
  const volumeValue = document.getElementById("volume-value");
  const updateVolumeLabel = () => { if (volumeValue) volumeValue.textContent = volumeRange.value + "%"; };
  if (volumeRange) volumeRange.addEventListener("input", updateVolumeLabel);
  updateVolumeLabel();

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      slide_duration: parseInt(settingsForm.slide_duration.value, 10),
      transition: settingsForm.transition.value,
      autoplay: settingsForm.autoplay.checked,
      loop: settingsForm.loop.checked,
      volume: parseInt(volumeRange.value, 10),
      music_enabled: settingsForm.music_enabled.checked,

      clock_enabled: settingsForm.clock_enabled.checked,
      clock_mode: settingsForm.clock_mode.value,
      clock_x: parseInt(settingsForm.clock_x.value, 10),
      clock_y: parseInt(settingsForm.clock_y.value, 10),
      clock_size_pct: parseInt(settingsForm.clock_size_pct.value, 10),
      clock_interstitial: settingsForm.clock_interstitial.checked,

      weather_enabled: settingsForm.weather_enabled.checked,
      weather_display: settingsForm.weather_display.value,
      weather_city: settingsForm.weather_city.value.trim(),
      weather_mode: settingsForm.weather_mode.value,
      weather_x: parseInt(settingsForm.weather_x.value, 10),
      weather_y: parseInt(settingsForm.weather_y.value, 10),
      weather_size_pct: parseInt(settingsForm.weather_size_pct.value, 10),
    };
    try {
      await api("/api/settings", { method: "POST", body });
      toast("Einstellungen gespeichert.", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  /* ---------- Segmentierte Auswahl ---------- */
  function bindSegmented(containerId, target, onChange) {
    const container = document.getElementById(containerId);
    if (!container || !target) return;
    const buttons = Array.from(container.querySelectorAll("button[data-value]"));
    const sync = () => {
      buttons.forEach((b) => b.classList.toggle("active", b.dataset.value === target.value));
    };
    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        target.value = b.dataset.value;
        sync();
        if (onChange) onChange(b.dataset.value);
      });
    });
    sync();
  }

  /* ---------- Live-Vorschau ---------- */
  const previewScreen = document.getElementById("preview-screen");
  const previewClock = document.getElementById("preview-clock");
  const previewWeather = document.getElementById("preview-weather");
  const previewTime = previewClock.querySelector(".preview-time");
  const previewDate = previewClock.querySelector(".preview-date");
  const previewContext = { value: "media" };
  const weatherPreviewState = {
    today: { icon: "sun", temp: "" },
    tomorrow: { icon: "cloud-sun", temp: "" },
  };

  function updateSliderFill() {
    document.querySelectorAll("input[type=range].slider").forEach((slider) => {
      const min = parseFloat(slider.min || 0);
      const max = parseFloat(slider.max || 100);
      const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
      slider.style.setProperty("--fill", pct + "%");
    });
  }

  function renderPreviewWeather() {
    const display = settingsForm.weather_display.value === "small" ? "small" : "large";
    const city = settingsForm.weather_city.value.trim();
    const blocks = ["today", "tomorrow"].map((key) => {
      const d = weatherPreviewState[key] || {};
      const label = key === "today" ? "Heute" : "Morgen";
      const state = WEATHER_STATES.find((s) => s.id === d.icon);
      const desc = state ? state.label : "";
      return `
      <div class="weather-block weather-${key}">
        ${display === "large" ? `<div class="weather-head">${label}</div>` : ""}
        <div class="weather-body">
          <span class="weather-icon">${WEATHER_ICONS[d.icon] || WEATHER_ICONS.cloud}</span>
          <div class="weather-info">
            <span class="weather-temp">${d.temp ? esc(d.temp) + "°" : "--°"}</span>
            ${display === "large" ? `<span class="weather-desc">${esc(desc)}</span>` : ""}
          </div>
          ${display === "small" ? `<span class="weather-day">${label}</span>` : ""}
        </div>
      </div>`;
    }).join("");
    previewWeather.innerHTML =
      (city ? `<div class="weather-location">${esc(city)}</div>` : "") + blocks;
  }

  function renderPreview() {
    const clockSize = parseInt(settingsForm.clock_size_pct.value, 10) / 100;
    previewClock.style.display = settingsForm.clock_enabled.checked ? "" : "none";
    previewClock.style.setProperty("--widget-scale", clockSize);
    if (settingsForm.clock_mode.value === "custom") {
      previewClock.className = "preview-clock preview-custom";
      previewClock.style.left = settingsForm.clock_x.value + "%";
      previewClock.style.top = settingsForm.clock_y.value + "%";
    } else if (previewContext.value === "empty") {
      previewClock.className = "preview-clock preview-empty";
      previewClock.style.left = "";
      previewClock.style.top = "";
    } else {
      previewClock.className = "preview-clock preview-media";
      previewClock.style.left = "";
      previewClock.style.top = "";
    }

    const weatherSize = parseInt(settingsForm.weather_size_pct.value, 10) / 100;
    previewWeather.style.display = settingsForm.weather_enabled.checked ? "" : "none";
    previewWeather.style.setProperty("--widget-scale", weatherSize);
    if (settingsForm.weather_mode.value === "custom") {
      previewWeather.className = "preview-weather preview-custom";
      previewWeather.style.left = settingsForm.weather_x.value + "%";
      previewWeather.style.top = settingsForm.weather_y.value + "%";
    } else {
      previewWeather.className = "preview-weather preview-auto";
      previewWeather.style.left = "";
      previewWeather.style.top = "";
    }

    renderPreviewWeather();
    updateSliderFill();
  }

  function bindSlider(slider) {
    const val = document.getElementById(slider.id + "_val");
    slider.addEventListener("input", () => {
      if (val) val.textContent = slider.value + "%";
      renderPreview();
    });
  }

  document.querySelectorAll("input[type=range].slider").forEach(bindSlider);

  function tickPreviewClock() {
    const n = new Date();
    if (previewTime) previewTime.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
    if (previewDate) previewDate.textContent = `${WEEKDAYS[n.getDay()]}, ${pad(n.getDate())}.${pad(n.getMonth() + 1)}.${n.getFullYear()}`;
  }

  /* ---------- Drag & Drop der Widgets ---------- */
  let dragging = null;
  function pointToPct(clientX, clientY) {
    const r = previewScreen.getBoundingClientRect();
    return {
      x: clamp(Math.round(((clientX - r.left) / r.width) * 100), 0, 100),
      y: clamp(Math.round(((clientY - r.top) / r.height) * 100), 0, 100),
    };
  }

  function beginDrag(e, widget) {
    e.preventDefault();
    if (!settingsForm[widget + "_enabled"].checked) return;
    if (settingsForm[widget + "_mode"].value !== "custom") {
      settingsForm[widget + "_mode"].value = "custom";
      document.querySelectorAll("#" + widget + "_mode_seg button").forEach((b) =>
        b.classList.toggle("active", b.dataset.value === "custom"));
    }
    dragging = widget;
    applyDragPos(e.clientX, e.clientY);
  }

  function applyDragPos(clientX, clientY) {
    if (!dragging) return;
    const p = pointToPct(clientX, clientY);
    settingsForm[dragging + "_x"].value = p.x;
    settingsForm[dragging + "_y"].value = p.y;
    renderPreview();
  }

  previewScreen.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".preview-clock")) beginDrag(e, "clock");
    else if (e.target.closest(".preview-weather")) beginDrag(e, "weather");
  });
  previewScreen.addEventListener("pointermove", (e) => {
    if (dragging) applyDragPos(e.clientX, e.clientY);
  });
  const endDrag = () => { dragging = null; };
  previewScreen.addEventListener("pointerup", endDrag);
  previewScreen.addEventListener("pointercancel", endDrag);

  bindSegmented("clock_mode_seg", settingsForm.clock_mode, () => renderPreview());
  bindSegmented("weather_mode_seg", settingsForm.weather_mode, () => renderPreview());
  bindSegmented("weather_display_seg", settingsForm.weather_display, () => renderPreview());
  bindSegmented("preview_context_seg", previewContext, () => renderPreview());

  settingsForm.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", renderPreview);
    el.addEventListener("change", renderPreview);
  });

  tickPreviewClock();
  setInterval(tickPreviewClock, 1000);
  renderPreview();

  /* ---------- Wetterdaten verwalten ---------- */
  const refreshBtn = document.getElementById("weather-refresh-btn");
  const weatherStatus = document.getElementById("weather-status");
  const manualForm = document.getElementById("weather-manual-form");

  const stateSelects = {
    today: document.getElementById("weather_today_state"),
    tomorrow: document.getElementById("weather_tomorrow_state"),
  };
  const tempInputs = {
    today: document.getElementById("weather_today_temp"),
    tomorrow: document.getElementById("weather_tomorrow_temp"),
  };
  const iconPreviews = {
    today: document.getElementById("today_icon_preview"),
    tomorrow: document.getElementById("tomorrow_icon_preview"),
  };

  function updateIconPreviews() {
    ["today", "tomorrow"].forEach((key) => {
      const icon = stateSelects[key].value;
      if (iconPreviews[key]) iconPreviews[key].innerHTML = WEATHER_ICONS[icon] || WEATHER_ICONS.cloud;
      weatherPreviewState[key].icon = icon;
    });
    renderPreviewWeather();
  }

  function fillManual(w) {
    if (!w) return;
    const today = w.today || {};
    const tomorrow = w.tomorrow || {};
    const setState = (key, iconId) => {
      const select = stateSelects[key];
      if (select && Array.from(select.options).some((o) => o.value === iconId)) select.value = iconId;
    };
    setState("today", today.icon || "sun");
    setState("tomorrow", tomorrow.icon || "cloud-sun");
    tempInputs.today.value = today.temp || "";
    tempInputs.tomorrow.value = tomorrow.temp || "";
    weatherPreviewState.today = { icon: stateSelects.today.value, temp: today.temp || "" };
    weatherPreviewState.tomorrow = { icon: stateSelects.tomorrow.value, temp: tomorrow.temp || "" };
    updateIconPreviews();
  }

  ["today", "tomorrow"].forEach((key) => {
    stateSelects[key].addEventListener("change", () => {
      weatherPreviewState[key].icon = stateSelects[key].value;
      updateIconPreviews();
    });
    tempInputs[key].addEventListener("input", () => {
      weatherPreviewState[key].temp = tempInputs[key].value.trim();
      renderPreviewWeather();
    });
  });

  async function loadWeather() {
    try {
      const data = await api("/api/weather");
      fillManual(data.weather || {});
    } catch (err) { /* kein Internet/keine Daten – Felder bleiben leer */ }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      weatherStatus.classList.remove("error");
      weatherStatus.textContent = "Wird aktualisiert …";
      try {
        const city = settingsForm.weather_city.value.trim();
        const data = await api("/api/weather/refresh", { method: "POST", body: { city } });
        weatherStatus.textContent = "Aktualisiert.";
        fillManual(data.weather || {});
        toast("Wetter aktualisiert.", "ok");
      } catch (err) {
        weatherStatus.textContent = err.message;
        weatherStatus.classList.add("error");
      }
    });
  }

  if (manualForm) {
    manualForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = document.getElementById("weather-manual-status");
      const body = {
        location: settingsForm.weather_city.value.trim(),
        today: {
          temp: tempInputs.today.value.trim(),
          desc: (WEATHER_STATES.find((s) => s.id === stateSelects.today.value) || {}).label || "",
          icon: stateSelects.today.value,
        },
        tomorrow: {
          temp: tempInputs.tomorrow.value.trim(),
          desc: (WEATHER_STATES.find((s) => s.id === stateSelects.tomorrow.value) || {}).label || "",
          icon: stateSelects.tomorrow.value,
        },
      };
      try {
        await api("/api/weather", { method: "POST", body });
        status.classList.remove("error");
        status.textContent = "Gespeichert.";
        toast("Wetterdaten gespeichert.", "ok");
      } catch (err) {
        status.textContent = err.message;
        status.classList.add("error");
      }
    });
  }

  loadWeather();
}

/* ======================================================================
 * BENUTZER
 * ====================================================================== */
const usersPage = document.getElementById("users-page");
if (usersPage) {
  const tableBody = document.getElementById("users-tbody");
  const createForm = document.getElementById("user-create-form");
  const createStatus = document.getElementById("user-create-status");

  async function loadUsers() {
    const data = await api("/api/users");
    renderUsers(data.items || []);
  }

  function roleSelect(u) {
    const opts = ["admin", "editor", "viewer"].map((r) =>
      `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`
    ).join("");
    return `<select class="role-select" data-user="${u.id}">${opts}</select>`;
  }

  function renderUsers(users) {
    if (!users.length) {
      tableBody.innerHTML = '<tr><td colspan="5" class="empty">Keine Benutzer vorhanden.</td></tr>';
      return;
    }
    tableBody.innerHTML = users.map((u) => `
      <tr>
        <td>${esc(u.username)}</td>
        <td>${roleSelect(u)}</td>
        <td>
          <label class="switch">
            <input type="checkbox" data-user="${u.id}" ${u.active ? "checked" : ""}>
            <span></span>
          </label>
        </td>
        <td>${fmtDate(u.created_at)}</td>
        <td>
          <button class="btn btn-small" data-user="${u.id}" data-action="password">Passwort</button>
          <button class="btn btn-small btn-danger" data-user="${u.id}" data-action="delete">Löschen</button>
        </td>
      </tr>`).join("");
  }

  tableBody.addEventListener("change", async (e) => {
    const select = e.target.closest(".role-select");
    const checkbox = e.target.closest('input[type="checkbox"]');

    try {
      if (select) {
        await api(`/api/users/${select.dataset.user}/role`, { method: "POST", body: { role: select.value } });
        toast("Rolle aktualisiert.", "ok");
      } else if (checkbox) {
        await api(`/api/users/${checkbox.dataset.user}/active`, { method: "POST" });
        toast("Status aktualisiert.", "ok");
      }
    } catch (err) {
      toast(err.message, "error");
    }
    loadUsers();
  });

  tableBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.user;
    try {
      if (btn.dataset.action === "password") {
        const pw = prompt("Neues Passwort (mindestens 6 Zeichen):");
        if (pw) {
          await api(`/api/users/${id}/password`, { method: "POST", body: { password: pw } });
          toast("Passwort geändert.", "ok");
        }
      } else if (btn.dataset.action === "delete") {
        if (!confirm("Benutzer wirklich löschen?")) return;
        await api(`/api/users/${id}/delete`, { method: "POST" });
        toast("Benutzer gelöscht.", "ok");
      }
    } catch (err) {
      toast(err.message, "error");
    }
    loadUsers();
  });

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      username: createForm.username.value.trim(),
      password: createForm.password.value,
      role: createForm.role.value,
    };
    try {
      await api("/api/users", { method: "POST", body });
      createStatus.classList.remove("error");
      createStatus.textContent = "Benutzer angelegt.";
      createForm.reset();
      loadUsers();
    } catch (err) {
      createStatus.textContent = err.message;
      createStatus.classList.add("error");
    }
  });

  loadUsers().catch((err) => toast(err.message, "error"));
}
