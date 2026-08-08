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

/* ---------- Seitenleiste ein-/ausklappen (wird gemerkt) ---------- */
const sidebarToggle = document.getElementById("sidebar-toggle");
const appLayout = document.querySelector(".layout");
if (sidebarToggle && appLayout) {
  const KEY = "sidebar-collapsed";
  if (localStorage.getItem(KEY) === "1") appLayout.classList.add("sidebar-collapsed");
  sidebarToggle.addEventListener("click", () => {
    appLayout.classList.toggle("sidebar-collapsed");
    localStorage.setItem(KEY, appLayout.classList.contains("sidebar-collapsed") ? "1" : "0");
  });
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
    auto_slide: ".png,.jpg,.jpeg,.webp",
  };

  const SVG = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rename: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    replace: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0115.5-6.4L21 8M21 12a9 9 0 01-15.5 6.4L3 16M21 8h-4M3 16h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    delete: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    duplicate: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15V5a2 2 0 012-2h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>',
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
    if (m.type === "image" || m.type === "auto_slide") return `<img src="${m.url}" alt="" loading="lazy">`;
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
    grid.innerHTML = items.map((m, i) => {
      const first = i > 0;
      const last = i < items.length - 1;
      return `
      <div class="media-card ${m.active === false ? "inactive" : ""}" draggable="true" data-id="${m.id}">
        <div class="thumb">${thumb(m)}</div>
        <div class="media-card-body">
          <div class="name" title="${esc(m.name)}">${esc(m.name)}</div>
          <div class="sub">${fmtSize(m.size_bytes)} · ${fmtDate(m.created_at)}</div>
        </div>
        <div class="media-card-actions">
          <div class="media-actions-row">
            <div class="media-toggle" title="Im Anzeigebildschirm zeigen">
              <label class="switch">
                <input type="checkbox" data-action="toggle-active" ${m.active === false ? "" : "checked"}>
                <span></span>
              </label>
              <span class="${m.active === false ? "off" : "on"}">${m.active === false ? "Aus" : "An"}</span>
            </div>
            ${actionButton("preview", "Vorschau", SVG.eye)}
            ${m.project_file
              ? actionButton("edit", m.type === "auto_slide" ? "Auto-Slide bearbeiten" : "Ankündigungsbild bearbeiten", SVG.edit)
              : ""}
            ${actionButton("more", "Weitere Aktionen", SVG.more)}
          </div>
          <div class="media-more-menu">
            <button class="media-more-item" data-action="up" ${first ? "" : "disabled"} title="Nach oben verschieben">${SVG.up}Nach oben</button>
            <button class="media-more-item" data-action="down" ${last ? "" : "disabled"} title="Nach unten verschieben">${SVG.down}Nach unten</button>
            <button class="media-more-item" data-action="duplicate" title="Duplizieren">${SVG.duplicate}Duplizieren</button>
            <button class="media-more-item" data-action="rename" title="Umbenennen">${SVG.rename}Umbenennen</button>
            ${m.type === "auto_slide" ? "" : `<button class="media-more-item" data-action="replace" title="Ersetzen">${SVG.replace}Ersetzen</button>`}
            <button class="media-more-item media-more-danger" data-action="delete" title="Löschen">${SVG.delete}Löschen</button>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  function closeMoreMenus(except) {
    grid.querySelectorAll(".media-card.menu-open").forEach((el) => {
      if (except && el === except) return;
      el.classList.remove("menu-open");
    });
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

      if (action === "more") {
        closeMoreMenus(card);
        card.classList.toggle("menu-open");
        return;
      }

      try {
        if (action === "preview") {
          const inner = item.type === "image" || item.type === "auto_slide"
            ? `<img src="${item.url}" alt="${esc(item.name)}">`
            : item.type === "video"
              ? `<video src="${item.url}" controls autoplay></video>`
              : `<audio src="${item.url}" controls autoplay></audio>`;
          openModal(inner);
        } else if (action === "edit") {
          window.location.href = item.type === "auto_slide" ? `/admin/auto-slides/${id}/edit` : `/admin/announcements/${id}/edit`;
          return;
        } else if (action === "duplicate") {
          const data = await api(`/api/media/${id}/duplicate`, { method: "POST" });
          toast(`Dupliziert: ${data.item ? data.item.name : "Kopie"}`, "ok");
          loadList();
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
      closeMoreMenus();
    });

    // Menü schließen, wenn außerhalb geklickt wird
    document.addEventListener("click", (e) => {
      if (e.target.closest(".media-card")) return;
      closeMoreMenus();
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
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const volumeRange = settingsForm.volume;
  const volumeValue = document.getElementById("volume-value");
  const updateVolumeLabel = () => { if (volumeValue) volumeValue.textContent = volumeRange.value + "%"; };
  if (volumeRange) volumeRange.addEventListener("input", updateVolumeLabel);
  updateVolumeLabel();

  /* Folien-Intervall der großen Uhr-/Wetter-Ansicht: "off", "1"…"999".
     Bei „Benutzerdefiniert“ kommt die Zahl aus dem Eingabefeld; ungültige
     Werte liefern null (der Aufrufer bricht dann ab). */
  function intervalValue(name) {
    const sel = settingsForm[name + "_interval"];
    if (!sel) return "off";
    const v = sel.value;
    if (v !== "custom") return v;
    const cus = settingsForm[name + "_interval_custom"];
    const n = parseInt(cus ? cus.value : "", 10);
    if (isNaN(n) || n < 1 || n > 999) return null;
    return String(n);
  }

  function syncIntervalFields() {
    ["clock", "weather"].forEach((name) => {
      const sel = settingsForm[name + "_interval"];
      const field = document.getElementById(name + "_interval_custom_field");
      if (!sel || !field) return;
      field.style.display = sel.value === "custom" ? "" : "none";
    });
  }

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const clockInterval = intervalValue("clock");
    const weatherInterval = intervalValue("weather");
    if (clockInterval === null || weatherInterval === null) {
      toast("Bitte eine gültige Zahl für das benutzerdefinierte Folien-Intervall eingeben (1–999).", "error");
      return;
    }
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
      clock_big_size_pct: parseInt(settingsForm.clock_big_size_pct.value, 10),
      clock_interval: clockInterval,

      weather_enabled: settingsForm.weather_enabled.checked,
      weather_display: settingsForm.weather_display.value,
      weather_city: settingsForm.weather_city.value.trim(),
      weather_mode: settingsForm.weather_mode.value,
      weather_x: parseInt(settingsForm.weather_x.value, 10),
      weather_y: parseInt(settingsForm.weather_y.value, 10),
      weather_size_pct: parseInt(settingsForm.weather_size_pct.value, 10),
      weather_big_size_pct: parseInt(settingsForm.weather_big_size_pct.value, 10),
      weather_interval: weatherInterval,
    };
    try {
      await api("/api/settings", { method: "POST", body });
      toast("Änderungen erfolgreich gespeichert.", "ok");
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

  /* ---------- Live-Vorschau (nutzt die gleiche Render-Engine wie die
   *            Anzeige – Signage aus widgets.js) ---------- */
  const previewScreen = document.getElementById("preview-screen");
  const previewClockScreen = document.getElementById("preview-clock-screen");
  const previewClockBlock = document.getElementById("preview-clock-block");
  const previewClock = document.getElementById("preview-clock");
  const previewWeather = document.getElementById("preview-weather");
  const previewMedia = document.getElementById("preview-media");
  const previewContext = { value: "media" };

  const weatherPreviewState = {
    today: { icon: "sun", temp_max: "", temp_min: "" },
    tomorrow: { icon: "cloud-sun", temp_max: "", temp_min: "" },
  };

  function previewLang() {
    const v = localStorage.getItem("display_lang");
    return Signage.LANGS.indexOf(v) >= 0 ? v : "de";
  }

  function widgetCfg(name) {
    const f = settingsForm;
    return {
      enabled: f[name + "_enabled"].checked,
      interval: intervalValue(name) || "off",
      mode: f[name + "_mode"].value,
      x: parseInt(f[name + "_x"].value, 10),
      y: parseInt(f[name + "_y"].value, 10),
      sizePct: parseInt(f[name + "_size_pct"].value, 10),
      bigSizePct: parseInt(f[name + "_big_size_pct"].value, 10),
    };
  }

  function weatherPreviewData() {
    return {
      location: settingsForm.weather_city.value.trim(),
      today: weatherPreviewState.today,
      tomorrow: weatherPreviewState.tomorrow,
    };
  }

  function syncPreviewSize() {
    const r = previewScreen.getBoundingClientRect();
    previewScreen.style.setProperty("--screen-w", r.width + "px");
    previewScreen.style.setProperty("--screen-h", r.height + "px");
  }

  function updateSliderFill() {
    document.querySelectorAll("input[type=range].slider").forEach((slider) => {
      const min = parseFloat(slider.min || 0);
      const max = parseFloat(slider.max || 100);
      const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
      slider.style.setProperty("--fill", pct + "%");
    });
  }

  // Darstellungszustand der Vorschau – exakt wie auf dem echten Display:
  //   "empty"   → große Uhr (Ohne-Medien-Modus oder Uhr-Interstitial-Slot)
  //   "weather" → große Wetter-Ansicht (Wetter-Interstitial-Slot)
  //   "weather-announcement" → Wetterseite eines Ankündigungsbildes
  //   "media"   → Medien mit kleinen Widgets
  function previewMode() {
    if (previewContext.value === "empty") return "empty";
    if (previewContext.value === "media") {
      if (liveSlotState && liveSlotState.type === "clock") return "empty";
      if (liveSlotState && liveSlotState.type === "weather") return "weather";
      if (liveSlotState && liveSlotState.type === "weather-announcement") return "weather-announcement";
      return "media";
    }
    return "media";
  }

  function renderPreview() {
    syncPreviewSize();
    computeLiveSlot();
    const lang = previewLang();
    const clock = widgetCfg("clock");
    const weather = widgetCfg("weather");
    const mode = previewMode();
    const idle = mode === "empty";
    // Folien-Konfiguration der Uhr (aus dem Timeline-Slot des aktuell
    // angezeigten Ankündigungsbildes) – wie auf dem echten Display.
    const slotClock = liveSlotState && liveSlotState.clock ? liveSlotState.clock : null;

    // Große Uhr-Ansicht nur im Zustand "empty" (Uhr-Slot) – getrennt vom Wetter.
    // Unabhängig vom Widget-Schalter: sie erscheint, sobald das Interstitial
    // aktiv ist. Nur wenn Widget UND Interstitial aus sind, bleibt sie leer.
    previewClockScreen.classList.toggle("hidden", !idle);
    previewClockScreen.classList.toggle("no-clock", !(clock.enabled || clock.interval !== "off"));
    if (idle) {
      previewClockBlock.style.setProperty("--widget-scale", clock.bigSizePct / 100);
      previewClockBlock.classList.toggle("clock-custom", clock.mode === "custom");
      if (clock.mode === "custom") {
        previewClockBlock.style.left = clock.x + "%";
        previewClockBlock.style.top = clock.y + "%";
      } else {
        previewClockBlock.style.left = "";
        previewClockBlock.style.top = "";
      }
    }

    // Uhr-Widget (Overlay während der Medien)
    previewClock.style.setProperty("--widget-scale", clock.sizePct / 100);
    previewClock.className = "widget-clock embedded clock-" + clock.mode;
    if (clock.mode === "custom") {
      previewClock.style.left = clock.x + "%";
      previewClock.style.top = clock.y + "%";
    } else {
      previewClock.style.left = "";
      previewClock.style.top = "";
    }
    if (slotClock) {
      previewClock.style.setProperty("--clock-color", slotClock.color || "#FFFFFF");
      previewClock.style.setProperty("--clock-shadow", slotClock.shadow === false ? "none" : "0 2px 10px rgba(0,0,0,.9)");
    } else {
      previewClock.style.removeProperty("--clock-color");
      previewClock.style.removeProperty("--clock-shadow");
    }
    previewClock.classList.toggle("hidden", mode !== "media" || !clock.enabled || (slotClock && slotClock.enabled === false));

    // Wetter: groß (Wetter-Interstitial) oder als Widget (während der Medien).
    // Im Zustand "empty" (große Uhr) ist das Wetter ausgeblendet.
    const display = ["small", "medium", "large"].indexOf(settingsForm.weather_display.value) >= 0
      ? settingsForm.weather_display.value
      : "large";
    if (mode === "weather" || mode === "weather-announcement") {
      previewWeather.style.setProperty("--widget-scale", weather.bigSizePct / 100);
      previewWeather.className = "widget-weather embedded weather-screen";
      previewWeather.style.left = "";
      previewWeather.style.top = "";
      let data = weatherPreviewData();
      let opts = {};
      if (mode === "weather-announcement") {
        const entry = (liveState.announcement_weather || {})[liveSlotState.id];
        data = entry ? entry.weather : null;
        opts = { heading: (entry && entry.heading) || "", todayOnly: true, headingShadow: entry && entry.headingShadow };
      }
      if (data && data.location) {
        previewWeather.classList.remove("hidden");
        previewWeather.innerHTML = Signage.weatherMarkup(data, "large", lang, opts);
      } else {
        previewWeather.classList.add("hidden");
        previewWeather.innerHTML = "";
      }
    } else if (mode === "media") {
      previewWeather.style.setProperty("--widget-scale", weather.sizePct / 100);
      previewWeather.className = "widget-weather embedded weather-" + display + " weather-" + weather.mode;
      if (weather.mode === "custom") {
        previewWeather.style.left = weather.x + "%";
        previewWeather.style.top = weather.y + "%";
      } else {
        previewWeather.style.left = "";
        previewWeather.style.top = "";
      }
      previewWeather.classList.toggle("hidden", !weather.enabled);
      previewWeather.innerHTML = Signage.weatherMarkup(weatherPreviewData(), display, lang);
    } else {
      previewWeather.classList.add("hidden");
      previewWeather.innerHTML = "";
      previewWeather.style.left = "";
      previewWeather.style.top = "";
    }

    updatePreviewClock();
    updateLiveMedia();
    updateHtmlWidgets();
    updateSliderFill();
  }

  /* HTML-Widgets in der Live-Vorschau (gleiche Render-Engine wie Display).
     Der Container (#preview-screen) hat exakt das 16:9-Format der Leinwand,
     dadurch deckt die Content-Box das Medium exakt ab. */
  let previewWidgetTimers = [];
  let liveWidgetSig = null;
  let previewWidgets = [];
  function stopPreviewWidgetTimers() {
    previewWidgetTimers.forEach((t) => clearInterval(t));
    previewWidgetTimers = [];
  }

  function updateHtmlWidgets() {
    const layer = document.getElementById("preview-html-widgets");
    if (!layer) return;
    const slot = previewContext.value === "media" ? liveSlotState : null;
    const cfg = slot && slot.widgets ? slot.widgets : null;
    const sig = cfg ? slot.id + ":" + JSON.stringify(cfg) : null;
    if (sig === liveWidgetSig) {
      if (cfg) {
        const box = Signage.HtmlWidgets.contentBox(Number(cfg.width) || 1920, Number(cfg.height) || 1080, previewScreen);
        previewWidgets.forEach((w) => Signage.HtmlWidgets.place(w.node, w.item, box));
      }
      return;
    }
    liveWidgetSig = sig;
    stopPreviewWidgetTimers();
    previewWidgets.forEach((w) => Signage.HtmlWidgets.dispose(w.node));
    layer.innerHTML = "";
    previewWidgets = [];
    if (!cfg || !cfg.items || !cfg.items.length) return;
    const box = Signage.HtmlWidgets.contentBox(Number(cfg.width) || 1920, Number(cfg.height) || 1080, previewScreen);
    for (const item of cfg.items) {
      const node = Signage.HtmlWidgets.createNode(item, box);
      layer.appendChild(node);
      previewWidgets.push({ node, item });
      const timer = Signage.HtmlWidgets.startTimer(item, node);
      if (timer !== null) previewWidgetTimers.push(timer);
    }
  }

  /* ---------- Live-Medien (SSE, identisch mit Display) ---------- */
  const liveState = { timeline: null, announcement_weather: null };
  let liveSkew = 0;
  let liveMediaKey = null;
  let liveSlotState = null;

  function liveNow() {
    return Date.now() / 1000 + liveSkew;
  }

  function computeLiveSlot() {
    const tl = liveState.timeline;
    if (!tl || !tl.items || tl.items.length === 0) { liveSlotState = null; return; }
    const t = liveNow();
    if (!tl.loop && t >= tl.cycle_start + tl.cycle_duration) { liveSlotState = null; return; }
    const phase = (((t - tl.cycle_start) % tl.cycle_duration) + tl.cycle_duration) % tl.cycle_duration;
    for (const item of tl.items) {
      if (phase >= item.start && phase < item.end) { liveSlotState = item; return; }
    }
    liveSlotState = tl.items[tl.items.length - 1];
  }

  function updateLiveMedia() {
    if (!previewMedia) return;
    const slot = previewContext.value === "media" ? liveSlotState : null;
    if (!slot || previewMode() !== "media") {
      previewMedia.innerHTML = "";
      liveMediaKey = null;
      return;
    }
    const key = slot.type + ":" + slot.id;
    if (key === liveMediaKey) {
      const video = previewMedia.querySelector("video");
      if (slot.type === "video" && video && video.paused && !video.ended) {
        video.play().catch(function () {});
      }
      return;
    }
    liveMediaKey = key;
    if (slot.type === "image") {
      previewMedia.innerHTML = '<img src="' + slot.url + '" alt="">';
    } else {
      const progress = Math.max(0, liveNow() - (liveState.timeline.cycle_start + slot.start));
      previewMedia.innerHTML =
        '<video src="' + slot.url + '" muted playsinline autoplay preload="metadata"></video>';
      const video = previewMedia.querySelector("video");
      video.addEventListener("loadedmetadata", () => {
        try {
          if (progress > 0.5 && progress < video.duration - 0.5) video.currentTime = progress;
        } catch (err) {}
        video.play().catch(function () {});
      });
    }
  }

  const liveSource = new EventSource("/api/events");
  liveSource.addEventListener("state", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (typeof message.ts === "number") liveSkew = message.ts - Date.now() / 1000;
      if (message.data && message.data.timeline) liveState.timeline = message.data.timeline;
      if (message.data && message.data.announcement_weather) liveState.announcement_weather = message.data.announcement_weather;
      renderPreview();
    } catch (err) {}
  });
  liveSource.onerror = function () {};
  setInterval(renderPreview, 1000);
  fetch("/api/display", { cache: "no-store" })
    .then((res) => res.json())
    .then((data) => {
      if (typeof data.server_time === "number") liveSkew = data.server_time - Date.now() / 1000;
      if (data && data.timeline) liveState.timeline = data.timeline;
      if (data && data.announcement_weather) liveState.announcement_weather = data.announcement_weather;
      renderPreview();
    })
    .catch(function () {});

  function updatePreviewClock() {
    const now = new Date();
    const time = Signage.formatTime(now);
    const date = Signage.formatDate(now, previewLang());
    previewClock.querySelector(".clock-time").textContent = time;
    previewClock.querySelector(".clock-date").textContent = date;
    previewClockBlock.querySelector(".clock-big").textContent = time;
    previewClockBlock.querySelector(".clock-big-date").textContent = date;
  }

  function bindSlider(slider) {
    const val = document.getElementById(slider.id + "_val");
    slider.addEventListener("input", () => {
      if (val) val.textContent = slider.value + "%";
      renderPreview();
    });
  }

  document.querySelectorAll("input[type=range].slider").forEach(bindSlider);

  /* ---------- Drag & Drop der Widgets (Position wird in der Vorschau gesetzt,
   *            dauerhaft übernommen erst über „Einstellungen speichern“) ---------- */
  let dragState = null;

  function pointPct(clientX, clientY) {
    const r = previewScreen.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * 100,
      y: ((clientY - r.top) / r.height) * 100,
    };
  }

  function elementCenterPct(el) {
    const s = previewScreen.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: ((r.left + r.width / 2 - s.left) / s.width) * 100,
      y: ((r.top + r.height / 2 - s.top) / s.height) * 100,
    };
  }

  function setModeUi(name, mode) {
    settingsForm[name + "_mode"].value = mode;
    document.querySelectorAll("#" + name + "_mode_seg button").forEach((b) =>
      b.classList.toggle("active", b.dataset.value === mode));
  }

  function beginDrag(e, name, el) {
    if (!settingsForm[name + "_enabled"].checked) return;
    e.preventDefault();
    if (settingsForm[name + "_mode"].value !== "custom") setModeUi(name, "custom");
    const center = elementCenterPct(el);
    const p = pointPct(e.clientX, e.clientY);
    dragState = { name, startX: p.x, startY: p.y, centerX: center.x, centerY: center.y };
  }

  function moveDrag(e) {
    if (!dragState) return;
    const p = pointPct(e.clientX, e.clientY);
    const x = clamp(dragState.centerX + (p.x - dragState.startX), 0, 100);
    const y = clamp(dragState.centerY + (p.y - dragState.startY), 0, 100);
    settingsForm[dragState.name + "_x"].value = Math.round(x);
    settingsForm[dragState.name + "_y"].value = Math.round(y);
    renderPreview();
  }

  function endDrag() {
    dragState = null;
  }

  previewScreen.addEventListener("pointerdown", (e) => {
    const big = e.target.closest("#preview-clock-screen .clock-screen-block");
    const overlay = e.target.closest("#preview-clock");
    const weather = e.target.closest("#preview-weather");
    const mode = previewMode();
    const idle = mode === "empty";
    if (big && idle) beginDrag(e, "clock", big);
    else if (overlay && mode === "media") beginDrag(e, "clock", overlay);
    else if (weather && mode === "media") beginDrag(e, "weather", weather);
  });
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", () => endDrag());
  window.addEventListener("pointercancel", () => { dragState = null; });

  bindSegmented("clock_mode_seg", settingsForm.clock_mode, () => renderPreview());
  bindSegmented("weather_mode_seg", settingsForm.weather_mode, () => renderPreview());
  bindSegmented("weather_display_seg", settingsForm.weather_display, () => renderPreview());
  bindSegmented("preview_context_seg", previewContext, () => renderPreview());

  const previewLangTarget = { value: previewLang() };
  bindSegmented("preview_lang_seg", previewLangTarget, () => {
    localStorage.setItem("display_lang", previewLangTarget.value);
    renderPreview();
  });

  settingsForm.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", renderPreview);
    el.addEventListener("change", renderPreview);
  });
  ["clock_interval", "weather_interval"].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) sel.addEventListener("change", syncIntervalFields);
  });
  syncIntervalFields();
  window.addEventListener("resize", renderPreview);

  updatePreviewClock();
  setInterval(updatePreviewClock, 1000);
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
    todayMax: document.getElementById("weather_today_temp_max"),
    todayMin: document.getElementById("weather_today_temp_min"),
    tomorrowMax: document.getElementById("weather_tomorrow_temp_max"),
    tomorrowMin: document.getElementById("weather_tomorrow_temp_min"),
  };
  const tempPreview = {
    todayMax: ["today", "temp_max"],
    todayMin: ["today", "temp_min"],
    tomorrowMax: ["tomorrow", "temp_max"],
    tomorrowMin: ["tomorrow", "temp_min"],
  };
  const iconPreviews = {
    today: document.getElementById("today_icon_preview"),
    tomorrow: document.getElementById("tomorrow_icon_preview"),
  };

  function updateIconPreviews() {
    ["today", "tomorrow"].forEach((key) => {
      const icon = stateSelects[key].value;
      if (iconPreviews[key]) iconPreviews[key].innerHTML = Signage.WEATHER_ICONS[icon] || Signage.WEATHER_ICONS.cloud;
      weatherPreviewState[key].icon = icon;
    });
    renderPreview();
  }

  function fillManual(w) {
    if (!w) return;
    const today = w.today || {};
    const tomorrow = w.tomorrow || {};
    const setState = (key, iconId) => {
      const select = stateSelects[key];
      if (select && Array.from(select.options).some((o) => o.value === iconId)) select.value = iconId;
    };
    setState("today", today.state || today.icon || "sun");
    setState("tomorrow", tomorrow.state || tomorrow.icon || "cloud-sun");
    tempInputs.todayMax.value = today.temp_max || today.temp || "";
    tempInputs.todayMin.value = today.temp_min || "";
    tempInputs.tomorrowMax.value = tomorrow.temp_max || tomorrow.temp || "";
    tempInputs.tomorrowMin.value = tomorrow.temp_min || "";
    weatherPreviewState.today = {
      icon: stateSelects.today.value,
      temp_max: today.temp_max || today.temp || "",
      temp_min: today.temp_min || "",
      course: today.course || [],
    };
    weatherPreviewState.tomorrow = {
      icon: stateSelects.tomorrow.value,
      temp_max: tomorrow.temp_max || tomorrow.temp || "",
      temp_min: tomorrow.temp_min || "",
      course: tomorrow.course || [],
    };
    updateIconPreviews();
  }

  ["today", "tomorrow"].forEach((key) => {
    stateSelects[key].addEventListener("change", () => {
      weatherPreviewState[key].icon = stateSelects[key].value;
      updateIconPreviews();
    });
  });
  Object.keys(tempInputs).forEach((key) => {
    tempInputs[key].addEventListener("input", () => {
      const [day, field] = tempPreview[key];
      weatherPreviewState[day][field] = tempInputs[key].value.trim();
      renderPreview();
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
          temp: tempInputs.todayMax.value.trim() || tempInputs.todayMin.value.trim(),
          temp_max: tempInputs.todayMax.value.trim(),
          temp_min: tempInputs.todayMin.value.trim(),
          desc: (Signage.WEATHER_STATES.find((s) => s.id === stateSelects.today.value) || {}).label || "",
          icon: stateSelects.today.value,
        },
        tomorrow: {
          temp: tempInputs.tomorrowMax.value.trim() || tempInputs.tomorrowMin.value.trim(),
          temp_max: tempInputs.tomorrowMax.value.trim(),
          temp_min: tempInputs.tomorrowMin.value.trim(),
          desc: (Signage.WEATHER_STATES.find((s) => s.id === stateSelects.tomorrow.value) || {}).label || "",
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
