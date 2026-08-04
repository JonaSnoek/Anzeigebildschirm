/*
 * Digital Signage – Editor für Ankündigungsbilder.
 *
 * Ein Ankündigungsbild besteht aus einem festen Design (Ebenen: Hintergrund,
 * Abdunkeln, Titel mit geschwungener Linie, Untertitel, weißes Info-Feld) –
 * nur die Inhalte sind bearbeitbar. Die Vorschau wird live auf einem
 * 1920×1080-<canvas> gezeichnet; beim Speichern wird genau dieses Canvas als
 * PNG an die Announcements-API übermittelt (multipart: file + project + ggf.
 * background). Zusätzlich kann pro Bild eine eigene Wetterseite konfiguriert
 * werden, die auf dem Anzeigebildschirm direkt nach dem Bild erscheint.
 */

"use strict";

(function () {
  const page = document.getElementById("announcement-page");
  if (!page) return;

  const W = 1920, H = 1080;
  const mediaId = window.ANNOUNCEMENT_MEDIA_ID || null;
  const bgPrefix = window.ANNOUNCEMENT_BG_PREFIX || "/api/announcements/bg/";
  let project = window.ANNOUNCEMENT_PROJECT && typeof window.ANNOUNCEMENT_PROJECT === "object"
    ? window.ANNOUNCEMENT_PROJECT
    : {};

  const canvas = document.getElementById("ann-canvas");
  const ctx = canvas.getContext("2d");

  let bgImage = null;
  let bgFile = null;
  let selected = null;          // "background" | "title" | "subtitle" | "info" | null
  let drag = null;
  let guides = [];

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const round1 = (v) => Math.round(v * 10) / 10;

  const DEFAULTS = {
    version: 1, name: "", width: W, height: H,
    background: { file: null, zoom: 1, offsetX: 0, offsetY: 0 },
    overlay: { enabled: true, color: "#000000", opacity: 0.35 },
    title: {
      text: "Titel", font: "Arial Black", size: 150, color: "#FFFFFF",
      letterSpacing: 2, x: 960, y: 470,
    },
    underline: { enabled: true, color: "#F4B942", thickness: 16, offsetY: 28, widthPct: 0.8, height: 60 },
    subtitle: {
      text: "Untertitel", font: "Verdana", size: 52, color: "#E8E8E8",
      lineHeight: 1.25, letterSpacing: 1, x: 960, y: 610,
    },
    info: {
      x: 130, y: 830, width: 520, height: 160, radius: 30, brush: true,
      bgColor: "#FFFFFF", opacity: 0.97, iconColor: "#333333", textColor: "#222222",
      padX: 34, padY: 22, rowGap: 18, iconSize: 46,
      date: { text: "Heute", font: "Verdana", size: 44, weight: "bold" },
      location: { text: "Aula", font: "Verdana", size: 44, weight: "bold" },
      dateEnabled: true, locationEnabled: true,
    },
    grid: { snap: true, step: 24 },
    weather: { enabled: false, location: "", heading: "" },
  };

  function sec(name) {
    if (!project[name] || typeof project[name] !== "object") {
      project[name] = JSON.parse(JSON.stringify(DEFAULTS[name] || {}));
    }
    return project[name];
  }
  function mergeDefaults(target, source) {
    Object.keys(source).forEach((k) => {
      if (target[k] === undefined) target[k] = JSON.parse(JSON.stringify(source[k]));
    });
    return target;
  }
  mergeDefaults(project, DEFAULTS);

  /* ---------- kleine Helfer ---------- */

  function hexA(hex, alpha) {
    let h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (isNaN(n)) return "rgba(0,0,0," + alpha + ")";
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function rr(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function textLines(text) {
    return String(text == null ? "" : text).split("\n");
  }

  function measureLine(text, size, font, spacing) {
    ctx.font = `${size}px ${font}`;
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + spacing;
    if (text.length) w -= spacing;
    return w;
  }

  function drawSpacedText(text, centerX, centerY, size, font, color, spacing) {
    if (!text) return;
    ctx.fillStyle = color;
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let x = centerX - measureLine(text, size, font, spacing) / 2;
    for (const ch of text) {
      ctx.fillText(ch, x + ctx.measureText(ch).width / 2, centerY);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  /* ---------- Ebenen-Kästen (für Hit-Test, Auswahl und Einrasten) ---------- */

  function titleBox() {
    const t = sec("title");
    const lines = textLines(t.text).filter((l) => l.length);
    if (!lines.length) return null;
    const size = num(t.size, 150);
    const font = t.font || "Arial Black";
    const spacing = num(t.letterSpacing, 0);
    const lh = 1.15;
    const w = Math.max(...lines.map((l) => measureLine(l, size, font, spacing)));
    const h = lines.length * size * lh;
    return { left: t.x - w / 2, top: t.y - h / 2, cx: t.x, cy: t.y, right: t.x + w / 2, bottom: t.y + h / 2 };
  }

  function subtitleBox() {
    const s = sec("subtitle");
    const lines = textLines(s.text).filter((l) => l.length);
    if (!lines.length) return null;
    const size = num(s.size, 52);
    const font = s.font || "Verdana";
    const spacing = num(s.letterSpacing, 0);
    const lh = clamp(num(s.lineHeight, 1.25), 1, 3);
    const w = Math.max(...lines.map((l) => measureLine(l, size, font, spacing)));
    const h = lines.length * size * lh;
    return { left: s.x - w / 2, top: s.y - h / 2, cx: s.x, cy: s.y, right: s.x + w / 2, bottom: s.y + h / 2 };
  }

  function infoSize() {
    const i = sec("info");
    const iconSize = clamp(num(i.iconSize, 46), 10, 200);
    const rows = (i.dateEnabled !== false ? 1 : 0) + (i.locationEnabled !== false ? 1 : 0);
    const height = num(i.padY, 22) * 2 + rows * iconSize + Math.max(0, rows - 1) * num(i.rowGap, 18);
    return { width: num(i.width, 520), height: rows ? height : 0 };
  }

  function infoBox() {
    const i = sec("info");
    const s = infoSize();
    if (!s.height) return null;
    return { left: i.x, top: i.y, cx: i.x + s.width / 2, cy: i.y + s.height / 2, right: i.x + s.width, bottom: i.y + s.height };
  }

  function elementBox(which) {
    if (which === "title") return titleBox();
    if (which === "subtitle") return subtitleBox();
    if (which === "info") return infoBox();
    return null;
  }

  /* ---------- Zeichnen ---------- */

  function drawGrid() {
    const g = sec("grid");
    const step = clamp(num(g.step, 24), 8, 400);
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0.5; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function drawBackground() {
    const b = sec("background");
    if (bgImage) {
      const z = clamp(num(b.zoom, 1), 0.05, 5);
      const iw = bgImage.width * z;
      const ih = bgImage.height * z;
      const ox = clamp(num(b.offsetX, 0), Math.min(0, W - iw), 0);
      const oy = clamp(num(b.offsetY, 0), Math.min(0, H - ih), 0);
      ctx.drawImage(bgImage, ox, oy, iw, ih);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#182332");
    g.addColorStop(1, "#0b0e14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.38)";
    ctx.font = "600 46px Verdana, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Hintergrundbild hochladen", W / 2, H / 2 - 10);
    ctx.font = "400 30px Verdana, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.28)";
    ctx.fillText("oder ein Foto per Drag & Drop in die Vorschau ziehen", W / 2, H / 2 + 52);
  }

  function drawOverlay() {
    const o = sec("overlay");
    if (o.enabled === false) return;
    ctx.fillStyle = hexA(o.color || "#000000", clamp(num(o.opacity, 0.35), 0, 0.95));
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    const t = sec("title");
    const u = sec("underline");
    const lines = textLines(t.text).filter((l) => l.length);
    if (!lines.length) return;
    const size = clamp(num(t.size, 150), 10, 600);
    const font = t.font || "Arial Black";
    const spacing = num(t.letterSpacing, 0);
    const lh = 1.15;
    const y0 = num(t.y, 470) - ((lines.length - 1) * size * lh) / 2;
    lines.forEach((line, i) => {
      drawSpacedText(line, t.x, y0 + i * size * lh, size, font, t.color, spacing);
    });

    if (u.enabled !== false) {
      const last = lines[lines.length - 1];
      const tw = measureLine(last, size, font, spacing);
      const width = tw * clamp(num(u.widthPct, 0.8), 0.1, 1);
      const uy = y0 + (lines.length - 1) * size * lh + size / 2 + num(u.offsetY, 28);
      const bow = clamp(num(u.height, 60), 0, 400);
      ctx.strokeStyle = u.color || "#F4B942";
      ctx.lineWidth = clamp(num(u.thickness, 16), 1, 80);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(t.x - width / 2, uy);
      ctx.quadraticCurveTo(t.x, uy + bow * 0.9, t.x + width / 2, uy);
      ctx.stroke();
    }
  }

  function drawSubtitle() {
    const s = sec("subtitle");
    const lines = textLines(s.text).filter((l) => l.length);
    if (!lines.length) return;
    const size = clamp(num(s.size, 52), 10, 400);
    const font = s.font || "Verdana";
    const spacing = num(s.letterSpacing, 0);
    const lh = clamp(num(s.lineHeight, 1.25), 1, 3);
    const y0 = num(s.y, 610) - ((lines.length - 1) * size * lh) / 2;
    lines.forEach((line, i) => {
      drawSpacedText(line, s.x, y0 + i * size * lh, size, font, s.color, spacing);
    });
  }

  function drawCalendar(cx, cy, s, color) {
    const x = cx - s / 2, y = cy - s / 2;
    const lw = Math.max(2, s * 0.1);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    rr(x, y, s, s, s * 0.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y - s * 0.12);
    ctx.lineTo(x + s * 0.2, y + s * 0.18);
    ctx.moveTo(x + s * 0.8, y - s * 0.12);
    ctx.lineTo(x + s * 0.8, y + s * 0.18);
    ctx.moveTo(x, y + s * 0.36);
    ctx.lineTo(x + s, y + s * 0.36);
    ctx.stroke();
  }

  function drawPin(cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.18, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy - r * 0.12);
    ctx.lineTo(cx + r * 0.42, cy - r * 0.12);
    ctx.lineTo(cx, cy + r * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  function drawInfoBox() {
    const i = sec("info");
    const s = infoSize();
    if (!s.height) return;
    const iconSize = clamp(num(i.iconSize, 46), 10, 200);
    const padX = num(i.padX, 34);
    const padY = num(i.padY, 22);
    const rowGap = num(i.rowGap, 18);
    const radius = clamp(num(i.radius, 30), 0, 200);

    ctx.fillStyle = hexA(i.bgColor || "#FFFFFF", clamp(num(i.opacity, 0.97), 0, 1));
    rr(i.x, i.y, s.width, s.height, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.10)";
    ctx.lineWidth = 2;
    rr(i.x, i.y, s.width, s.height, radius);
    ctx.stroke();

    ctx.textBaseline = "middle";
    let row = 0;
    const rowY = (idx) => i.y + padY + idx * (iconSize + rowGap) + iconSize / 2;

    const drawRow = (iconFn, label, opts) => {
      const iconX = i.x + padX;
      const cy = rowY(row);
      iconFn(iconX + iconSize / 2, cy, iconSize);
      ctx.fillStyle = opts.color || "#222222";
      ctx.font = `${opts.weight || "bold"} ${clamp(num(opts.size, 44), 10, 300)}px ${opts.font || "Verdana"}`;
      ctx.textAlign = "left";
      ctx.fillText(label, iconX + iconSize + iconSize * 0.35, cy);
      row += 1;
    };

    if (i.dateEnabled !== false) {
      drawRow(drawCalendar, i.date.text || "Heute", { color: i.iconColor, ...i.date });
    }
    if (i.locationEnabled !== false) {
      drawRow(drawPin, i.location.text || "Aula", { color: i.iconColor, ...i.location });
    }
  }

  function drawSelection() {
    if (!selected || selected === "background") return;
    const b = elementBox(selected);
    if (!b) return;
    ctx.strokeStyle = "rgba(56,189,248,.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    rr(b.left, b.top, b.right - b.left, b.bottom - b.top, 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#38bdf8";
    [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawGuides() {
    guides.forEach((g) => {
      ctx.strokeStyle = "rgba(244,63,94,.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      if (g.axis === "x") { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, H); }
      else { ctx.moveTo(0, g.pos); ctx.lineTo(W, g.pos); }
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawOverlay();
    const g = sec("grid");
    if (g.enabled) drawGrid();
    drawTitle();
    drawSubtitle();
    drawInfoBox();
    drawSelection();
    drawGuides();
  }

  /* ---------- Interaktion ---------- */

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  function hitTest(p) {
    const order = ["info", "title", "subtitle"];
    for (const name of order) {
      const b = elementBox(name);
      if (b && p.x >= b.left - 10 && p.x <= b.right + 10 && p.y >= b.top - 10 && p.y <= b.bottom + 10) return name;
    }
    return "background";
  }

  function snapElement(name) {
    const el = sec(name);
    const b = elementBox(name);
    if (!b) return;
    const grid = sec("grid");
    const threshold = 14;
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    ["title", "subtitle", "info"].forEach((o) => {
      if (o === name) return;
      const ob = elementBox(o);
      if (!ob) return;
      xs.push(ob.left, ob.cx, ob.right);
      ys.push(ob.top, ob.cy, ob.bottom);
    });

    const xEdges = [b.left, b.cx, b.right];
    const yEdges = [b.top, b.cy, b.bottom];
    let bestX = null, bestY = null;

    xs.forEach((v) => {
      xEdges.forEach((e) => {
        const d = v - e;
        if (Math.abs(d) <= threshold && (bestX === null || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: v };
      });
    });
    ys.forEach((v) => {
      yEdges.forEach((e) => {
        const d = v - e;
        if (Math.abs(d) <= threshold && (bestY === null || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: v };
      });
    });

    if (grid.snap !== false) {
      if (bestX) { el.x = round1(el.x + bestX.d); guides.push({ axis: "x", pos: bestX.pos }); }
      if (bestY) { el.y = round1(el.y + bestY.d); guides.push({ axis: "y", pos: bestY.pos }); }
      if (!bestX) {
        const step = clamp(num(grid.step, 24), 8, 400);
        el.x = round1(Math.round(el.x / step) * step);
      }
      if (!bestY) {
        const step = clamp(num(grid.step, 24), 8, 400);
        el.y = round1(Math.round(el.y / step) * step);
      }
    } else {
      el.x = round1(el.x);
      el.y = round1(el.y);
    }
    el.x = clamp(el.x, 0, W);
    el.y = clamp(el.y, 0, H);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = canvasPoint(e);
    const hit = hitTest(p);
    selected = hit;
    if (hit === "background") {
      const b = sec("background");
      drag = { el: "background", startX: p.x, startY: p.y, origX: num(b.offsetX, 0), origY: num(b.offsetY, 0) };
    } else {
      const b = elementBox(hit);
      drag = b
        ? { el: hit, startX: p.x, startY: p.y, origX: b.cx, origY: b.cy }
        : null;
    }
    guides = [];
    canvas.setPointerCapture(e.pointerId);
    syncLayers();
    render();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = canvasPoint(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (drag.el === "background") {
      const b = sec("background");
      b.offsetX = round1(drag.origX + dx);
      b.offsetY = round1(drag.origY + dy);
      render();
      return;
    }
    const el = sec(drag.el);
    el.x = drag.origX + dx;
    el.y = drag.origY + dy;
    guides = [];
    snapElement(drag.el);
    render();
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    guides = [];
    render();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const b = sec("background");
    const cur = num(b.zoom, 1);
    b.zoom = clamp(round1(cur * (e.deltaY < 0 ? 1.08 : 0.92)), 0.05, 5);
    syncZoomControl();
    render();
  }, { passive: false });

  /* Drag & Drop eines Bildes auf die Vorschau */
  canvas.addEventListener("dragover", (e) => { e.preventDefault(); });
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.(jpe?g|png|gif|webp)$/i.test(f.name)) applyBackgroundFile(f);
  });

  /* ---------- Steuerungen ---------- */

  function bindText(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = get();
    el.addEventListener("input", () => { set(el.value); render(); });
  }

  function bindRange(id, valId, get, set, suffix) {
    const el = document.getElementById(id);
    if (!el) return;
    const val = valId ? document.getElementById(valId) : null;
    el.value = get();
    const upd = () => { if (val) val.textContent = el.value + (suffix === null ? "" : (suffix !== undefined ? suffix : "%")); };
    upd();
    el.addEventListener("input", () => { set(Number(el.value)); upd(); render(); });
  }

  function bindCheck(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!get();
    el.addEventListener("change", () => { set(el.checked); render(); });
  }

  function bindSelect(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = get();
    el.addEventListener("change", () => { set(el.value); render(); });
  }

  function bindColor(id, get, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = get() || "#000000";
    el.addEventListener("input", () => { set(el.value); render(); });
  }

  const nameInput = document.getElementById("ann-name");
  if (nameInput) nameInput.value = project.name || "";

  /* Hintergrund */
  const bgFileInput = document.getElementById("ann-bg-file");
  const applyBackgroundFile = (file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { bgImage = img; bgFile = file; render(); };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  };
  if (bgFileInput) {
    bgFileInput.addEventListener("change", () => {
      const f = bgFileInput.files && bgFileInput.files[0];
      if (f) applyBackgroundFile(f);
    });
  }

  const bgZoomEl = document.getElementById("ann-bg-zoom");
  const bgZoomVal = document.getElementById("ann-bg-zoom-val");
  function syncZoomControl() {
    if (!bgZoomEl) return;
    bgZoomEl.value = Math.round(num(sec("background").zoom, 1) * 100);
    if (bgZoomVal) bgZoomVal.textContent = bgZoomEl.value + "%";
  }
  if (bgZoomEl) {
    syncZoomControl();
    bgZoomEl.addEventListener("input", () => {
      sec("background").zoom = clamp(Number(bgZoomEl.value) / 100, 0.05, 5);
      syncZoomControl();
      render();
    });
  }

  document.getElementById("ann-bg-reset").addEventListener("click", () => {
    const b = sec("background");
    b.zoom = 1; b.offsetX = 0; b.offsetY = 0;
    syncZoomControl();
    render();
  });

  document.getElementById("ann-bg-clear").addEventListener("click", () => {
    bgImage = null;
    bgFile = null;
    sec("background").file = null;
    syncZoomControl();
    render();
  });

  /* Overlay */
  bindRange("ann-overlay-opacity", "ann-overlay-opacity-val",
    () => Math.round(num(sec("overlay").opacity, 0.35) * 100),
    (v) => { sec("overlay").opacity = v / 100; }, "%");
  bindColor("ann-overlay-color", () => sec("overlay").color, (v) => { sec("overlay").color = v; });

  /* Titel */
  bindText("ann-title-text", () => sec("title").text, (v) => { sec("title").text = v; });
  bindSelect("ann-title-font", () => sec("title").font, (v) => { sec("title").font = v; });
  bindRange("ann-title-size", "ann-title-size-val",
    () => num(sec("title").size, 150), (v) => { sec("title").size = v; }, "px");
  bindRange("ann-title-spacing", "ann-title-spacing-val",
    () => num(sec("title").letterSpacing, 0), (v) => { sec("title").letterSpacing = v; }, "px");
  bindColor("ann-title-color", () => sec("title").color, (v) => { sec("title").color = v; });

  /* Linie */
  bindCheck("ann-underline-enabled", () => sec("underline").enabled !== false, (v) => { sec("underline").enabled = v; });
  bindRange("ann-underline-width", "ann-underline-width-val",
    () => Math.round(num(sec("underline").widthPct, 0.8) * 100),
    (v) => { sec("underline").widthPct = v / 100; }, "%");
  bindRange("ann-underline-thickness", "ann-underline-thickness-val",
    () => num(sec("underline").thickness, 16), (v) => { sec("underline").thickness = v; }, "px");
  bindRange("ann-underline-offset", "ann-underline-offset-val",
    () => num(sec("underline").offsetY, 28), (v) => { sec("underline").offsetY = v; }, "px");
  bindColor("ann-underline-color", () => sec("underline").color, (v) => { sec("underline").color = v; });

  /* Untertitel */
  bindText("ann-subtitle-text", () => sec("subtitle").text, (v) => { sec("subtitle").text = v; });
  bindSelect("ann-subtitle-font", () => sec("subtitle").font, (v) => { sec("subtitle").font = v; });
  bindRange("ann-subtitle-size", "ann-subtitle-size-val",
    () => num(sec("subtitle").size, 52), (v) => { sec("subtitle").size = v; }, "px");
  bindRange("ann-subtitle-lineheight", "ann-subtitle-lineheight-val",
    () => Math.round(num(sec("subtitle").lineHeight, 1.25) * 100),
    (v) => { sec("subtitle").lineHeight = v / 100; }, "%");
  bindRange("ann-subtitle-spacing", "ann-subtitle-spacing-val",
    () => num(sec("subtitle").letterSpacing, 0), (v) => { sec("subtitle").letterSpacing = v; }, "px");
  bindColor("ann-subtitle-color", () => sec("subtitle").color, (v) => { sec("subtitle").color = v; });

  /* Info-Feld */
  bindCheck("ann-info-date-enabled", () => sec("info").dateEnabled !== false, (v) => { sec("info").dateEnabled = v; });
  bindText("ann-info-date-text", () => (sec("info").date || {}).text || "", (v) => { sec("info").date.text = v; });
  bindCheck("ann-info-location-enabled", () => sec("info").locationEnabled !== false, (v) => { sec("info").locationEnabled = v; });
  bindText("ann-info-location-text", () => (sec("info").location || {}).text || "", (v) => { sec("info").location.text = v; });
  bindRange("ann-info-width", "ann-info-width-val",
    () => num(sec("info").width, 520), (v) => { sec("info").width = v; }, "px");
  bindRange("ann-info-iconsize", "ann-info-iconsize-val",
    () => num(sec("info").iconSize, 46), (v) => { sec("info").iconSize = v; }, "px");
  bindColor("ann-info-textcolor", () => sec("info").textColor, (v) => { sec("info").textColor = v; });

  /* Raster & Einrasten */
  bindCheck("ann-grid-enabled", () => sec("grid").enabled === true, (v) => { sec("grid").enabled = v; });
  const snapBtn = document.getElementById("ann-snap-enabled");
  function syncSnapBtn() {
    const on = sec("grid").snap !== false;
    snapBtn.classList.toggle("active", on);
    snapBtn.textContent = on ? "Einrasten an" : "Einrasten aus";
  }
  if (snapBtn) {
    syncSnapBtn();
    snapBtn.addEventListener("click", () => {
      sec("grid").snap = sec("grid").snap === false;
      syncSnapBtn();
      render();
    });
  }

  /* Ebenen-Anzeige */
  const layers = document.getElementById("ann-layers");
  const selectedLayer = document.getElementById("ann-selected-layer");
  function syncLayers() {
    if (!layers) return;
    Array.from(layers.children).forEach((c) => c.classList.toggle("active", c.dataset.layer === selected));
    if (selectedLayer) selectedLayer.textContent = selected ? "Ausgewählt: " + selected : "";
  }

  /* Wetterseite */
  bindCheck("ann-weather-enabled", () => sec("weather").enabled === true, (v) => { sec("weather").enabled = v; });
  bindText("ann-weather-location", () => sec("weather").location || "", (v) => { sec("weather").location = v; });
  bindText("ann-weather-heading", () => sec("weather").heading || "", (v) => { sec("weather").heading = v; });

  /* ---------- Speichern ---------- */

  const saveBtn = document.getElementById("ann-save-btn");
  const saveStatus = document.getElementById("ann-save-status");
  const csrfToken = () => document.querySelector('meta[name="csrf-token"]').content;

  saveBtn.addEventListener("click", async () => {
    saveStatus.classList.remove("error");
    saveStatus.textContent = "Wird gespeichert …";
    const btnText = saveBtn.textContent;
    saveBtn.disabled = true;
    try {
      project.name = (nameInput && nameInput.value.trim()) || project.name || "Ankündigungsbild";
      render();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("Bild konnte nicht erzeugt werden.");

      const fd = new FormData();
      fd.append("file", blob, "announcement.png");
      fd.append("project", JSON.stringify(project));
      fd.append("name", project.name);
      if (bgFile) fd.append("background", bgFile);

      const res = await fetch(mediaId ? `/api/announcements/${mediaId}` : "/api/announcements", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken() },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
      saveStatus.textContent = "Gespeichert.";
      if (window.toast) window.toast("Ankündigungsbild gespeichert.", "ok");
      setTimeout(() => { window.location.href = "/admin/media"; }, 700);
    } catch (err) {
      saveStatus.textContent = err.message;
      saveStatus.classList.add("error");
      saveBtn.disabled = false;
      saveBtn.textContent = btnText;
    }
  });

  /* ---------- Start ---------- */

  function syncAfterLoad() {
    syncZoomControl();
    syncSnapBtn();
    syncLayers();
  }

  async function loadBackground() {
    const b = sec("background");
    const name = b.file;
    if (!name) { render(); return; }
    try {
      const img = new Image();
      img.onload = () => { bgImage = img; render(); };
      img.onerror = () => { bgImage = null; render(); };
      img.src = bgPrefix + encodeURIComponent(name);
    } catch (err) {
      bgImage = null;
      render();
    }
  }

  syncAfterLoad();
  loadBackground();
})();
