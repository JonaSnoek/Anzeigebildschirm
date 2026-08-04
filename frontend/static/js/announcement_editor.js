/*
 * Digital Signage – Editor für Ankündigungsbilder (elementbasiert).
 *
 * Das Design besteht nicht mehr aus wenigen festen Eingabefeldern, sondern
 * aus frei platzierbaren Elementen auf einer 1920×1080-Leinwand: Textboxen
 * (Überschrift, Unterüberschrift, Datum, Standort …), Bilder/Logos, Icons,
 * Formen (Rechtecke, Linien, Akzentstreifen, Glas-Kästen) und ein
 * Wetter-Widget. Jedes Element lässt sich verschieben, skalieren, drehen,
 * kopieren, löschen und über die Ebenen sortieren. Die Vorschau wird live
 * auf dem <canvas> gezeichnet; beim Speichern entsteht das fertige PNG als
 * normales Bildmedium plus die editierbare Projektdatei (JSON).
 *
 * Zusätzlich gibt es Design-Vorlagen (eingebaut + gespeicherte), Raster mit
 * magnetischem Einrasten und Hilfslinien sowie die konfigurierbare eigene
 * Wetterseite nach dem Bild.
 */

"use strict";

(function () {
  const page = document.getElementById("announcement-page");
  if (!page) return;

  const W = 1920, H = 1080;
  const mediaId = window.ANNOUNCEMENT_MEDIA_ID || null;
  const isNew = window.ANNOUNCEMENT_IS_NEW !== false;
  const bgPrefix = window.ANNOUNCEMENT_BG_PREFIX || "/api/announcements/bg/";

  /* Sprachliche Bearbeitung: Jedes Ankündigungsbild wird mehrsprachig
     erstellt (DE/EN). Beim Speichern entsteht eine PNG-Datei je Sprache;
     das Display wählt automatisch die passende Variante. */
  const DEFAULT_LANG = "de";
  const EDITOR_LANGS = ["de", "en"];
  const LANG_LABELS = { de: "Deutsch", en: "English" };
  let editorLang = DEFAULT_LANG;   // aktuell bearbeitete/gerenderte Sprache
  let exporting = false;           // Export: keine Auswahl-/Warn-Overlays

  let project = window.ANNOUNCEMENT_PROJECT && typeof window.ANNOUNCEMENT_PROJECT === "object"
    ? window.ANNOUNCEMENT_PROJECT
    : {};

  const canvas = document.getElementById("ann-canvas");
  const ctx = canvas.getContext("2d");

  /* ------------------------------------------------------------------ *
   *  Helfer
   * ------------------------------------------------------------------ */
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const round1 = (v) => Math.round(v * 10) / 10;
  let uidCounter = 0;
  const uid = () => "e" + (++uidCounter) + "_" + Math.random().toString(36).slice(2, 8);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function hexA(hex, alpha) {
    let h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (isNaN(n)) return "rgba(0,0,0," + alpha + ")";
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function pathGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function pathSet(obj, path, value) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const rad = clamp(num(r, 0), 0, Math.min(w, h) / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  const FONTS = [
    "Arial Black", "Arial", "Verdana", "Georgia", "Trebuchet MS", "Courier New",
    "Tahoma", "Impact", "Times New Roman", "Comic Sans MS", "Segoe UI", "Palatino Linotype",
  ];

  /* ------------------------------------------------------------------ *
   *  Icon-Bibliothek (24×24-Stroke-Pfade)
   * ------------------------------------------------------------------ */
  const ICONS = {
    calendar: "M4 6h16v15H4z M4 10h16 M8 3v5 M16 3v5",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 3",
    pin: "M12 21s-7-6.5-7-11.5A7 7 0 0 1 12 3a7 7 0 0 1 7 6.5C19 14.5 12 21 12 21z M12 11.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    bus: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 10h18 M8 6v4 M16 6v4 M8 18v2 M16 18v2 M8.5 17a.6.6 0 1 0 0 1.2 M15.5 17a.6.6 0 1 0 0 1.2",
    train: "M4 5h16l-1.5 9h-13z M3.5 5h17 M7 5l1 3 M17 5l-1 3 M7.5 17a.6.6 0 1 0 0 1.2 M16.5 17a.6.6 0 1 0 0 1.2 M6 17h12 M8 20l-1 2 M16 20l1 2",
    plane: "M3 11l18-7-7 16-3-5-8-4z M12 15l4-6",
    food: "M4 8h16a8 8 0 0 1-16 0z M3 11h18 M4 15h16 M7 15l-1 3 M17 15l1 3 M8 18l-1 3 M16 18l1 3",
    drink: "M6 8h12l-1 10a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3L6 8z M17 8l1 3 M5 4h14",
    museum: "M4 21h16 M5 17h14 M5 17l-1-6h16l-1 6 M12 3L4 8h16L12 3z M10 17v-3 M12 17v-3 M14 17v-3",
    school: "M12 3L3 8l9 5 9-5-9-5z M5 10.5V16c0 1.5 3 3 7 3s7-1.5 7-3v-5.5 M12 21v-3",
    sport: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3.6 9h16.8 M3.6 15h16.8 M12 3a15 15 0 0 1 0 18 M12 3a15 15 0 0 0 0 18",
    star: "M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9L12 3z",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 7.5v.5",
    warning: "M12 3l10 18H2L12 3z M12 10v5 M12 18v.5",
    check: "M4 12l5 5L20 6",
    heart: "M12 20s-7-4.5-7-9.5A4.4 4.4 0 0 1 12 6a4.4 4.4 0 0 1 7 4.5C19 15.5 12 20 12 20z",
    mail: "M3 5h18v14H3z M3 7l9 6 9-6",
    music: "M9 18V5l10-2v13 M9 18a2 2 0 1 1-2-2 2 2 0 0 1 2 2z M19 16a2 2 0 1 1-2-2 2 2 0 0 1 2 2z",
    book: "M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z M12 6v14",
    arrow: "M4 12h16 M13 5l7 7-7 7",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
    camera: "M3 7h4l2-2h6l2 2h4v12H3z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    money: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v10 M15 9.5c0-1-1.5-2-3-2s-3 1-3 2 1 1.6 3 2 3 1 3 2-1.5 2-3 2-3-1-3-2",
  };
  const ICON_LABELS = {
    calendar: "Kalender", clock: "Uhr", pin: "Standort", bus: "Bus", train: "Zug",
    plane: "Flugzeug", food: "Essen", drink: "Getränke", museum: "Museum", school: "Schule",
    sport: "Sport", star: "Stern", info: "Info", warning: "Warnung", check: "Haken",
    heart: "Herz", mail: "Brief", music: "Musik", book: "Buch", arrow: "Pfeil",
    phone: "Telefon", camera: "Kamera", money: "Preis",
  };

  function drawIcon(c, name, x, y, w, h, color, lw) {
    const path = ICONS[name] || ICONS.star;
    c.save();
    c.translate(x, y);
    c.scale(w / 24, h / 24);
    c.strokeStyle = color;
    c.lineWidth = num(lw, 2.1);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.stroke(new Path2D(path));
    c.restore();
  }

  function iconSvg(name, size) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${esc(ICONS[name] || ICONS.star)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  /* ------------------------------------------------------------------ *
   *  QR-Code-Encoder (byte mode, Versionen 1–10, ECC L/M/Q/H)
   *  Clientseitig, damit Live-Vorschau und Export identisch sind.
   * ------------------------------------------------------------------ */
  const QRGen = (() => {
    const EC_INDEX = { L: 1, M: 0, Q: 3, H: 2 };
    const EC_BYTES = [
      [0, 0, 0, 0],
      [10, 7, 17, 13],
      [16, 10, 28, 22],
      [26, 15, 22, 18],
      [18, 20, 16, 26],
      [24, 26, 22, 18],
      [16, 18, 28, 24],
      [18, 20, 26, 18],
      [22, 24, 26, 22],
      [22, 30, 24, 20],
      [26, 18, 28, 24],
    ];
    const BLOCKS = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 2, 2],
      [2, 1, 4, 2],
      [2, 1, 4, 4],
      [4, 2, 4, 4],
      [4, 2, 5, 6],
      [4, 2, 6, 6],
      [5, 2, 8, 8],
      [5, 4, 8, 8],
    ];
    const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

    const EXP = new Array(512);
    const LOG = new Array(256);
    (function () {
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
      }
      for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    })();
    const gm = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

    function rsEncode(data, ecLen) {
      let gen = [1];
      for (let i = 0; i < ecLen; i++) {
        const root = EXP[i];
        const next = new Array(gen.length + 1).fill(0);
        for (let j = 0; j < gen.length; j++) {
          next[j] ^= gen[j];
          next[j + 1] ^= gm(gen[j], root);
        }
        gen = next;
      }
      const res = new Array(ecLen).fill(0);
      for (const d of data) {
        const factor = d ^ res[0];
        for (let j = 0; j < ecLen - 1; j++) res[j] = res[j + 1];
        res[ecLen - 1] = 0;
        if (factor) {
          const lg = LOG[factor];
          for (let j = 0; j < ecLen; j++) res[j] ^= EXP[LOG[gen[j + 1]] + lg];
        }
      }
      return res;
    }

    const MASKS = [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
      (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
    ];

    const bitLen = (n) => {
      let d = 0;
      while (n !== 0) { d++; n >>>= 1; }
      return d;
    };
    const bch15 = (data) => {
      let d = data << 10;
      while (bitLen(d) - bitLen(0x537) >= 0) d ^= 0x537 << (bitLen(d) - bitLen(0x537));
      return ((data << 10) | d) ^ 0x5412;
    };
    const bch18 = (data) => {
      let d = data << 12;
      while (bitLen(d) - bitLen(0x1f25) >= 0) d ^= 0x1f25 << (bitLen(d) - bitLen(0x1f25));
      return (data << 12) | d;
    };

    let modules = null;
    let func = null;
    let size = 0;
    let version = 0;
    let eclIdx = 0;

    function setupFinder(r0, c0) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r, cc = c0 + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
            (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          modules[rr][cc] = on;
          func[rr][cc] = true;
        }
      }
    }

    function setupAlignment() {
      const pos = ALIGN[version];
      if (!pos) return;
      for (const ar of pos) {
        for (const ac of pos) {
          if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              const on = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
              modules[ar + r][ac + c] = on;
              func[ar + r][ac + c] = true;
            }
          }
        }
      }
    }

    function setupTiming() {
      for (let i = 8; i < size - 8; i++) {
        if (!func[6][i]) { modules[6][i] = i % 2 === 0; func[6][i] = true; }
        if (!func[i][6]) { modules[i][6] = i % 2 === 0; func[i][6] = true; }
      }
    }

    function setupTypeInfo(test, maskPattern) {
      const data = (eclIdx << 3) | maskPattern;
      const bits = bch15(data);
      for (let i = 0; i < 15; i++) {
        const mod = !test && ((bits >> i) & 1) === 1;
        if (i < 6) { modules[i][8] = mod; func[i][8] = true; }
        else if (i < 8) { modules[i + 1][8] = mod; func[i + 1][8] = true; }
        else { modules[size - 15 + i][8] = mod; func[size - 15 + i][8] = true; }
        if (i < 8) { modules[8][size - i - 1] = mod; func[8][size - i - 1] = true; }
        else if (i < 9) { modules[8][15 - i - 1 + 1] = mod; func[8][15 - i - 1 + 1] = true; }
        else { modules[8][15 - i - 1] = mod; func[8][15 - i - 1] = true; }
      }
      modules[size - 8][8] = !test;
      func[size - 8][8] = true;
    }

    function setupTypeNumber(test) {
      const bits = bch18(version);
      for (let i = 0; i < 18; i++) {
        const mod = !test && ((bits >> i) & 1) === 1;
        modules[Math.floor(i / 3)][(i % 3) + size - 11] = mod;
        func[Math.floor(i / 3)][(i % 3) + size - 11] = true;
        modules[(i % 3) + size - 11][Math.floor(i / 3)] = mod;
        func[(i % 3) + size - 11][Math.floor(i / 3)] = true;
      }
    }

    function createData(bytes) {
      const ecLen = EC_BYTES[version][eclIdx];
      const blocks = BLOCKS[version][eclIdx];
      const dataTotal = TOTAL[version] - ecLen * blocks;
      const shortData = Math.floor(dataTotal / blocks);
      const longCount = dataTotal % blocks;
      const shortCount = blocks - longCount;

      const bits = [];
      const push = (n, len) => { for (let i = len - 1; i >= 0; i--) bits.push((n >> i) & 1); };
      push(0x4, 4);
      push(bytes.length, version >= 10 ? 16 : 8);
      for (const b of bytes) push(b, 8);
      const rem = dataTotal * 8 - bits.length;
      if (rem > 0) push(0, Math.min(4, rem));
      while (bits.length % 8 !== 0) bits.push(0);
      let pad = 0xec;
      while (bits.length < dataTotal * 8) { push(pad, 8); pad = pad === 0xec ? 0x11 : 0xec; }

      const dataCW = [];
      for (let i = 0; i < dataTotal; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
        dataCW.push(b);
      }

      const dataBlocks = [];
      let ptr = 0;
      for (let i = 0; i < blocks; i++) {
        const d = i < shortCount ? shortData : shortData + 1;
        dataBlocks.push(dataCW.slice(ptr, ptr + d));
        ptr += d;
      }
      const ecBlocks = dataBlocks.map((d) => rsEncode(d, ecLen));
      const out = [];
      for (let i = 0; i < shortData + (longCount ? 1 : 0); i++) {
        for (let b = 0; b < blocks; b++) {
          if (i < dataBlocks[b].length) out.push(dataBlocks[b][i]);
        }
      }
      for (let i = 0; i < ecLen; i++) {
        for (let b = 0; b < blocks; b++) out.push(ecBlocks[b][i]);
      }
      return out;
    }

    function mapData(data, maskPattern) {
      const dataBits = [];
      for (const byte of data) for (let i = 7; i >= 0; i--) dataBits.push((byte >> i) & 1);
      let bitIndex = 0;
      let inc = -1;
      let row = size - 1;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (!func[row][col - c]) {
              let dark = false;
              if (bitIndex < dataBits.length) dark = dataBits[bitIndex];
              bitIndex++;
              if (MASKS[maskPattern](row, col - c)) dark = !dark;
              modules[row][col - c] = dark;
              func[row][col - c] = true;
            }
          }
          row += inc;
          if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
      }
    }

    function lostPoint() {
      let lost = 0;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          let same = 0;
          const dark = modules[row][col];
          for (let r = -1; r <= 1; r++) {
            if (row + r < 0 || row + r >= size) continue;
            for (let c = -1; c <= 1; c++) {
              if (r === 0 && c === 0) continue;
              if (col + c < 0 || col + c >= size) continue;
              if (dark === modules[row + r][col + c]) same++;
            }
          }
          if (same > 5) lost += 3 + same - 5;
        }
      }
      for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
          let count = 0;
          if (modules[row][col]) count++;
          if (modules[row + 1][col]) count++;
          if (modules[row][col + 1]) count++;
          if (modules[row + 1][col + 1]) count++;
          if (count === 0 || count === 4) lost += 3;
        }
      }
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size - 6; col++) {
          if (modules[row][col] && !modules[row][col + 1] && modules[row][col + 2] &&
              modules[row][col + 3] && modules[row][col + 4] && !modules[row][col + 5] && modules[row][col + 6]) {
            lost += 40;
          }
        }
      }
      for (let col = 0; col < size; col++) {
        for (let row = 0; row < size - 6; row++) {
          if (modules[row][col] && !modules[row + 1][col] && modules[row + 2][col] &&
              modules[row + 3][col] && modules[row + 4][col] && !modules[row + 5][col] && modules[row + 6][col]) {
            lost += 40;
          }
        }
      }
      let darkCount = 0;
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) darkCount++;
      const ratio = Math.abs((100 * darkCount) / size / size - 50) / 5;
      lost += ratio * 10;
      return lost;
    }

    function makeImpl(bytes, maskPattern, test) {
      size = version * 4 + 17;
      modules = [];
      func = [];
      for (let i = 0; i < size; i++) {
        modules.push(new Array(size).fill(false));
        func.push(new Array(size).fill(false));
      }
      setupFinder(0, 0);
      setupFinder(size - 7, 0);
      setupFinder(0, size - 7);
      setupAlignment();
      setupTiming();
      setupTypeInfo(test, maskPattern);
      if (version >= 7) setupTypeNumber(test);
      mapData(bytes, maskPattern);
    }

    function make(input, ecl) {
      const enc = new TextEncoder().encode(String(input || ""));
      ecl = (ecl || "M").toUpperCase();
      if (!(ecl in EC_INDEX)) ecl = "M";
      eclIdx = EC_INDEX[ecl];
      version = 0;
      for (let v = 1; v <= 10; v++) {
        const dataCW = TOTAL[v] - EC_BYTES[v][eclIdx] * BLOCKS[v][eclIdx];
        const cap = Math.floor((dataCW * 8 - 4 - (v >= 10 ? 16 : 8)) / 8);
        if (enc.length <= cap) { version = v; break; }
      }
      if (!version) return null;
      const data = createData(enc);
      let bestMask = 0, minLoss = Infinity;
      for (let m = 0; m < 8; m++) {
        makeImpl(data, m, true);
        const loss = lostPoint();
        if (loss < minLoss) { minLoss = loss; bestMask = m; }
      }
      makeImpl(data, bestMask, false);
      const out = [];
      for (let r = 0; r < size; r++) out.push(modules[r].slice());
      return out;
    }

    return { make };
  })();

  /* ------------------------------------------------------------------ *
   *  Element-Fabriken
   * ------------------------------------------------------------------ */
  function textEl(over) {
    const o = over || {};
    const texts = o.texts && typeof o.texts === "object"
      ? Object.assign({}, o.texts)
      : { [DEFAULT_LANG]: o.text != null ? String(o.text) : "Text" };
    return Object.assign({
      id: uid(), type: "text", x: 100, y: 100, w: 900, h: 110, rotation: 0, opacity: 1,
      text: o.text != null ? String(o.text) : (texts[DEFAULT_LANG] != null ? String(texts[DEFAULT_LANG]) : "Text"),
      font: "Verdana", size: 60, color: "#FFFFFF",
      bgColor: "", bgOpacity: 0, radius: 14, glass: false,
      bold: false, italic: false, underline: false, strike: false, caseMode: "none",
      lineHeight: 1.25, letterSpacing: 0, align: "left", valign: "middle", pad: 16,
      shadow: { enabled: false, color: "rgba(0,0,0,.6)", blur: 10, dx: 0, dy: 4 },
      outline: { enabled: false, color: "#000000", width: 3 },
    }, o, { texts });
  }
  function shapeEl(over) {
    return Object.assign({
      id: uid(), type: "shape", shape: "rect", x: 100, y: 100, w: 300, h: 80,
      rotation: 0, opacity: 1,
      fillColor: "#FFFFFF", fillOpacity: 1, strokeColor: "", strokeWidth: 0,
      radius: 16, glass: false,
      shadow: { enabled: false, color: "rgba(0,0,0,.6)", blur: 16, dx: 0, dy: 6 },
      gradient: { enabled: false, from: "#ffffff", to: "#ffffff", angle: 90 },
    }, over || {});
  }
  function imageEl(over) {
    return Object.assign({
      id: uid(), type: "image", x: 100, y: 100, w: 300, h: 200, rotation: 0, opacity: 1,
      file: "", fit: "cover", crop: null, radius: 0,
    }, over || {});
  }
  function iconEl(over) {
    return Object.assign({
      id: uid(), type: "icon", x: 100, y: 100, w: 60, h: 60, rotation: 0, opacity: 1,
      icon: "star", color: "#FFFFFF",
    }, over || {});
  }
  function weatherEl(over) {
    const o = over || {};
    const locations = o.locations && typeof o.locations === "object"
      ? Object.assign({}, o.locations)
      : { [DEFAULT_LANG]: o.location != null ? String(o.location) : "" };
    return Object.assign({
      id: uid(), type: "weather", x: 100, y: 100, w: 560, h: 150, rotation: 0, opacity: 1,
      location: o.location != null ? String(o.location) : "",
      font: "Verdana", size: 42, textColor: "#FFFFFF",
      accentColor: "#7fb2ff", iconColor: "#8fc7ff",
      bgColor: "#0b1220", bgOpacity: 0.55, glass: true, radius: 24,
      showIcon: true, showDesc: true, showTemp: true,
    }, o, { locations });
  }
  function qrcodeEl(over) {
    return Object.assign({
      id: uid(), type: "qrcode", x: 100, y: 100, w: 320, h: 320, rotation: 0, opacity: 1,
      url: "", color: "#0b1220", bg: "white", quietZone: true, ecc: "M",
    }, over || {});
  }

  /* ------------------------------------------------------------------ *
   *  Migration alter Projektversionen (v1 -> v2)
   * ------------------------------------------------------------------ */
  function migrateProject(p) {
    if (p && p.version === 2 && Array.isArray(p.elements)) {
      normalizeLocalization(p);
      return p;
    }
    p = p || {};
    const elements = [];
    const title = p.title || {}, underline = p.underline || {};
    const subtitle = p.subtitle || {}, info = p.info || {};
    const bg = p.background || {}, ov = p.overlay || {};

    if (title.text != null && String(title.text).trim() !== "") {
      elements.push(textEl({
        text: String(title.text), font: title.font || "Arial Black",
        size: num(title.size, 150), color: title.color || "#FFFFFF",
        letterSpacing: num(title.letterSpacing, 2), align: "center",
        x: num(title.x, 960) - 800, y: num(title.y, 470) - 85, w: 1600, h: 170,
        bold: true,
        shadow: { enabled: true, color: "rgba(0,0,0,.55)", blur: 12, dx: 0, dy: 5 },
      }));
      if (underline.enabled !== false) {
        const tw = Math.max(300, num(title.size, 150) * 6);
        const th = clamp(num(underline.thickness, 16), 4, 40);
        elements.push(shapeEl({
          shape: "rect",
          x: num(title.x, 960) - tw / 2,
          y: num(title.y, 470) + num(title.size, 150) * 0.62,
          w: tw, h: th, radius: th / 2,
          gradient: { enabled: true, from: underline.color || "#F4B942", to: underline.color || "#F4B942", angle: 90 },
          fillColor: underline.color || "#F4B942",
        }));
      }
    }
    if (subtitle.text != null && String(subtitle.text).trim() !== "") {
      elements.push(textEl({
        text: String(subtitle.text), font: subtitle.font || "Verdana",
        size: num(subtitle.size, 52), color: subtitle.color || "#E8E8E8",
        letterSpacing: num(subtitle.letterSpacing, 1), lineHeight: num(subtitle.lineHeight, 1.25),
        align: "center",
        x: num(subtitle.x, 960) - 700, y: num(subtitle.y, 610) - 70, w: 1400, h: 150,
      }));
    }
    if (info && (info.dateEnabled !== false || info.locationEnabled !== false)) {
      const ix = num(info.x, 130), iy = num(info.y, 830);
      const iw = num(info.width, 520), ih = num(info.height, 160);
      const ics = clamp(num(info.iconSize, 46), 10, 200);
      elements.push(shapeEl({
        shape: "rect", x: ix, y: iy, w: iw, h: ih, radius: num(info.radius, 30),
        fillColor: info.bgColor || "#FFFFFF", fillOpacity: num(info.opacity, 0.97), glass: false,
        shadow: { enabled: true, color: "rgba(0,0,0,.3)", blur: 20, dx: 0, dy: 8 },
      }));
      let r = 0;
      const padX = num(info.padX, 34), padY = num(info.padY, 22), rowGap = num(info.rowGap, 18);
      const rowY = (i) => iy + padY + i * (ics + rowGap) + ics / 2;
      if (info.dateEnabled !== false) {
        elements.push(iconEl({ icon: "calendar", x: ix + padX, y: rowY(0) - ics / 2, w: ics, h: ics, color: info.iconColor || "#333333" }));
        elements.push(textEl({
          text: (info.date && info.date.text) || "Heute", font: (info.date && info.date.font) || "Verdana",
          size: num(info.date && info.date.size, 44), color: info.textColor || "#222222",
          bold: (info.date && info.date.weight) === "bold",
          x: ix + padX + ics * 1.35, y: rowY(0) - 34, w: iw - ics * 2, h: 68, align: "left", valign: "middle",
        }));
        r++;
      }
      if (info.locationEnabled !== false) {
        elements.push(iconEl({ icon: "pin", x: ix + padX, y: rowY(r) - ics / 2, w: ics, h: ics, color: info.iconColor || "#333333" }));
        elements.push(textEl({
          text: (info.location && info.location.text) || "Aula", font: (info.location && info.location.font) || "Verdana",
          size: num(info.location && info.location.size, 44), color: info.textColor || "#222222",
          bold: (info.location && info.location.weight) === "bold",
          x: ix + padX + ics * 1.35, y: rowY(r) - 34, w: iw - ics * 2, h: 68, align: "left", valign: "middle",
        }));
      }
    }

    const out = {
      version: 2,
      name: p.name || "",
      width: W, height: H,
      background: bg.file
        ? { file: bg.file, zoom: num(bg.zoom, 1), offsetX: num(bg.offsetX, 0), offsetY: num(bg.offsetY, 0), color: "#182332", color2: "#0b0e14" }
        : { file: null, zoom: 1, offsetX: 0, offsetY: 0, color: "#182332", color2: "#0b0e14" },
      overlay: { enabled: ov.enabled !== false, color: ov.color || "#000000", opacity: num(ov.opacity, 0.35) },
      grid: { enabled: false, snap: (p.grid && p.grid.snap) !== false, step: num(p.grid && p.grid.step, 24) },
      elements: elements,
      weather: {
        enabled: !!(p.weather && p.weather.enabled),
        location: (p.weather && p.weather.location) || "",
        heading: (p.weather && p.weather.heading) || "",
      },
    };
    normalizeLocalization(out);
    return out;
  }

  /* Stellt sicher, dass mehrsprachige Felder (texts/locations/heading)
     überall als Sprach-Map vorliegen – alte Projekte mit einem String
     werden automatisch auf die Standardsprache (Deutsch) übertragen. */
  function normalizeLocalization(p) {
    if (!Array.isArray(p.languages) || !p.languages.length) p.languages = EDITOR_LANGS.slice();
    if (!p.languages.includes(DEFAULT_LANG)) p.languages.unshift(DEFAULT_LANG);
    p.defaultLanguage = DEFAULT_LANG;
    const w = p.weather || {};
    if (w.heading && typeof w.heading === "string") {
      w.heading = { [DEFAULT_LANG]: w.heading };
    } else if (w.heading && typeof w.heading === "object") {
      if (!w.heading[DEFAULT_LANG]) {
        const first = Object.values(w.heading).find((v) => v != null && String(v) !== "");
        w.heading[DEFAULT_LANG] = first != null ? String(first) : "";
      }
    } else {
      w.heading = { [DEFAULT_LANG]: "" };
    }
    for (const el of p.elements || []) {
      if (el.type === "text") {
        if (!el.texts || typeof el.texts !== "object") {
          el.texts = {};
          if (el.text != null) el.texts[DEFAULT_LANG] = String(el.text);
        }
        if (el.texts[DEFAULT_LANG] == null && el.text != null) el.texts[DEFAULT_LANG] = String(el.text);
      } else if (el.type === "weather") {
        if (!el.locations || typeof el.locations !== "object") {
          el.locations = {};
          if (el.location != null) el.locations[DEFAULT_LANG] = String(el.location);
        }
        if (el.locations[DEFAULT_LANG] == null && el.location != null) el.locations[DEFAULT_LANG] = String(el.location);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  Bild- und Wetterdaten-Cache
   * ------------------------------------------------------------------ */
  const imageCache = {};
  function loadImage(name, after) {
    if (!name) { if (after) after(); return; }
    const hit = imageCache[name];
    if (hit && hit.loaded) { if (after) after(); return; }
    if (!hit) imageCache[name] = { img: new Image(), loaded: false };
    const img = imageCache[name].img;
    img.onload = () => { imageCache[name].loaded = true; render(); if (after) after(); };
    img.onerror = () => { imageCache[name].loaded = true; render(); if (after) after(); };
    img.src = bgPrefix + encodeURIComponent(name);
  }
  function elementImage(el) {
    const hit = imageCache[el.file];
    return hit && hit.loaded ? hit.img : null;
  }

  let globalWeather = null;
  fetch("/api/weather")
    .then((r) => r.json())
    .then((d) => { globalWeather = d && d.weather ? d.weather : null; render(); })
    .catch(() => {});

  function formatDate(lang) {
    try {
      return new Date().toLocaleDateString(lang === "en" ? "en-US" : "de-DE", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
    } catch (e) {
      return new Date().toLocaleDateString();
    }
  }

  /* Lokalisierter Inhalt eines Elements: bevorzugt die aktuelle Sprache,
     Fallback auf die Standardsprache (Deutsch), dann auf das Legacy-Feld. */
  function localized(el, key, lang) {
    const map = el && el[key + "s"];
    if (map && typeof map === "object") {
      if (map[lang] != null && String(map[lang]) !== "") return String(map[lang]);
      if (map[DEFAULT_LANG] != null && String(map[DEFAULT_LANG]) !== "") return String(map[DEFAULT_LANG]);
      for (const v of Object.values(map)) if (v != null && String(v) !== "") return String(v);
    }
    return el && el[key] != null ? String(el[key]) : "";
  }

  /* Fehlt die Übersetzung der aktuellen Bearbeitungssprache, obwohl in
     einer anderen Sprache Inhalt hinterlegt ist? (Editor-Kennzeichnung.) */
  function missingCurrentTranslation(el) {
    const key = el.type === "text" ? "text" : el.type === "weather" ? "location" : null;
    if (!key) return false;
    const map = el[key + "s"];
    if (!map || typeof map !== "object") return false;
    const cur = map[editorLang];
    const hasAny = Object.values(map).some((v) => v != null && String(v) !== "");
    return hasAny && (cur == null || String(cur) === "");
  }

  /* Wetterbeschreibung im Editor auf Englisch/Deutsch – sprachabhängig,
     wie auf dem Display (Zustands-Schlüssel aus den Wetterdaten). */
  const WEATHER_DESC = {
    de: { sun: "Sonnig", "cloud-sun": "Leicht bewölkt", cloud: "Bewölkt", fog: "Nebel", rain: "Regen", showers: "Regenschauer", storm: "Gewitter", snow: "Schnee" },
    en: { sun: "Sunny", "cloud-sun": "Partly Cloudy", cloud: "Cloudy", fog: "Fog", rain: "Rain", showers: "Showers", storm: "Thunderstorm", snow: "Snow" },
  };
  function localizedWeatherDesc(state, lang) {
    const m = WEATHER_DESC[lang] || WEATHER_DESC[DEFAULT_LANG];
    return (m && m[state]) || "";
  }

  function applyCase(text, mode) {
    if (mode === "upper") return text.toUpperCase();
    if (mode === "lower") return text.toLowerCase();
    if (mode === "capitalize") return text.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
    return text;
  }

  /* ------------------------------------------------------------------ *
   *  Textmaße
   * ------------------------------------------------------------------ */
  function tWidth(c, str, font, spacing) {
    c.font = font;
    if (!spacing) return c.measureText(str).width;
    let w = 0;
    for (const ch of str) w += c.measureText(ch).width + spacing;
    return str.length ? w - spacing : 0;
  }
  function wrapText(c, text, font, spacing, maxWidth) {
    const paragraphs = String(text).split("\n");
    const lines = [];
    for (const para of paragraphs) {
      if (!para.trim().length) { lines.push(""); continue; }
      let cur = "";
      for (const word of para.split(/\s+/)) {
        let w = word;
        let test = cur ? cur + " " + w : w;
        while (cur && tWidth(c, test, font, spacing) > maxWidth) {
          lines.push(cur);
          cur = "";
          test = w;
        }
        while (tWidth(c, w, font, spacing) > maxWidth) {
          let cut = w.length;
          while (cut > 1 && tWidth(c, w.slice(0, cut), font, spacing) > maxWidth) cut--;
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        cur = cur ? cur + " " + w : w;
      }
      lines.push(cur);
    }
    return lines;
  }
  function fillSpaced(c, str, x, y, spacing, align, maxW) {
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    let sx = x;
    if (align === "center") sx = x + (maxW - tWidth(c, str, c.font, spacing)) / 2;
    if (align === "right") sx = x + maxW - tWidth(c, str, c.font, spacing);
    if (!spacing) { c.fillText(str, sx, y); return; }
    let cx = sx;
    for (const ch of str) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + spacing; }
  }

  /* ------------------------------------------------------------------ *
   *  Wetter-Glyphen für das Wetter-Element
   * ------------------------------------------------------------------ */
  function weatherGlyph(c, key, cx, cy, s, color) {
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = Math.max(2, s * 0.07);
    c.lineCap = "round";
    c.lineJoin = "round";
    const k = key || "cloud";

    const cloud = (sc) => {
      c.beginPath();
      c.arc(-sc * 0.35, 0, sc * 0.42, Math.PI * 0.5, Math.PI * 1.5);
      c.arc(sc * 0.15, -sc * 0.18, sc * 0.5, Math.PI * 1.35, Math.PI * 1.85);
      c.arc(sc * 0.45, 0, sc * 0.36, Math.PI * 1.6, Math.PI * 0.45);
      c.closePath();
      c.stroke();
    };

    if (k === "sun") {
      c.beginPath();
      c.arc(0, 0, s * 0.26, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        c.beginPath();
        c.moveTo(Math.cos(a) * s * 0.36, Math.sin(a) * s * 0.36);
        c.lineTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5);
        c.stroke();
      }
    } else if (k === "moon") {
      c.beginPath();
      c.arc(0, 0, s * 0.34, Math.PI * 0.5, Math.PI * 1.5);
      c.arc(-s * 0.12, -s * 0.06, s * 0.3, Math.PI * 1.35, Math.PI * 0.55, true);
      c.closePath();
      c.stroke();
    } else {
      cloud(s * 0.5);
      if (k === "showers" || k === "rain") {
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(i * s * 0.16, s * 0.18);
          c.lineTo(i * s * 0.12, s * 0.42);
          c.stroke();
        }
      } else if (k === "snow") {
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.arc(i * s * 0.16, s * 0.32, s * 0.05, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (k === "storm") {
        c.beginPath();
        c.moveTo(s * 0.02, s * 0.14);
        c.lineTo(-s * 0.14, s * 0.34);
        c.lineTo(-s * 0.01, s * 0.34);
        c.lineTo(-s * 0.1, s * 0.5);
        c.stroke();
      } else if (k === "fog") {
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(-s * 0.3, s * 0.26 + i * s * 0.1);
          c.lineTo(s * 0.3, s * 0.26 + i * s * 0.1);
          c.stroke();
        }
      }
    }
    c.restore();
  }

  /* ------------------------------------------------------------------ *
   *  Renderer
   * ------------------------------------------------------------------ */
  function drawBackgroundOn(c, proj) {
    const b = proj.background || {};
    let src = null;
    if (bgImage && bgImage.complete) src = { img: bgImage, loaded: true };
    else if (b.file && imageCache[b.file]) src = imageCache[b.file];
    if (src && src.loaded) {
      const z = clamp(num(b.zoom, 1), 0.05, 5);
      const iw = src.img.width * z;
      const ih = src.img.height * z;
      const ox = clamp(num(b.offsetX, 0), Math.min(0, W - iw), 0);
      const oy = clamp(num(b.offsetY, 0), Math.min(0, H - ih), 0);
      c.drawImage(src.img, ox, oy, iw, ih);
      return;
    }
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, b.color || "#182332");
    g.addColorStop(1, b.color2 || "#0b0e14");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    if (!b.file) {
      c.fillStyle = "rgba(255,255,255,.38)";
      c.font = "600 46px Verdana, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("Hintergrundbild hochladen", W / 2, H / 2 - 10);
      c.font = "400 30px Verdana, sans-serif";
      c.fillStyle = "rgba(255,255,255,.28)";
      c.fillText("oder ein Foto per Drag & Drop in die Leinwand ziehen", W / 2, H / 2 + 52);
    }
  }

  function drawOverlayOn(c, proj) {
    const o = proj.overlay || {};
    if (o.enabled === false) return;
    c.fillStyle = hexA(o.color || "#000000", clamp(num(o.opacity, 0.35), 0, 0.95));
    c.fillRect(0, 0, W, H);
  }

  function drawGridOn(c, proj) {
    const g = proj.grid || {};
    const step = clamp(num(g.step, 24), 8, 400);
    c.strokeStyle = "rgba(255,255,255,.10)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0.5; x <= W; x += step) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0.5; y <= H; y += step) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
  }

  function fontOf(el) {
    const parts = [];
    if (el.bold) parts.push("bold");
    if (el.italic) parts.push("italic");
    return parts.join(" ") + " " + clamp(num(el.size, 32), 4, 900) + "px " + (el.font || "Verdana");
  }

  function drawShadow(c, el, shadow, base) {
    if (shadow && shadow.enabled) {
      c.shadowColor = shadow.color || "rgba(0,0,0,.6)";
      c.shadowBlur = num(shadow.blur, 10);
      c.shadowOffsetX = num(shadow.dx, 0);
      c.shadowOffsetY = num(shadow.dy, 4);
    } else if (base) {
      c.shadowColor = base.color || "rgba(0,0,0,.6)";
      c.shadowBlur = num(base.blur, 10);
      c.shadowOffsetX = num(base.dx, 0);
      c.shadowOffsetY = num(base.dy, 4);
    }
  }

  function drawTextOn(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    const opacity = clamp(num(el.opacity, 1), 0, 1);

    if (el.bgColor && num(el.bgOpacity, 0) > 0) {
      c.save();
      c.globalAlpha = opacity * clamp(num(el.bgOpacity, 0), 0, 1);
      drawShadow(c, el, null, null);
      roundedRectPath(c, 0, 0, el.w, el.h, el.radius || 0);
      if (el.glass) c.fillStyle = "rgba(255,255,255,.12)";
      else c.fillStyle = el.bgColor || "#000000";
      c.fill();
      if (el.glass) {
        c.shadowColor = "transparent";
        c.strokeStyle = "rgba(255,255,255,.35)";
        c.lineWidth = 2;
        c.stroke();
      }
      c.restore();
    }

    const text = applyCase(String(localized(el, "text", editorLang) || "").replace(/%DATE%/g, formatDate(editorLang)), el.caseMode);
    if (!text.trim()) { c.restore(); return; }
    const font = fontOf(el);
    const pad = clamp(num(el.pad, 16), 4, 80);
    const maxW = Math.max(20, el.w - pad * 2);
    const lines = wrapText(c, text, font, num(el.letterSpacing, 0), maxW);
    const lh = clamp(num(el.lineHeight, 1.25), 0.8, 4) * clamp(num(el.size, 32), 4, 900);
    const textH = lines.length * lh;
    let startY;
    if (el.valign === "top") startY = pad;
    else if (el.valign === "bottom") startY = el.h - pad - textH;
    else startY = (el.h - textH) / 2;

    c.globalAlpha = opacity;
    drawShadow(c, el, el.shadow, el.shadow);
    c.lineJoin = "round";
    c.miterLimit = 2;
    const outline = el.outline && el.outline.enabled;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineW = tWidth(c, line, font, num(el.letterSpacing, 0));
      const x = pad;
      const y = startY + i * lh + clamp(num(el.size, 32), 4, 900) * 0.82;
      if (outline) {
        c.strokeStyle = el.outline.color || "#000000";
        c.lineWidth = clamp(num(el.outline.width, 3), 1, 20);
        c.font = font;
        c.strokeText(line, x + (el.w - pad * 2 - lineW) / 2, y);
      }
      c.fillStyle = el.color || "#FFFFFF";
      fillSpaced(c, line, x, y, num(el.letterSpacing, 0), el.align, el.w - pad * 2);
      if (el.underline) {
        const uw = el.align === "left" ? lineW : (el.align === "right" ? lineW : lineW);
        c.beginPath();
        c.moveTo(el.align === "right" ? el.w - pad - lineW : (el.align === "left" ? pad : (el.w - pad * 2 - lineW) / 2 + pad), y + clamp(num(el.size, 32), 4, 900) * 0.16);
        c.lineTo(el.align === "right" ? el.w - pad : (el.align === "left" ? pad + lineW : (el.w - pad * 2 + lineW) / 2 + pad), y + clamp(num(el.size, 32), 4, 900) * 0.16);
        c.lineWidth = Math.max(2, clamp(num(el.size, 32), 4, 900) * 0.04);
        c.stroke();
      }
      if (el.strike) {
        c.beginPath();
        c.moveTo(el.align === "right" ? el.w - pad - lineW : pad, y - clamp(num(el.size, 32), 4, 900) * 0.22);
        c.lineTo(el.align === "right" ? el.w - pad : pad + lineW, y - clamp(num(el.size, 32), 4, 900) * 0.22);
        c.lineWidth = Math.max(2, clamp(num(el.size, 32), 4, 900) * 0.035);
        c.stroke();
      }
    }
    c.restore();
  }

  function gradientOf(c, el, x, y, w, h) {
    const gr = el.gradient || {};
    const a = (num(gr.angle, 90) * Math.PI) / 180;
    const cx = x + w / 2, cy = y + h / 2;
    const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
    const g = c.createLinearGradient(
      cx - Math.cos(a) * len / 2, cy - Math.sin(a) * len / 2,
      cx + Math.cos(a) * len / 2, cy + Math.sin(a) * len / 2
    );
    g.addColorStop(0, gr.from || el.fillColor || "#ffffff");
    g.addColorStop(1, gr.to || el.fillColor || "#ffffff");
    return g;
  }

  function drawShapeOn(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    const opacity = clamp(num(el.opacity, 1), 0, 1);
    c.globalAlpha = opacity;

    if (el.shape === "line") {
      c.strokeStyle = el.strokeColor || el.fillColor || "#FFFFFF";
      c.lineWidth = clamp(num(el.strokeWidth, 6), 1, 120);
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(0, el.h / 2);
      c.lineTo(el.w, el.h / 2);
      c.stroke();
      c.restore();
      return;
    }

    drawShadow(c, el, el.shadow, el.shadow);
    const gr = el.gradient || {};
    let fill = gr.enabled ? gradientOf(c, el, 0, 0, el.w, el.h)
      : el.glass ? "rgba(255,255,255,.12)" : el.fillColor || "#FFFFFF";

    if (el.shape === "ellipse") {
      c.beginPath();
      c.ellipse(el.w / 2, el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
    } else {
      roundedRectPath(c, 0, 0, el.w, el.h, el.radius || 0);
    }
    if (num(el.fillOpacity, 1) > 0 && el.shape !== "line") {
      c.globalAlpha = opacity * clamp(num(el.fillOpacity, 1), 0, 1);
      c.fillStyle = fill;
      c.fill();
      c.globalAlpha = opacity;
      if (el.glass) {
        c.shadowColor = "transparent";
        c.strokeStyle = "rgba(255,255,255,.35)";
        c.lineWidth = 2;
        if (el.shape === "ellipse") {
          c.beginPath();
          c.ellipse(el.w / 2, el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
        } else {
          roundedRectPath(c, 0, 0, el.w, el.h, el.radius || 0);
        }
        c.stroke();
      }
    }
    if (el.strokeColor && num(el.strokeWidth, 0) > 0) {
      c.strokeStyle = el.strokeColor;
      c.lineWidth = clamp(num(el.strokeWidth, 0), 1, 80);
      if (el.shape === "ellipse") {
        c.beginPath();
        c.ellipse(el.w / 2, el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      } else {
        roundedRectPath(c, 0, 0, el.w, el.h, el.radius || 0);
      }
      c.stroke();
    }
    c.restore();
  }

  function drawImageOn(c, el) {
    const img = elementImage(el);
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    c.globalAlpha = clamp(num(el.opacity, 1), 0, 1);
    const r = clamp(num(el.radius, 0), 0, Math.min(el.w, el.h) / 2);
    if (r > 0) { roundedRectPath(c, 0, 0, el.w, el.h, r); c.clip(); }
    if (!img) {
      c.fillStyle = "rgba(255,255,255,.07)";
      c.fillRect(0, 0, el.w, el.h);
      c.fillStyle = "rgba(255,255,255,.4)";
      c.font = "16px Verdana, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("Bild", el.w / 2, el.h / 2);
      c.restore();
      return;
    }
    const iw = img.width, ih = img.height;
    if (el.crop && el.crop.w > 0) {
      const sx = iw * clamp(num(el.crop.x, 0), 0, 1);
      const sy = ih * clamp(num(el.crop.y, 0), 0, 1);
      const sw = iw * clamp(num(el.crop.w, 1), 0.01, 1);
      const sh = ih * clamp(num(el.crop.h, 1), 0.01, 1);
      const scale = Math.min(el.w / sw, el.h / sh);
      const dw = sw * scale, dh = sh * scale;
      c.drawImage(img, sx, sy, sw, sh, (el.w - dw) / 2, (el.h - dh) / 2, dw, dh);
    } else if (el.fit === "contain") {
      const scale = Math.min(el.w / iw, el.h / ih);
      const dw = iw * scale, dh = ih * scale;
      c.drawImage(img, 0, 0, iw, ih, (el.w - dw) / 2, (el.h - dh) / 2, dw, dh);
    } else {
      const scale = Math.max(el.w / iw, el.h / ih);
      const dw = iw * scale, dh = ih * scale;
      c.drawImage(img, 0, 0, iw, ih, (el.w - dw) / 2, (el.h - dh) / 2, dw, dh);
    }
    c.restore();
  }

  function drawIconOn(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    c.globalAlpha = clamp(num(el.opacity, 1), 0, 1);
    drawShadow(c, el, el.shadow, null);
    drawIcon(c, el.icon, 0, 0, el.w, el.h, el.color || "#FFFFFF", 2.1);
    c.restore();
  }

  function drawWeatherOn(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    c.globalAlpha = clamp(num(el.opacity, 1), 0, 1);

    roundedRectPath(c, 0, 0, el.w, el.h, el.radius || 0);
    if (el.glass) c.fillStyle = "rgba(255,255,255,.1)";
    else c.fillStyle = el.bgColor || "#0b1220";
    c.fill();
    if (el.glass) {
      c.strokeStyle = "rgba(255,255,255,.3)";
      c.lineWidth = 2;
      c.stroke();
    }

    const data = globalWeather;
    const today = data && data.today ? data.today : null;
    const pad = 24;
    const size = clamp(num(el.size, 42), 10, 200);
    const locText = String(localized(el, "location", editorLang) || (data && data.location) || "");

    if (el.showIcon) {
      const is = el.h - pad * 2;
      weatherGlyph(c, today ? (today.state || today.icon) : "cloud", pad + is / 2, el.h / 2, Math.min(is, 110), el.iconColor || "#8fc7ff");
    }
    const textX = el.showIcon ? pad + Math.min(el.h - pad * 2, 110) + 26 : pad;
    const textW = el.w - textX - pad;

    c.font = "bold " + Math.max(14, size * 0.62) + "px " + (el.font || "Verdana");
    c.fillStyle = el.accentColor || "#7fb2ff";
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    const fallbackHeading = editorLang === "en" ? "WEATHER" : "WETTER";
    c.fillText(locText ? locText.toUpperCase() : fallbackHeading, textX, pad + Math.max(14, size * 0.62));

    const big = clamp(size, 20, 240);
    if (el.showTemp && today) {
      c.font = "700 " + big + "px " + (el.font || "Verdana");
      c.fillStyle = el.textColor || "#FFFFFF";
      const tmp = today.temp_max || today.temp || "--";
      c.fillText((tmp === "--" ? "--" : tmp + "°"), textX, el.h / 2 + big * 0.32);
      if (today.temp_min) {
        c.font = Math.max(14, big * 0.5) + "px " + (el.font || "Verdana");
        c.fillStyle = "rgba(255,255,255,.65)";
        c.fillText(today.temp_min + "°", textX + c.measureText((tmp === "--" ? "--" : tmp + "°")).width + 16, el.h / 2 + big * 0.32);
      }
    }
    if (el.showDesc) {
      const descY = pad + Math.max(14, size * 0.62) + Math.max(16, big * 0.62);
      c.font = Math.max(13, size * 0.4) + "px " + (el.font || "Verdana");
      c.fillStyle = el.textColor || "#FFFFFF";
      const state = today && (today.state || today.icon);
      const desc = today ? (localizedWeatherDesc(state, editorLang) || today.desc || "—") : "—";
      c.fillText(desc, textX, descY + 4);
    }
    c.restore();
  }

  function drawQrOn(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    c.globalAlpha = clamp(num(el.opacity, 1), 0, 1);

    const mat = el.url && String(el.url).trim() ? QRGen.make(String(el.url).trim(), el.ecc || "M") : null;
    const r = clamp(num(el.radius, 0), 0, Math.min(el.w, el.h) / 2);
    const qz = el.quietZone !== false ? 4 : 0;

    if (el.bg !== "transparent") {
      roundedRectPath(c, 0, 0, el.w, el.h, r);
      c.fillStyle = el.bg === "white" ? "#FFFFFF" : el.bg || "#FFFFFF";
      c.fill();
    } else if (r > 0) {
      roundedRectPath(c, 0, 0, el.w, el.h, r);
      c.clip();
    }

    if (!mat) {
      c.fillStyle = "rgba(0,0,0,.55)";
      c.font = "16px Verdana, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("Link eingeben", el.w / 2, el.h / 2);
      c.restore();
      return;
    }

    const n = mat.length;
    const cells = n + qz * 2;
    const scale = Math.min(el.w / cells, el.h / cells);
    const dw = cells * scale, dh = cells * scale;
    const ox = (el.w - dw) / 2, oy = (el.h - dh) / 2;

    c.fillStyle = el.color || "#0b1220";
    if (scale >= 1) {
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (mat[row][col]) c.fillRect(ox + (col + qz) * scale, oy + (row + qz) * scale, scale, scale);
        }
      }
    } else {
      const path = new Path2D();
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (mat[row][col]) path.rect(ox + (col + qz) * scale, oy + (row + qz) * scale, scale, scale);
        }
      }
      c.fill(path);
    }
    c.restore();
  }

  function drawElementOn(c, el) {
    switch (el.type) {
      case "text": return drawTextOn(c, el);
      case "shape": return drawShapeOn(c, el);
      case "image": return drawImageOn(c, el);
      case "icon": return drawIconOn(c, el);
      case "weather": return drawWeatherOn(c, el);
      case "qrcode": return drawQrOn(c, el);
      default: return;
    }
  }

  function rotatedCorners(el) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const a = (num(el.rotation, 0) * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const pts = [];
    for (const [lx, ly] of [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]]) {
      pts.push([cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);
    }
    return pts;
  }
  function bboxOf(el) {
    const pts = rotatedCorners(el);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  function toLocal(el, p) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const dx = p.x - cx, dy = p.y - cy;
    const a = (-num(el.rotation, 0) * Math.PI) / 180;
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a) + el.w / 2,
      y: dx * Math.sin(a) + dy * Math.cos(a) + el.h / 2,
    };
  }

  const HANDLES = [
    { key: "nw", fx: 0, fy: 0 }, { key: "n", fx: 0.5, fy: 0 }, { key: "ne", fx: 1, fy: 0 },
    { key: "e", fx: 1, fy: 0.5 }, { key: "se", fx: 1, fy: 1 }, { key: "s", fx: 0.5, fy: 1 },
    { key: "sw", fx: 0, fy: 1 }, { key: "w", fx: 0, fy: 0.5 },
  ];

  function handlePositions(el) {
    const pts = rotatedCorners(el);
    const pos = {};
    HANDLES.forEach((h, i) => {
      if (i === 0 || i === 1) pos[h.key] = pts[i];
      else if (i === 2) pos[h.key] = pts[2];
      else if (i === 3) pos[h.key] = pts[2];
    });
    pos.nw = pts[0]; pos.ne = pts[1]; pos.se = pts[2]; pos.sw = pts[3];
    pos.n = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    pos.s = [(pts[2][0] + pts[3][0]) / 2, (pts[2][1] + pts[3][1]) / 2];
    pos.e = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
    pos.w = [(pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2];
    const dirX = pts[1][0] - pts[0][0], dirY = pts[1][1] - pts[0][1];
    const len = Math.hypot(dirX, dirY) || 1;
    const ox = -dirY / len, oy = dirX / len;
    pos.rotate = [pos.n[0] + ox * 46, pos.n[1] + oy * 46];
    return pos;
  }

  function drawSelectionOn(c, el) {
    if (!el) return;
    const pts = rotatedCorners(el);
    const pos = handlePositions(el);
    c.strokeStyle = "rgba(56,189,248,.95)";
    c.lineWidth = 2;
    c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.stroke();
    c.setLineDash([]);

    c.fillStyle = "#38bdf8";
    HANDLES.forEach((h) => {
      c.beginPath();
      c.arc(pos[h.key][0], pos[h.key][1], 7, 0, Math.PI * 2);
      c.fill();
    });
    c.strokeStyle = "#38bdf8";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(pos.rotate[0], pos.rotate[1]);
    c.lineTo(pos.n[0], pos.n[1]);
    c.stroke();
    c.beginPath();
    c.arc(pos.rotate[0], pos.rotate[1], 9, 0, Math.PI * 2);
    c.fillStyle = "#0b1220";
    c.fill();
    c.stroke();
  }

  function drawGuidesOn(c, guides) {
    guides.forEach((g) => {
      c.strokeStyle = "rgba(244,63,94,.95)";
      c.lineWidth = 1.5;
      c.setLineDash([8, 6]);
      c.beginPath();
      if (g.axis === "x") { c.moveTo(g.pos, 0); c.lineTo(g.pos, H); }
      else { c.moveTo(0, g.pos); c.lineTo(W, g.pos); }
      c.stroke();
      c.setLineDash([]);
    });
  }

  let selectedId = null;
  let guides = [];
  let view = { zoom: 0.45 };

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackgroundOn(ctx, project);
    drawOverlayOn(ctx, project);
    if (project.grid && project.grid.enabled) drawGridOn(ctx, project);
    for (const el of project.elements) drawElementOn(ctx, el);
    if (!exporting && selectedId) {
      const sel = selected();
      if (sel) drawSelectionOn(ctx, sel);
    }
    if (!exporting) {
      // Fehlende Übersetzung der Bearbeitungssprache deutlich markieren.
      for (const el of project.elements) {
        if (missingCurrentTranslation(el)) drawMissingTranslation(ctx, el);
      }
    }
    drawGuidesOn(ctx, guides);
    refreshInspectorValues();
  }

  function drawMissingTranslation(c, el) {
    c.save();
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    c.rotate((num(el.rotation, 0) * Math.PI) / 180);
    c.translate(-el.w / 2, -el.h / 2);
    c.strokeStyle = "#fbbf24";
    c.lineWidth = 3;
    c.setLineDash([10, 7]);
    roundedRectPath(c, -7, -7, el.w + 14, el.h + 14, Math.min(18, (el.w + 14) / 2));
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  function selected() {
    return project.elements.find((e) => e.id === selectedId) || null;
  }

  /* ------------------------------------------------------------------ *
   *  Einrasten & Hilfslinien
   * ------------------------------------------------------------------ */
  function snapRect(el, nx, ny) {
    const bb = bboxOf(Object.assign({}, el, { x: nx, y: ny }));
    const targetsX = [{ v: 0 }, { v: W / 2 }, { v: W }];
    const targetsY = [{ v: 0 }, { v: H / 2 }, { v: H }];
    for (const o of project.elements) {
      if (o.id === el.id) continue;
      const ob = bboxOf(o);
      targetsX.push({ v: ob.left }, { v: ob.cx }, { v: ob.right });
      targetsY.push({ v: ob.top }, { v: ob.cy }, { v: ob.bottom });
    }
    const edgesX = [bb.left, bb.cx, bb.right];
    const edgesY = [bb.top, bb.cy, bb.bottom];
    const px = 12;
    let gx = null, gy = null;
    for (const t of targetsX) for (const e of edgesX) {
      const d = t.v - e;
      if (Math.abs(d) <= px && (gx === null || Math.abs(d) < Math.abs(gx.d))) gx = { d, pos: t.v };
    }
    for (const t of targetsY) for (const e of edgesY) {
      const d = t.v - e;
      if (Math.abs(d) <= px && (gy === null || Math.abs(d) < Math.abs(gy.d))) gy = { d, pos: t.v };
    }
    let outX = nx, outY = ny;
    const gridSnap = project.grid && project.grid.snap !== false;
    if (gx) { outX = nx + gx.d; }
    else if (gridSnap) {
      const step = clamp(num(project.grid.step, 24), 8, 400);
      outX = Math.round(nx / step) * step;
    }
    if (gy) { outY = ny + gy.d; }
    else if (gridSnap) {
      const step = clamp(num(project.grid.step, 24), 8, 400);
      outY = Math.round(ny / step) * step;
    }
    return {
      x: outX, y: outY,
      guides: [
        gx ? { axis: "x", pos: gx.pos } : null,
        gy ? { axis: "y", pos: gy.pos } : null,
      ].filter(Boolean),
    };
  }

  /* ------------------------------------------------------------------ *
   *  Canvas-Geometrie & Treffertests
   * ------------------------------------------------------------------ */
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.zoom, y: (e.clientY - r.top) / view.zoom };
  }

  function hitHandle(p) {
    const el = selected();
    if (!el) return null;
    const pos = handlePositions(el);
    for (const h of HANDLES) {
      if (Math.hypot(p.x - pos[h.key][0], p.y - pos[h.key][1]) <= 13) return { kind: "resize", handle: h.key };
    }
    if (Math.hypot(p.x - pos.rotate[0], p.y - pos.rotate[1]) <= 16) return { kind: "rotate" };
    return null;
  }

  function hitElement(p) {
    for (let i = project.elements.length - 1; i >= 0; i--) {
      const el = project.elements[i];
      const l = toLocal(el, p);
      if (l.x >= -6 && l.x <= el.w + 6 && l.y >= -6 && l.y <= el.h + 6) return el;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   *  Interaktion
   * ------------------------------------------------------------------ */
  let drag = null;
  let clipboard = null;

  function centerOf(el) {
    return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  }

  function frameOf(el) {
    return { cx: el.x + el.w / 2, cy: el.y + el.h / 2, rot: num(el.rotation, 0) * Math.PI / 180, w: el.w, h: el.h };
  }
  function localPointer(frame, p) {
    const dx = p.x - frame.cx, dy = p.y - frame.cy;
    const a = -frame.rot;
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a) + frame.w / 2,
      y: dx * Math.sin(a) + dy * Math.cos(a) + frame.h / 2,
    };
  }
  function localToCanvas(frame, lx, ly) {
    const dxl = lx - frame.w / 2, dyl = ly - frame.h / 2;
    return {
      x: frame.cx + dxl * Math.cos(frame.rot) - dyl * Math.sin(frame.rot),
      y: frame.cy + dxl * Math.sin(frame.rot) + dyl * Math.cos(frame.rot),
    };
  }

  function startResize(el, handle, p) {
    const frame = frameOf(el);
    drag = { mode: "resize", el, handle, frame, p0: p, start: { w: el.w, h: el.h } };
    canvas.setPointerCapture(drag.pointerId = p.pointerId);
  }
  function doResize(p) {
    const { el, handle, frame, start } = drag;
    const lp = localPointer(frame, p);
    let lx = 0, ly = 0, lw = frame.w, lh = frame.h;
    const left = handle === "nw" || handle === "sw" || handle === "w";
    const right = handle === "ne" || handle === "se" || handle === "e";
    const top = handle === "nw" || handle === "ne" || handle === "n";
    const bottom = handle === "sw" || handle === "se" || handle === "s";
    if (right) lw = lp.x;
    if (bottom) lh = lp.y;
    if (left) { lx = lp.x; lw = frame.w - lp.x; }
    if (top) { ly = lp.y; lh = frame.h - lp.y; }

    const minW = el.type === "text" ? 40 : 12;
    const minH = el.type === "text" ? 24 : 12;
    if (drag.shift && (el.type === "image" || el.type === "icon")) {
      const aspect = start.w / start.h;
      const growW = left || right;
      if (growW) { lh = lw / aspect; if (top) ly = frame.h - lh; }
      else { lw = lh * aspect; if (left) lx = frame.w - lw; }
    }
    if (lw < minW) { lw = minW; if (left) lx = frame.w - minW; }
    if (lh < minH) { lh = minH; if (top) ly = frame.h - minH; }

    let g = [];
    if (Math.abs(frame.rot * 180 / Math.PI) < 0.5) {
      const tl = localToCanvas(frame, lx, ly);
      const tmp = Object.assign({}, el, { x: tl.x, y: tl.y, w: lw, h: lh });
      const s = snapRect(tmp, tl.x, tl.y);
      g = s.guides;
      lx = s.x - frame.cx + frame.w / 2;
      ly = s.y - frame.cy + frame.h / 2;
    }

    const tl = localToCanvas(frame, lx, ly);
    el.x = tl.x;
    el.y = tl.y;
    el.w = lw;
    el.h = lh;
    if (el.type === "icon") el.size = lh;
    return g;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = canvasPoint(e);
    const handleHit = hitHandle(p);
    if (handleHit) {
      const el = selected();
      if (handleHit.kind === "resize") {
        startResize(el, handleHit.handle, e);
        return;
      }
      const c = centerOf(el);
      drag = { mode: "rotate", el, p0: p, c, baseRot: num(el.rotation, 0) };
      guides = [];
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const el = hitElement(p);
    if (el) {
      selectedId = el.id;
      guides = [];
      drag = { mode: "move", el, p0: p, orig: { x: el.x, y: el.y } };
      canvas.setPointerCapture(e.pointerId);
      renderLayers();
      renderInspector();
      render();
      return;
    }
    selectedId = null;
    guides = [];
    const b = project.background || {};
    if (b.file && imageCache[b.file] && imageCache[b.file].loaded) {
      drag = { mode: "bg", p0: p, orig: { x: num(b.offsetX, 0), y: num(b.offsetY, 0) } };
      canvas.setPointerCapture(e.pointerId);
    }
    renderLayers();
    renderInspector();
    render();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = canvasPoint(e);
    if (drag.mode === "move") {
      const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      const s = snapRect(drag.el, drag.orig.x + dx, drag.orig.y + dy);
      drag.el.x = s.x;
      drag.el.y = s.y;
      guides = s.guides;
      render();
      return;
    }
    if (drag.mode === "resize") {
      drag.shift = e.shiftKey;
      guides = doResize(p);
      render();
      return;
    }
    if (drag.mode === "rotate") {
      const a0 = Math.atan2(drag.p0.y - drag.c.y, drag.p0.x - drag.c.x);
      const a1 = Math.atan2(p.y - drag.c.y, p.x - drag.c.x);
      let deg = drag.baseRot + ((a1 - a0) * 180) / Math.PI;
      deg = ((deg % 360) + 360) % 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        const snapAngles = [0, 90, 180, 270, 360];
        const near = snapAngles.find((a) => Math.abs(deg - a) <= 3 || Math.abs(deg - a - 360) <= 3);
        if (near !== undefined) deg = Math.round(near % 360);
      }
      drag.el.rotation = Math.round(deg * 10) / 10;
      render();
      return;
    }
    if (drag.mode === "bg") {
      const b = project.background || {};
      b.offsetX = drag.orig.x + (p.x - drag.p0.x);
      b.offsetY = drag.orig.y + (p.y - drag.p0.y);
      render();
    }
  });

  const endDrag = (e) => {
    if (!drag) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    drag = null;
    guides = [];
    render();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    view.zoom = clamp(view.zoom * factor, 0.05, 2);
    applyZoom();
  }, { passive: false });

  canvas.addEventListener("dblclick", (e) => {
    const el = hitElement(canvasPoint(e));
    if (el && el.type === "text") {
      selectedId = el.id;
      renderLayers();
      renderInspector();
      const ta = document.querySelector('[data-bind="texts.' + editorLang + '"]') || document.querySelector('[data-bind="text"]');
      if (ta) { ta.focus(); ta.select(); }
      render();
    }
  });

  /* Drag & Drop von Bilddateien */
  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.(jpe?g|png|gif|webp|svg)$/i.test(f.name)) {
      if (e.shiftKey) applyBackgroundFile(f);
      else addImageElementWithFile(f);
    }
  });

  /* Tastatur */
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const el = selected();
    if ((e.key === "Delete" || e.key === "Backspace") && el) {
      e.preventDefault();
      deleteElement(el);
      return;
    }
    if (e.key === "Escape") { selectedId = null; renderLayers(); renderInspector(); render(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === "c" && el) { clipboard = JSON.parse(JSON.stringify(el)); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard) {
      e.preventDefault();
      pasteElement(clipboard, 30);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "d" && el) {
      e.preventDefault();
      pasteElement(el, 24);
      return;
    }
    if (el && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") el.x -= step;
      if (e.key === "ArrowRight") el.x += step;
      if (e.key === "ArrowUp") el.y -= step;
      if (e.key === "ArrowDown") el.y += step;
      if (project.grid && project.grid.snap !== false) {
        const s = snapRect(el, el.x, el.y);
        el.x = s.x; el.y = s.y;
      }
      render();
    }
  });

  function deleteElement(el) {
    project.elements = project.elements.filter((e) => e.id !== el.id);
    if (selectedId === el.id) selectedId = null;
    renderLayers();
    renderInspector();
    render();
  }

  function pasteElement(src, off) {
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.x += off;
    copy.y += off;
    const idx = selectedId ? project.elements.findIndex((e) => e.id === selectedId) + 1 : project.elements.length;
    project.elements.splice(Math.min(idx, project.elements.length), 0, copy);
    selectedId = copy.id;
    renderLayers();
    renderInspector();
    render();
  }

  /* ------------------------------------------------------------------ *
   *  Elemente hinzufügen
   * ------------------------------------------------------------------ */
  const ADD_ITEMS = [
    { type: "heading", label: "Überschrift", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4v16 M18 4v16 M6 12h12"/></svg>' },
    { type: "subheading", label: "Unterüberschrift", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 5v14 M8 12h8 M16 5v14"/></svg>' },
    { type: "text", label: "Textbox", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16 M8 15h8"/></svg>' },
    { type: "date", label: "Datum", svg: iconSvg("calendar", 22) },
    { type: "location", label: "Standort", svg: iconSvg("pin", 22) },
    { type: "image", label: "Bild", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-4 4 3 3-2 6 4"/></svg>' },
    { type: "logo", label: "Logo", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="11" r="3.4"/><path d="M8 20l2-4h4l2 4"/></svg>' },
    { type: "icon", label: "Icon", svg: iconSvg("star", 22) },
    { type: "line", label: "Linie", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M3 12h18"/></svg>' },
    { type: "rect", label: "Rechteck", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="3"/></svg>' },
    { type: "circle", label: "Kreis", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>' },
    { type: "accent", label: "Akzentstreifen", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10h16 M4 14h10"/></svg>' },
    { type: "weather", label: "Wetter-Widget", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10.5a4 4 0 0 0-7.5-1.6A3.5 3.5 0 0 0 10 15h8a3.5 3.5 0 0 0 0-4.5zM9 6V4 M6.5 8.5L5 7 M6 13H4"/></svg>' },
    { type: "qrcode", label: "QR-Code", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3 M20 14v3 M14 20h3"/></svg>' },
  ];

  /* ------------------------------------------------------------------ *
   *  Bild-/Logo-Picker (Medienbibliothek + Hochladen)
   * ------------------------------------------------------------------ */
  function openImagePicker(fit, onPick) {
    const head = modal.querySelector(".ae-modal-head h2");
    if (head) head.textContent = fit === "contain" ? "Logo einfügen" : "Bild einfügen";
    modalBody.innerHTML = `
      <div class="ae-picker-tabs">
        <button type="button" class="active" data-pane="lib">Medienbibliothek</button>
        <button type="button" data-pane="upload">Hochladen</button>
      </div>
      <div class="ae-picker-pane" data-pane="lib">
        <div class="ae-media-grid" id="ae-media-grid"><p class="ae-hint">Lädt Medien …</p></div>
      </div>
      <div class="ae-picker-pane hidden" data-pane="upload">
        <label class="ae-upload-drop">
          <input type="file" id="ae-picker-file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg">
          <span>Datei auswählen oder hierher ziehen …</span>
        </label>
        <p class="ae-hint">PNG, JPG, WebP oder SVG. Das Bild wird hochgeladen und in das Design eingefügt.</p>
      </div>`;
    modal.classList.remove("hidden");

    modalBody.querySelectorAll(".ae-picker-tabs button").forEach((b) => {
      b.addEventListener("click", () => {
        modalBody.querySelectorAll(".ae-picker-tabs button").forEach((x) => x.classList.toggle("active", x === b));
        modalBody.querySelectorAll(".ae-picker-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== b.dataset.pane));
        if (b.dataset.pane === "lib") loadPickerLibrary(fit, onPick);
      });
    });

    const file = document.getElementById("ae-picker-file");
    if (file) file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (f) pickerUpload(f, fit, onPick);
    });

    loadPickerLibrary(fit, onPick);
  }

  function loadPickerLibrary(fit, onPick) {
    fetch("/api/media?type=image")
      .then((r) => r.json())
      .then((data) => {
        const grid = document.getElementById("ae-media-grid");
        if (!grid) return;
        const items = data.items || [];
        if (!items.length) {
          grid.innerHTML = `<p class="ae-hint">Keine Bilder in der Medienbibliothek. Lade über den Tab „Hochladen" ein Bild hoch.</p>`;
          return;
        }
        grid.innerHTML = "";
        for (const m of items) {
          const cell = document.createElement("div");
          cell.className = "ae-media-cell";
          cell.title = m.name || m.url;
          cell.innerHTML = `<img src="${esc(m.url)}" alt="" loading="lazy"><span class="ae-media-name">${esc(m.name || "")}</span>`;
          cell.addEventListener("click", () => {
            fetch("/api/announcements/from-media/" + m.id, {
              method: "POST",
              headers: { "X-CSRF-Token": csrfToken() },
            })
              .then((r) => r.json())
              .then((data) => {
                if (!data.ok || !data.file) throw new Error(data.error || "Übernahme fehlgeschlagen.");
                finishPicking(data.file, fit, onPick);
              })
              .catch((err) => { if (window.toast) window.toast(err.message, "error"); });
          });
          grid.appendChild(cell);
        }
      })
      .catch(() => {
        const grid = document.getElementById("ae-media-grid");
        if (grid) grid.innerHTML = `<p class="ae-hint">Medienbibliothek konnte nicht geladen werden.</p>`;
      });
  }

  function pickerUpload(file, fit, onPick) {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/announcements/elements", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken() },
      body: fd,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.file) throw new Error(data.error || "Upload fehlgeschlagen.");
        finishPicking(data.file, fit, onPick);
      })
      .catch((err) => { if (window.toast) window.toast(err.message, "error"); });
  }

  function finishPicking(file, fit, onPick) {
    modal.classList.add("hidden");
    if (onPick) { onPick(file); return; }
    const el = imageEl({ file: file, fit: fit || "cover", x: W / 2 - 260, y: H / 2 - 170, w: 520, h: 340, radius: 0 });
    project.elements.push(el);
    selectedId = el.id;
    renderLayers();
    renderInspector();
    loadImage(file);
  }

  function addElement(itemType) {
    let el = null;
    const cw = (w) => W / 2 - w / 2;
    const ch = (h) => H / 2 - h / 2;
    switch (itemType) {
      case "heading":
        el = textEl({ text: "Überschrift", font: "Arial Black", size: 112, color: "#FFFFFF", bold: true, align: "center", x: cw(1600), y: 330, w: 1600, h: 150, shadow: { enabled: true, color: "rgba(0,0,0,.55)", blur: 12, dx: 0, dy: 5 } });
        break;
      case "subheading":
        el = textEl({ text: "Unterüberschrift", size: 54, color: "#D7E1EF", align: "center", x: cw(1400), y: 500, w: 1400, h: 80 });
        break;
      case "text":
        el = textEl({ text: "Text", size: 40, valign: "top", lineHeight: 1.4, x: cw(680), y: 380, w: 680, h: 240, bgColor: "#0b1220", bgOpacity: 0.5, radius: 18, glass: true });
        break;
      case "date":
        el = textEl({ text: "%DATE%", size: 42, x: 120, y: 120, w: 900, h: 70, align: "left" });
        break;
      case "location":
        el = textEl({ text: "Standort", size: 42, x: 120, y: 210, w: 700, h: 70, align: "left" });
        break;
      case "image":
      case "logo":
        openImagePicker(itemType === "logo" ? "contain" : "cover");
        return;
      case "icon":
        el = iconEl({ icon: "star", color: "#7fb2ff", x: cw(64), y: ch(64), w: 64, h: 64 });
        break;
      case "line":
        el = shapeEl({ shape: "line", x: cw(520), y: 560, w: 520, h: 8, strokeColor: "#FFFFFF", strokeWidth: 8 });
        break;
      case "rect":
        el = shapeEl({ shape: "rect", x: cw(460), y: 320, w: 460, h: 240, radius: 22, glass: true, fillColor: "#0b1220", fillOpacity: 0.5 });
        break;
      case "circle":
        el = shapeEl({ shape: "ellipse", x: cw(180), y: ch(180), w: 180, h: 180, radius: 0, glass: true, fillColor: "#0b1220", fillOpacity: 0.5 });
        break;
      case "accent":
        el = shapeEl({ shape: "rect", x: cw(460), y: 480, w: 460, h: 18, radius: 9, gradient: { enabled: true, from: "#F4B942", to: "#FF8A3D", angle: 90 }, fillColor: "#F4B942" });
        break;
      case "weather":
        el = weatherEl({ x: cw(560), y: 700, w: 560, h: 150 });
        break;
      case "qrcode":
        el = qrcodeEl({ x: cw(340), y: ch(340), w: 340, h: 340, url: "https://", bg: "white", quietZone: true, color: "#0b1220" });
        break;
      default:
        return;
    }
    project.elements.push(el);
    selectedId = el.id;
    renderLayers();
    renderInspector();
    render();
  }

  function addImageElementWithFile(file, fit) {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/announcements/elements", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken() },
      body: fd,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.file) throw new Error(data.error || "Upload fehlgeschlagen.");
        const el = imageEl({ file: data.file, fit: fit || "cover", x: W / 2 - 260, y: H / 2 - 170, w: 520, h: 340, radius: 0 });
        project.elements.push(el);
        selectedId = el.id;
        renderLayers();
        renderInspector();
        loadImage(data.file);
      })
      .catch((err) => { if (window.toast) window.toast(err.message, "error"); });
  }

  /* ------------------------------------------------------------------ *
   *  Hinzufügen-Gitter
   * ------------------------------------------------------------------ */
  const addGrid = document.getElementById("ae-add-grid");
  ADD_ITEMS.forEach((item) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ae-add-btn";
    if (item.disabled) b.disabled = true;
    b.innerHTML = item.svg + `<span>${esc(item.label)}${item.badge ? `<span class="ae-badge">${esc(item.badge)}</span>` : ""}</span>`;
    b.addEventListener("click", () => addElement(item.type));
    addGrid.appendChild(b);
  });

  /* ------------------------------------------------------------------ *
   *  Ebenen
   * ------------------------------------------------------------------ */
  const TYPE_LABELS = {
    text: "Text", shape: "Form", image: "Bild", icon: "Icon", weather: "Wetter", qrcode: "QR-Code",
  };
  const TYPE_ICON = {
    text: "T", shape: "▭", image: iconSvg("camera", 14), icon: iconSvg("star", 14), weather: iconSvg("info", 14), qrcode: iconSvg("arrow", 14),
  };
  function layerLabel(el) {
    if (el.type === "text") {
      const t = localized(el, "text", editorLang);
      if (t.indexOf("%DATE%") >= 0) return "Datum";
      const trimmed = String(t || "").trim();
      if (trimmed) return trimmed.split("\n")[0].slice(0, 24);
      return "Text";
    }
    if (el.type === "shape") return el.shape === "line" ? "Linie" : el.shape === "ellipse" ? "Kreis" : "Rechteck";
    if (el.type === "image") return el.fit === "contain" ? "Logo" : "Bild";
    if (el.type === "icon") return ICON_LABELS[el.icon] || "Icon";
    if (el.type === "weather") return "Wetter-Widget";
    if (el.type === "qrcode") return "QR-Code";
    return "Element";
  }

  const layersEl = document.getElementById("ae-layers");
  function renderLayers() {
    if (!layersEl) return;
    layersEl.innerHTML = "";
    for (let i = project.elements.length - 1; i >= 0; i--) {
      const el = project.elements[i];
      const row = document.createElement("div");
      row.className = "ae-layer-item" + (el.id === selectedId ? " active" : "");
      row.innerHTML = `<span class="ae-layer-icon">${TYPE_ICON[el.type] || "•"}</span><span class="name">${esc(layerLabel(el))}</span>
        <button type="button" class="ae-layer-del" title="Löschen">✕</button>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest(".ae-layer-del")) return;
        selectedId = el.id;
        renderLayers();
        renderInspector();
        render();
      });
      row.querySelector(".ae-layer-del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteElement(el);
      });
      layersEl.appendChild(row);
    }
    syncZop();
  }

  function moveZ(el, delta) {
    const idx = project.elements.indexOf(el);
    const to = clamp(idx + delta, 0, project.elements.length - 1);
    if (to === idx) return;
    project.elements.splice(idx, 1);
    project.elements.splice(to, 0, el);
    renderLayers();
    render();
  }
  function zop(action) {
    const el = selected();
    if (!el) return;
    if (action === "front") { project.elements = project.elements.filter((e) => e.id !== el.id).concat(el); }
    else if (action === "back") { project.elements = [el].concat(project.elements.filter((e) => e.id !== el.id)); }
    else if (action === "forward") moveZ(el, 1);
    else if (action === "backward") moveZ(el, -1);
    renderLayers();
    render();
  }
  const zopBtns = document.getElementById("ae-zop");
  if (zopBtns) {
    zopBtns.querySelectorAll("button[data-zop]").forEach((b) => {
      b.addEventListener("click", () => zop(b.dataset.zop));
    });
  }
  function syncZop() {
    if (!zopBtns) return;
    const el = selected();
    const idx = el ? project.elements.indexOf(el) : -1;
    zopBtns.querySelectorAll("button[data-zop]").forEach((b) => {
      const ok = b.dataset.zop === "front" ? idx >= 0 && idx < project.elements.length - 1
        : b.dataset.zop === "forward" ? idx >= 0 && idx < project.elements.length - 1
        : b.dataset.zop === "backward" ? idx > 0
        : idx > 0;
      b.disabled = !ok;
    });
  }

  /* ------------------------------------------------------------------ *
   *  Inspector
   * ------------------------------------------------------------------ */
  const inspector = document.getElementById("ae-inspector");

  function svgIconBtn(inner, title) {
    return `<svg viewBox="0 0 24 24" width="14" height="14"><path d="${esc(inner)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function renderInspector() {
    if (!inspector) return;
    const el = selected();
    if (!el) {
      inspector.innerHTML = `<div class="ae-empty-inspector">Kein Element ausgewählt.<br>Klicke auf ein Element in der Leinwand oder füge oben links ein neues hinzu.</div>`;
      return;
    }
    let html = `<div class="ae-inspector">`;

    html += `<div class="ae-head-row">
      <span class="ae-el-name">${esc(layerLabel(el))}</span>
      <span class="ae-head-actions">
        <button type="button" data-act="duplicate" title="Duplizieren (Strg+D)">${svgIconBtn("M9 9h11v11H9z M5 15V5a2 2 0 0 1 2-2h10")}</button>
        <button type="button" data-act="delete" class="ae-danger" title="Löschen">${svgIconBtn("M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z M10 11v6 M14 11v6")}</button>
      </span>
    </div>`;

    if (el.type === "text") html += textControls(el);
    else if (el.type === "image") html += imageControls(el);
    else if (el.type === "icon") html += iconControls(el);
    else if (el.type === "shape") html += shapeControls(el);
    else if (el.type === "weather") html += weatherControls(el);
    else if (el.type === "qrcode") html += qrControls(el);

    html += `<div class="ae-insp-sub">Position &amp; Größe</div>`;
    html += `<div class="ae-num-grid">
      ${numField("x", "X")}${numField("y", "Y")}
      ${numField("w", "Breite")}${numField("h", "Höhe")}
    </div>`;
    html += rangeRow("rotation", "Drehung", -360, 360, 1, "°");
    html += rangeRow("opacity", "Deckkraft", 0, 100, 1, "%");
    html += `<div class="ae-insp-sub">Ausrichten</div>`;
    html += `<div class="ae-seg">
      <button type="button" data-align="left" title="Links">⯇</button>
      <button type="button" data-align="center" title="Horizontal mittig">⯆</button>
      <button type="button" data-align="right" title="Rechts">⯈</button>
      <button type="button" data-align="top" title="Oben">⯅</button>
      <button type="button" data-align="middle" title="Vertikal mittig">⯇</button>
      <button type="button" data-align="bottom" title="Unten">⯆</button>
    </div>`;

    html += `</div>`;
    inspector.innerHTML = html;
    wireInspector(el);
  }

  function setEditorLang(l) {
    if (!EDITOR_LANGS.includes(l) || l === editorLang) return;
    editorLang = l;
    const sw = document.getElementById("ae-editor-lang-switch");
    if (sw) sw.querySelectorAll("[data-editor-lang]").forEach((b) => b.classList.toggle("active", b.dataset.editorLang === l));
    renderLayers();
    renderInspector();
    renderWeatherInspector();
    render();
  }

  function numField(path, label) {
    return `<div class="ae-field"><label>${esc(label)}</label><input type="number" data-bind="${path}" step="1"></div>`;
  }
  function rangeRow(path, label, min, max, step, suffix) {
    return `<div class="ae-range-row">
      <label>${esc(label)}</label>
      <input type="range" data-bind="${path}" data-kind="range" data-val="${path}" min="${min}" max="${max}" step="${step}">
      <span class="ae-range-val" id="val-${path}"></span>
    </div>`;
  }
  function colorRow(path, label) {
    return `<div class="ae-color-row">
      <label>${esc(label)}</label>
      <span class="ae-color-wrap">
        <input type="color" data-bind="${path}" data-kind="color">
        <input type="text" data-bind="${path}" data-kind="colortext" size="9">
      </span>
    </div>`;
  }
  function selectRow(path, label, options) {
    return `<div class="ae-field"><label>${esc(label)}</label><select data-bind="${path}">${options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select></div>`;
  }
  function textRow(path, label, placeholder, rows) {
    return `<div class="ae-field"><label>${esc(label)}</label><textarea data-bind="${path}" rows="${rows || 2}" placeholder="${esc(placeholder || "")}"></textarea></div>`;
  }
  function inputRow(path, label, placeholder) {
    return `<div class="ae-field"><label>${esc(label)}</label><input type="text" data-bind="${path}" placeholder="${esc(placeholder || "")}"></div>`;
  }
  function checkRow(label, path) {
    return `<label class="ae-check-line"><input type="checkbox" data-bind="${path}" data-kind="check"> ${esc(label)}</label>`;
  }

  function langTabs() {
    return `<div class="ae-lang-tabs">${EDITOR_LANGS.map((l) =>
      `<button type="button" class="ae-lang-tab${l === editorLang ? " active" : ""}" data-el-lang="${l}" title="${esc(LANG_LABELS[l])}">${l === "de" ? "🇩🇪" : "🇬🇧"} ${l.toUpperCase()}</button>`
    ).join("")}</div>`;
  }

  function missingBadge() {
    return `<div class="ae-missing-badge" title="Für diese Sprache ist noch kein Inhalt hinterlegt – auf dem Bildschirm wird die deutsche Fassung gezeigt.">⚠ Übersetzung fehlt (zeigt ${esc(LANG_LABELS[DEFAULT_LANG])})</div>`;
  }

  function textControls(el) {
    let h = "";
    h += `<div class="ae-insp-sub">Sprache</div>`;
    h += langTabs();
    if (missingCurrentTranslation(el)) h += missingBadge();
    h += textRow("texts." + editorLang, "Text (" + esc(LANG_LABELS[editorLang]) + ")", "Text eingeben …", 3);
    h += selectRow("font", "Schriftart", FONTS.map((f) => [f, f]));
    h += rangeRow("size", "Schriftgröße", 8, 400, 1, "px");
    h += colorRow("color", "Schriftfarbe");
    h += `<div class="ae-toggles">
      <button type="button" data-toggle="bold" title="Fett">B</button>
      <button type="button" data-toggle="italic" title="Kursiv" style="font-style:italic">I</button>
      <button type="button" data-toggle="underline" title="Unterstrichen" style="text-decoration:underline">U</button>
      <button type="button" data-toggle="strike" title="Durchgestrichen" style="text-decoration:line-through">S</button>
    </div>`;
    h += selectRow("caseMode", "Groß-/Kleinschreibung", [["none", "Keine"], ["upper", "GROSSBUCHSTABEN"], ["lower", "kleinbuchstaben"], ["capitalize", "Jedes Wort groß"]]);
    h += rangeRow("lineHeight", "Zeilenabstand", 80, 300, 5, "%");
    h += rangeRow("letterSpacing", "Buchstabenabstand", 0, 60, 1, "px");
    h += `<div class="ae-seg">
      <button type="button" data-align="left" title="Links">⯇</button>
      <button type="button" data-align="center" title="Zentriert">⯆</button>
      <button type="button" data-align="right" title="Rechts">⯈</button>
    </div>`;
    h += `<div class="ae-seg">
      <button type="button" data-valign="top" title="Oben">Oben</button>
      <button type="button" data-valign="middle" title="Mittig">Mitte</button>
      <button type="button" data-valign="bottom" title="Unten">Unten</button>
    </div>`;
    h += `<div class="ae-insp-sub">Hintergrund</div>`;
    h += colorRow("bgColor", "Hintergrund");
    h += rangeRow("bgOpacity", "Transparenz", 0, 100, 1, "%");
    h += rangeRow("radius", "Ecken abrunden", 0, 200, 1, "px");
    h += checkRow("Glas-Effekt (Glassmorphism)", "glass");
    h += `<div class="ae-insp-sub">Effekte</div>`;
    h += checkRow("Schatten", "shadow.enabled");
    if (el.shadow && el.shadow.enabled) {
      h += colorRow("shadow.color", "Schattenfarbe");
      h += rangeRow("shadow.blur", "Weichheit", 0, 80, 1, "px");
      h += rangeRow("shadow.dx", "Versatz X", -60, 60, 1, "px");
      h += rangeRow("shadow.dy", "Versatz Y", -60, 60, 1, "px");
    }
    h += checkRow("Kontur (Outline)", "outline.enabled");
    if (el.outline && el.outline.enabled) {
      h += colorRow("outline.color", "Konturfarbe");
      h += rangeRow("outline.width", "Konturbreite", 1, 30, 1, "px");
    }
    return h;
  }

  function shapeControls(el) {
    let h = "";
    h += selectRow("shape", "Form", [["rect", "Abgerundetes Rechteck"], ["ellipse", "Kreis / Ellipse"], ["line", "Linie"]]);
    if (el.shape === "line") {
      h += colorRow("strokeColor", "Farbe");
      h += rangeRow("strokeWidth", "Stärke", 1, 120, 1, "px");
    } else {
      h += colorRow("fillColor", "Füllfarbe");
      h += rangeRow("fillOpacity", "Transparenz", 0, 100, 1, "%");
      h += rangeRow("radius", "Ecken abrunden", 0, 300, 1, "px");
      h += `<div class="ae-insp-sub">Farbverlauf</div>`;
      h += checkRow("Farbverlauf aktivieren", "gradient.enabled");
      if (el.gradient && el.gradient.enabled) {
        h += colorRow("gradient.from", "Von");
        h += colorRow("gradient.to", "Nach");
        h += rangeRow("gradient.angle", "Winkel", 0, 360, 1, "°");
      }
      h += `<div class="ae-insp-sub">Stil</div>`;
      h += checkRow("Glas-Effekt (Glassmorphism)", "glass");
      h += `<div class="ae-insp-sub">Rahmen</div>`;
      h += colorRow("strokeColor", "Rahmenfarbe");
      h += rangeRow("strokeWidth", "Rahmenbreite", 0, 80, 1, "px");
      h += `<div class="ae-insp-sub">Schatten</div>`;
      h += checkRow("Schatten", "shadow.enabled");
      if (el.shadow && el.shadow.enabled) {
        h += colorRow("shadow.color", "Schattenfarbe");
        h += rangeRow("shadow.blur", "Weichheit", 0, 80, 1, "px");
        h += rangeRow("shadow.dy", "Versatz Y", -60, 60, 1, "px");
      }
    }
    return h;
  }

  function imageControls(el) {
    let h = "";
    h += `<div class="ae-field"><label>Bild</label>
      <div class="ae-bg-actions">
        <button type="button" data-act="pick-image" class="file-btn">Bild wählen<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg"></button>
        ${el.file ? `<button type="button" data-act="remove-image">Entfernen</button>` : ""}
      </div></div>`;
    h += selectRow("fit", "Anpassung", [["cover", "Flächendeckend (Decken)"], ["contain", "Vollständig (Enthalten)"]]);
    h += rangeRow("radius", "Ecken abrunden", 0, 300, 1, "px");
    h += `<div class="ae-insp-sub">Zuschneiden</div>`;
    h += checkRow("Manuell zuschneiden", "crop.enabled");
    if (el.crop && el.crop.enabled) {
      h += `<div class="ae-num-grid">
        ${numField("crop.x", "X %")}${numField("crop.y", "Y %")}
        ${numField("crop.w", "Breite %")}${numField("crop.h", "Höhe %")}
      </div>`;
    }
    return h;
  }

  function iconControls(el) {
    let h = `<div class="ae-field"><label>Symbol</label><div class="ae-icon-grid">`;
    for (const key of Object.keys(ICONS)) {
      h += `<div class="ae-icon-cell${el.icon === key ? " active" : ""}" data-icon="${key}" title="${esc(ICON_LABELS[key])}">${iconSvg(key, 18)}</div>`;
    }
    h += `</div></div>`;
    h += colorRow("color", "Farbe");
    h += rangeRow("h", "Größe", 12, 400, 1, "px");
    return h;
  }

  function weatherControls(el) {
    let h = "";
    h += `<div class="ae-insp-sub">Sprache</div>`;
    h += langTabs();
    if (missingCurrentTranslation(el)) h += missingBadge();
    h += inputRow("locations." + editorLang, "Überschrift / Ort (" + esc(LANG_LABELS[editorLang]) + ")", "z. B. Berlin");
    h += colorRow("textColor", "Textfarbe");
    h += colorRow("accentColor", "Akzentfarbe");
    h += colorRow("iconColor", "Symbolfarbe");
    h += rangeRow("size", "Schriftgröße", 16, 200, 1, "px");
    h += rangeRow("radius", "Ecken abrunden", 0, 200, 1, "px");
    h += checkRow("Symbol anzeigen", "showIcon");
    h += checkRow("Temperatur anzeigen", "showTemp");
    h += checkRow("Beschreibung anzeigen", "showDesc");
    h += `<div class="ae-hint">Zeigt das aktuelle Wetter (Stand: Speichern) – wie beim Wetter-Widget.</div>`;
    return h;
  }

  function qrControls(el) {
    let h = "";
    h += inputRow("url", "Link", "https://…");
    h += selectRow("ecc", "Fehlerkorrektur", [["L", "L – niedrig (~7%)"], ["M", "M – mittel (~15%)"], ["Q", "Q – hoch (~25%)"], ["H", "H – sehr hoch (~30%)"]]);
    h += colorRow("color", "Modul-Farbe");
    h += selectRow("bg", "Hintergrund", [["white", "Weiß"], ["transparent", "Transparent"]]);
    h += checkRow("Quiet Zone (weißer Rand)", "quietZone");
    h += rangeRow("radius", "Ecken abrunden", 0, 200, 1, "px");
    h += `<div class="ae-hint">Vorschau und Export sind identisch – der QR-Code wird direkt auf der Leinwand erzeugt.</div>`;
    return h;
  }

  function wireInspector(el) {
    inspector.querySelectorAll("[data-bind]").forEach((inp) => {
      const path = inp.dataset.bind;
      const kind = inp.dataset.kind;
      const get = () => pathGet(el, path);
      const set = (v) => { pathSet(el, path, v); render(); };
      const isColor = kind === "color";
      const isColorText = kind === "colortext";
      const isRange = kind === "range";
      const isCheck = kind === "check";
      if (isCheck) {
        inp.checked = !!get();
        inp.addEventListener("change", () => set(inp.checked));
        return;
      }
      let value = get();
      if (isColor) {
        const hex = String(value || "#000000").replace(/^rgba?\([^)]*\)$/, (m) => {
          const parts = m.match(/[\d.]+/g).map(Number);
          if (parts.length >= 3) return "#" + [parts[0], parts[1], parts[2]].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
          return m;
        });
        inp.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000";
        inp.addEventListener("input", () => { inp.previousElementSibling && (inp.previousElementSibling.value = inp.value); set(inp.value); });
        return;
      }
      if (isColorText) {
        inp.value = String(value == null ? "" : value);
        inp.addEventListener("input", () => {
          const prev = inp.previousElementSibling;
          const v = inp.value;
          if (prev && /^#[0-9a-fA-F]{6}$/.test(v)) prev.value = v;
          set(v);
        });
        return;
      }
      if (isRange) {
        const isPct = path === "opacity" || path === "fillOpacity" || path === "bgOpacity" || path === "lineHeight";
        const raw = get();
        inp.value = isPct ? Math.round((raw == null ? 0 : raw) * 100) : raw;
        const valEl = document.getElementById("val-" + path);
        const suffix = inp.dataset.suffix || (path === "rotation" ? "°" : isPct ? "%" : "px");
        const update = () => { if (valEl) valEl.textContent = inp.value + suffix; };
        update();
        inp.addEventListener("input", () => { set(isPct ? Number(inp.value) / 100 : Number(inp.value)); update(); });
        return;
      }
      if (inp.type === "number") {
        inp.value = round1(value == null ? 0 : value);
        inp.addEventListener("input", () => set(Number(inp.value) || 0));
        return;
      }
      inp.value = value == null ? "" : value;
      inp.addEventListener("input", () => set(inp.value));
    });

    inspector.querySelectorAll("[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.act;
        if (act === "duplicate") pasteElement(el, 24);
        if (act === "delete") deleteElement(el);
        if (act === "pick-image") {
          openImagePicker(el.fit === "contain" ? "contain" : "cover", (file) => {
            el.file = file;
            loadImage(file);
            render();
            renderInspector();
          });
        }
        if (act === "remove-image") { const old = el.file; el.file = ""; if (old) delete imageCache[old]; render(); renderInspector(); }
      });
    });

    inspector.querySelectorAll("[data-toggle]").forEach((b) => {
      const key = b.dataset.toggle;
      b.classList.toggle("active", !!el[key]);
      b.addEventListener("click", () => { el[key] = !el[key]; b.classList.toggle("active", el[key]); render(); });
    });

    inspector.querySelectorAll("[data-align]").forEach((b) => {
      b.addEventListener("click", () => {
        const a = b.dataset.align;
        const bb = bboxOf(el);
        if (a === "left") el.x += -bb.left;
        if (a === "right") el.x += W - bb.right;
        if (a === "center") el.x += W / 2 - bb.cx;
        if (a === "top") el.y += -bb.top;
        if (a === "bottom") el.y += H - bb.bottom;
        if (a === "middle") el.y += H / 2 - bb.cy;
        render();
        renderInspector();
      });
    });
    inspector.querySelectorAll("[data-valign]").forEach((b) => {
      b.classList.toggle("active", el.valign === b.dataset.valign);
      b.addEventListener("click", () => { el.valign = b.dataset.valign; renderInspector(); render(); });
    });
    inspector.querySelectorAll("[data-icon]").forEach((cell) => {
      cell.addEventListener("click", () => { el.icon = cell.dataset.icon; renderInspector(); render(); });
    });

    inspector.querySelectorAll("[data-align]").forEach((b) => {
      const a = b.dataset.align;
      if (a === "left" || a === "center" || a === "right") {
        b.classList.toggle("active", el.align === (a === "left" ? "left" : a === "center" ? "center" : "right"));
      }
    });

    inspector.querySelectorAll(".ae-lang-tabs [data-el-lang]").forEach((b) => {
      b.addEventListener("click", () => {
        const l = b.dataset.elLang;
        if (l !== editorLang) setEditorLang(l);
      });
    });
  }

  function refreshInspectorValues() {
    if (!inspector || !selectedId) return;
    const el = selected();
    if (!el) return;
    inspector.querySelectorAll("[data-bind]").forEach((inp) => {
      const path = inp.dataset.bind;
      if (path === "x" || path === "y" || path === "w" || path === "h" || path === "rotation" || path === "opacity") {
        const v = pathGet(el, path);
        if (inp.type === "number") {
          inp.value = round1(v == null ? 0 : v);
        } else if (inp.type === "range") {
          const isPct = path === "opacity";
          inp.value = isPct ? Math.round((v == null ? 0 : v) * 100) : round1(v == null ? 0 : v);
          const valEl = document.getElementById("val-" + path);
          if (valEl) valEl.textContent = inp.value + (isPct ? "%" : path === "rotation" ? "°" : "");
        }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  Hintergrund-Inspector
   * ------------------------------------------------------------------ */
  const bgInspector = document.getElementById("ae-bg-inspector");
  let bgFile = null;
  let bgImage = null;

  function renderBgInspector() {
    if (!bgInspector) return;
    const b = project.background || {};
    const thumbSrc = bgImage && bgImage.complete
      ? bgImage.src
      : (b.file && imageCache[b.file] && imageCache[b.file].loaded ? `${bgPrefix}${encodeURIComponent(b.file)}` : null);
    const thumb = thumbSrc ? `background-image:url('${thumbSrc}')` : "";
    bgInspector.innerHTML = `
      <div class="ae-bg-thumb" style="${thumb}"><span>${b.file ? "" : "Kein Bild"}</span></div>
      <div class="ae-bg-actions">
        <button type="button" class="file-btn">Bild wählen<input type="file" id="ann-bg-file" accept=".jpg,.jpeg,.png,.gif,.webp"></button>
        <button type="button" id="ann-bg-reset" title="Position und Zoom zurücksetzen">Reset</button>
        <button type="button" id="ann-bg-clear" title="Hintergrundbild entfernen">Entfernen</button>
      </div>
      ${rangeRowHTML("bg-zoom", "Zoom", Math.round(clamp(num(b.zoom, 1), 0.05, 5) * 100), 5, 500, 5, "%")}
      <div class="ae-insp-sub">Overlay (Abdunkeln)</div>
      ${checkRowHTML("bg-overlay-en", "Abdunkeln aktiv", "overlay.enabled")}
      ${colorRowHTML("bg-overlay-color", "Farbe", project.overlay.color || "#000000")}
      ${rangeRowHTML("bg-overlay-opacity", "Stärke", Math.round(clamp(num(project.overlay.opacity, 0.35), 0, 0.95) * 100), 0, 90, 1, "%")}
      <div class="ae-insp-sub">Verlauf (ohne Bild)</div>
      ${colorRowHTML("bg-color", "Von", b.color || "#182332")}
      ${colorRowHTML("bg-color2", "Nach", b.color2 || "#0b0e14")}
      <div class="ae-hint">Ziehen am freien Bildschirm verschiebt das Foto; Mausrad zoomt die Ansicht.</div>`;
  }

  function rangeRowHTML(id, label, value, min, max, step, suffix) {
    return `<div class="ae-range-row">
      <label>${esc(label)}</label>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
      <span class="ae-range-val" id="${id}-val">${value}${suffix}</span>
    </div>`;
  }
  function colorRowHTML(id, label, value) {
    return `<div class="ae-color-row">
      <label>${esc(label)}</label>
      <span class="ae-color-wrap">
        <input type="color" id="${id}" value="${esc(value)}">
        <input type="text" id="${id}-text" value="${esc(value)}">
      </span>
    </div>`;
  }
  function checkRowHTML(id, label, path) {
    return `<label class="ae-check-line"><input type="checkbox" id="${id}" data-path="${path}"> ${esc(label)}</label>`;
  }

  function bindBg() {
    const b = project.background;
    const link = (id, get, set, fmt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = get();
      const val = document.getElementById(id + "-val");
      const upd = () => { if (val) val.textContent = el.value + (fmt || ""); };
      upd();
      el.addEventListener("input", () => { set(el.type === "color" ? el.value : Number(el.value)); upd(); render(); });
    };
    link("bg-zoom", () => Math.round(clamp(num(b.zoom, 1), 0.05, 5) * 100), (v) => { b.zoom = v / 100; }, "%");
    link("bg-overlay-opacity", () => Math.round(clamp(num(project.overlay.opacity, 0.35), 0, 0.95) * 100), (v) => { project.overlay.opacity = v / 100; }, "%");
    link("bg-overlay-color", () => project.overlay.color || "#000000", (v) => { project.overlay.color = v; });
    link("bg-color", () => b.color || "#182332", (v) => { b.color = v; });
    link("bg-color2", () => b.color2 || "#0b0e14", (v) => { b.color2 = v; });
    const oen = document.getElementById("bg-overlay-en");
    if (oen) { oen.checked = project.overlay.enabled !== false; oen.addEventListener("change", () => { project.overlay.enabled = oen.checked; render(); }); }

    const fileEl = document.getElementById("ann-bg-file");
    if (fileEl) fileEl.addEventListener("change", () => {
      const f = fileEl.files && fileEl.files[0];
      if (f) applyBackgroundFile(f);
    });
    const resetEl = document.getElementById("ann-bg-reset");
    if (resetEl) resetEl.addEventListener("click", () => { b.zoom = 1; b.offsetX = 0; b.offsetY = 0; renderBgInspector(); bindBg(); render(); });
    const clearEl = document.getElementById("ann-bg-clear");
    if (clearEl) clearEl.addEventListener("click", () => {
      if (b.file) { delete imageCache[b.file]; b.file = null; }
      bgImage = null;
      bgFile = null;
      renderBgInspector();
      bindBg();
      render();
    });
  }

  function applyBackgroundFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      bgFile = file;
      const b = project.background;
      b.zoom = 1; b.offsetX = 0; b.offsetY = 0;
      renderBgInspector();
      bindBg();
      render();
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
  }

  /* ------------------------------------------------------------------ *
   *  Wetterseiten-Inspector (Seite nach dem Bild)
   * ------------------------------------------------------------------ */
  const weatherInspector = document.getElementById("ae-weather-inspector");
  function headingValue(lang) {
    const h = project.weather && project.weather.heading;
    if (h && typeof h === "object") return h[lang] || "";
    return h || "";
  }
  function renderWeatherInspector() {
    if (!weatherInspector) return;
    const w = project.weather || {};
    weatherInspector.innerHTML = `
      <p class="ae-hint">Optional erscheint nach diesem Ankündigungsbild eine eigene Wetterseite – im selben Design wie die große Wetter-Ansicht (nur heute).</p>
      ${checkRowHTML("ann-weather-enabled", "Wetter nach diesem Bild anzeigen", "weather.enabled")}
      ${inputRowHTML("ann-weather-location", "Standort", w.location || "")}
      <div class="ae-insp-sub">Überschrift (Sprache)</div>
      <div class="ae-lang-tabs" id="ann-weather-heading-tabs">${EDITOR_LANGS.map((l) =>
        `<button type="button" class="ae-lang-tab${l === editorLang ? " active" : ""}" data-el-lang="${l}">${l === "de" ? "🇩🇪" : "🇬🇧"} ${l.toUpperCase()}</button>`
      ).join("")}</div>
      ${inputRowHTML("ann-weather-heading", "Eigene Überschrift (optional)", headingValue(editorLang))}`;
    const linkText = (id, path) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = pathGet(project, path) || "";
      el.addEventListener("input", () => { pathSet(project, path, el.value); });
    };
    const en = document.getElementById("ann-weather-enabled");
    if (en) { en.checked = w.enabled === true; en.addEventListener("change", () => { w.enabled = en.checked; }); }
    linkText("ann-weather-location", "weather.location");
    linkText("ann-weather-heading", "weather.heading." + editorLang);
    const tabs = document.getElementById("ann-weather-heading-tabs");
    if (tabs) tabs.querySelectorAll("[data-el-lang]").forEach((b) => {
      b.addEventListener("click", () => { const l = b.dataset.elLang; if (l !== editorLang) setEditorLang(l); });
    });
  }
  function inputRowHTML(id, label, value) {
    return `<div class="ae-field"><label>${esc(label)}</label><input type="text" id="${id}" maxlength="120" value="${esc(value)}"></div>`;
  }

  /* ------------------------------------------------------------------ *
   *  Zoom & Ansicht
   * ------------------------------------------------------------------ */
  const artboard = document.getElementById("ae-artboard");
  const zoomLabel = document.getElementById("ae-zoom-label");

  function applyZoom() {
    canvas.style.width = (W * view.zoom) + "px";
    canvas.style.height = (H * view.zoom) + "px";
    if (zoomLabel) zoomLabel.textContent = Math.round(view.zoom * 100) + " %";
  }
  document.getElementById("ae-zoom-in").addEventListener("click", () => { view.zoom = clamp(view.zoom * 1.15, 0.05, 2); applyZoom(); });
  document.getElementById("ae-zoom-out").addEventListener("click", () => { view.zoom = clamp(view.zoom / 1.15, 0.05, 2); applyZoom(); });
  document.getElementById("ae-zoom-fit").addEventListener("click", () => {
    const stage = document.getElementById("ae-stage");
    const w = stage.clientWidth - 60, h = stage.clientHeight - 60;
    view.zoom = clamp(Math.min(w / W, h / H), 0.05, 2);
    applyZoom();
  });

  const gridChk = document.getElementById("ae-grid-enabled");
  if (gridChk) {
    gridChk.checked = !!(project.grid && project.grid.enabled);
    gridChk.addEventListener("change", () => { project.grid.enabled = gridChk.checked; render(); });
  }
  const snapChk = document.getElementById("ae-snap-enabled");
  if (snapChk) {
    snapChk.checked = !project.grid || project.grid.snap !== false;
    snapChk.addEventListener("change", () => { project.grid.snap = snapChk.checked; });
  }

  /* ------------------------------------------------------------------ *
   *  Vorlagen
   * ------------------------------------------------------------------ */
  const BUILTIN_TEMPLATES = [
    {
      id: "modern", name: "Modern", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#0f172a"; p.background.color2 = "#1e293b";
        p.elements = [
          shapeEl({ shape: "rect", x: 660, y: 300, w: 600, h: 18, radius: 9, gradient: { enabled: true, from: "#F4B942", to: "#FF8A3D", angle: 90 }, fillColor: "#F4B942" }),
          textEl({ text: "Überschrift", font: "Arial Black", size: 120, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 360, w: 1600, h: 150, shadow: { enabled: true, color: "rgba(0,0,0,.55)", blur: 12, dx: 0, dy: 5 } }),
          textEl({ text: "Untertitel · weitere Informationen", size: 54, color: "#D7E1EF", align: "center", x: 260, y: 540, w: 1400, h: 80 }),
          shapeEl({ shape: "rect", x: 150, y: 850, w: 460, h: 110, radius: 26, glass: true, fillColor: "#0b1220", fillOpacity: 0.5 }),
          iconEl({ icon: "calendar", x: 190, y: 890, w: 52, h: 52, color: "#F4B942" }),
          textEl({ text: "%DATE%", size: 40, x: 270, y: 880, w: 320, h: 60, align: "left", color: "#FFFFFF" }),
        ];
        return p;
      },
    },
    {
      id: "minimal", name: "Minimalistisch", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#f8fafc"; p.background.color2 = "#e2e8f0";
        p.elements = [
          textEl({ text: "Überschrift", font: "Arial", size: 110, color: "#0f172a", bold: true, align: "left", x: 140, y: 250, w: 1600, h: 140 }),
          shapeEl({ shape: "line", x: 140, y: 420, w: 520, h: 6, strokeColor: "#F4B942", strokeWidth: 6 }),
          textEl({ text: "Untertitel", size: 50, color: "#475569", align: "left", x: 140, y: 470, w: 1400, h: 80 }),
          textEl({ text: "%DATE%", size: 34, color: "#64748b", align: "left", x: 140, y: 940, w: 900, h: 60 }),
        ];
        return p;
      },
    },
    {
      id: "schule", name: "Schule", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#1d4ed8"; p.background.color2 = "#0ea5e9";
        p.elements = [
          iconEl({ icon: "school", x: 880, y: 200, w: 120, h: 120, color: "#FDE047" }),
          textEl({ text: "Schulfest", font: "Arial Black", size: 130, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 360, w: 1600, h: 150, shadow: { enabled: true, color: "rgba(0,0,0,.35)", blur: 14, dx: 0, dy: 6 } }),
          textEl({ text: "Kommt vorbei!", size: 56, color: "#E0F2FE", align: "center", x: 260, y: 530, w: 1400, h: 80 }),
          shapeEl({ shape: "rect", x: 300, y: 900, w: 1320, h: 16, radius: 8, gradient: { enabled: true, from: "#FDE047", to: "#F97316", angle: 90 }, fillColor: "#FDE047" }),
        ];
        return p;
      },
    },
    {
      id: "veranstaltung", name: "Veranstaltung", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#6d28d9"; p.background.color2 = "#a855f7";
        p.elements = [
          textEl({ text: "Veranstaltung", font: "Arial Black", size: 120, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 300, w: 1600, h: 150, shadow: { enabled: true, color: "rgba(0,0,0,.4)", blur: 14, dx: 0, dy: 6 } }),
          shapeEl({ shape: "rect", x: 360, y: 520, w: 520, h: 100, radius: 24, glass: true, fillColor: "#0b1220", fillOpacity: 0.4 }),
          iconEl({ icon: "calendar", x: 400, y: 548, w: 48, h: 48, color: "#FDE047" }),
          textEl({ text: "%DATE%", size: 38, x: 480, y: 538, w: 380, h: 60, align: "left", color: "#FFFFFF" }),
          shapeEl({ shape: "rect", x: 900, y: 520, w: 560, h: 100, radius: 24, glass: true, fillColor: "#0b1220", fillOpacity: 0.4 }),
          iconEl({ icon: "pin", x: 940, y: 548, w: 48, h: 48, color: "#FDE047" }),
          textEl({ text: "Standort", size: 38, x: 1020, y: 538, w: 420, h: 60, align: "left", color: "#FFFFFF" }),
        ];
        return p;
      },
    },
    {
      id: "ausflug", name: "Ausflug", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#059669"; p.background.color2 = "#34d399";
        p.elements = [
          iconEl({ icon: "bus", x: 880, y: 190, w: 140, h: 140, color: "#FFFFFF" }),
          textEl({ text: "Ausflug", font: "Arial Black", size: 130, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 360, w: 1600, h: 150, shadow: { enabled: true, color: "rgba(0,0,0,.35)", blur: 14, dx: 0, dy: 6 } }),
          textEl({ text: "Treffpunkt: 08:15 Uhr am Haupteingang", size: 50, color: "#ECFDF5", align: "center", x: 260, y: 540, w: 1400, h: 80 }),
          textEl({ text: "Bitte bringt ausreichend Getränke mit.", size: 40, color: "#D1FAE5", align: "center", x: 360, y: 640, w: 1200, h: 70 }),
        ];
        return p;
      },
    },
    {
      id: "warnung", name: "Warnung", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#7f1d1d"; p.background.color2 = "#f97316";
        p.elements = [
          shapeEl({ shape: "ellipse", x: 860, y: 170, w: 200, h: 200, fillColor: "#FFFFFF", fillOpacity: 0.14, glass: false }),
          iconEl({ icon: "warning", x: 900, y: 210, w: 120, h: 120, color: "#FDE047" }),
          textEl({ text: "Achtung!", font: "Arial Black", size: 140, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 420, w: 1600, h: 160, shadow: { enabled: true, color: "rgba(0,0,0,.45)", blur: 16, dx: 0, dy: 6 } }),
          textEl({ text: "Wichtige Information für alle Teilnehmer", size: 52, color: "#FEE2E2", align: "center", x: 260, y: 620, w: 1400, h: 80 }),
        ];
        return p;
      },
    },
    {
      id: "ferien", name: "Ferien", tag: "eingebaut",
      build: () => {
        const p = tplBase();
        p.background.color = "#f59e0b"; p.background.color2 = "#ef4444";
        p.elements = [
          iconEl({ icon: "sport", x: 880, y: 200, w: 120, h: 120, color: "#FFFFFF" }),
          textEl({ text: "Ferien", font: "Arial Black", size: 140, color: "#FFFFFF", bold: true, align: "center", x: 160, y: 380, w: 1600, h: 160, shadow: { enabled: true, color: "rgba(0,0,0,.3)", blur: 14, dx: 0, dy: 6 } }),
          textEl({ text: "Wir sehen uns nach den Ferien!", size: 54, color: "#FFF7ED", align: "center", x: 260, y: 580, w: 1400, h: 80 }),
        ];
        return p;
      },
    },
  ];

  function tplBase() {
    return {
      background: { file: null, zoom: 1, offsetX: 0, offsetY: 0, color: "#0f172a", color2: "#1e293b" },
      overlay: { enabled: false, color: "#000000", opacity: 0.35 },
      grid: { enabled: true, snap: true, step: 24 },
      elements: [],
    };
  }

  function emptyProject() {
    const p = tplBase();
    p.elements = [];
    return p;
  }

  const modal = document.getElementById("ae-modal");
  const modalBody = document.getElementById("ae-modal-body");

  function openTemplates() {
    fetch("/api/announcement-templates")
      .then((r) => r.json())
      .then((data) => {
        const saved = data.templates || [];
        let html = `<div class="ae-tpl-grid">`;
        html += tplCard("blank", "Leer", "Einfache Leinwand", null, false, "linear-gradient(135deg,#182332,#0b0e14)");
        for (const t of BUILTIN_TEMPLATES) {
          html += tplCard(t.id, t.name, t.tag, t, false, builtinGradient(t.id));
        }
        for (const t of saved) {
          html += tplCard("saved-" + t.id, t.name, "Gespeichert", t, true, "linear-gradient(135deg,#1e3a8a,#7c3aed)");
        }
        html += `</div>`;
        html += `<div class="ae-modal-foot">
          <input type="text" id="ae-new-tpl-name" placeholder="Name der neuen Vorlage …">
          <button type="button" class="btn btn-primary" id="ae-save-tpl-confirm">Aktuelles Design speichern</button>
        </div>`;
        modalBody.innerHTML = html;

        modalBody.querySelectorAll(".ae-tpl-card").forEach((card) => {
          card.addEventListener("click", (e) => {
            if (e.target.closest(".ae-tpl-del")) return;
            applyTemplate(card.dataset.tpl);
          });
          const del = card.querySelector(".ae-tpl-del");
          if (del) del.addEventListener("click", (e) => {
            e.stopPropagation();
            fetch("/api/announcement-templates/" + card.dataset.tplId, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken() } })
              .then((r) => r.json())
              .then(() => openTemplates());
          });
        });
        document.getElementById("ae-save-tpl-confirm").addEventListener("click", () => {
          const name = document.getElementById("ae-new-tpl-name").value.trim();
          if (!name) { if (window.toast) window.toast("Bitte einen Namen eingeben.", "error"); return; }
          saveTemplate(name);
        });
        modal.classList.remove("hidden");
      })
      .catch(() => {});
  }

  function tplCard(id, name, sub, tpl, deletable, gradient) {
    return `<div class="ae-tpl-card" data-tpl="${esc(id)}" data-tpl-id="${tpl && tpl.id ? tpl.id : ""}">
      <div class="ae-tpl-preview" style="background:${esc(gradient)}"></div>
      <div class="ae-tpl-meta">
        <div class="ae-tpl-name">${esc(name)}</div>
        <div class="ae-tpl-sub">${esc(sub)}</div>
      </div>
      ${deletable ? '<button type="button" class="ae-tpl-del" title="Vorlage löschen">✕</button>' : ""}
    </div>`;
  }
  function builtinGradient(id) {
    const map = {
      modern: "linear-gradient(135deg,#0f172a,#1e293b)",
      minimal: "linear-gradient(135deg,#f8fafc,#e2e8f0)",
      schule: "linear-gradient(135deg,#1d4ed8,#0ea5e9)",
      veranstaltung: "linear-gradient(135deg,#6d28d9,#a855f7)",
      ausflug: "linear-gradient(135deg,#059669,#34d399)",
      warnung: "linear-gradient(135deg,#7f1d1d,#f97316)",
      ferien: "linear-gradient(135deg,#f59e0b,#ef4444)",
    };
    return map[id] || "linear-gradient(135deg,#182332,#0b0e14)";
  }

  function applyTemplate(id) {
    const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
    let fragment = null;
    if (builtin) fragment = builtin.build();
    if (fragment) {
      project.background = fragment.background;
      project.overlay = fragment.overlay;
      project.grid = fragment.grid;
      project.elements = fragment.elements;
    } else if (id === "blank") {
      const p = emptyProject();
      project.background = p.background;
      project.overlay = p.overlay;
      project.grid = p.grid;
      project.elements = p.elements;
    } else if (id.indexOf("saved-") === 0) {
      const tplId = id.slice(6);
      fetch("/api/announcement-templates/" + tplId)
        .then((r) => r.json())
        .then((data) => {
          if (data.project) {
            const fp = data.project;
            project.background = fp.background || project.background;
            project.overlay = fp.overlay || project.overlay;
            project.grid = fp.grid || project.grid;
            project.elements = (fp.elements || []).map((e) => Object.assign({}, e, { id: uid() }));
          }
          selectedId = null;
          modal.classList.add("hidden");
          renderLayers();
          renderInspector();
          render();
        });
      return;
    }
    selectedId = null;
    modal.classList.add("hidden");
    renderLayers();
    renderInspector();
    render();
  }

  function saveTemplate(name) {
    const fragment = {
      background: JSON.parse(JSON.stringify(project.background)),
      overlay: JSON.parse(JSON.stringify(project.overlay)),
      grid: JSON.parse(JSON.stringify(project.grid)),
      elements: JSON.parse(JSON.stringify(project.elements)),
    };
    fetch("/api/announcement-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify({ name, project: fragment }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
        if (window.toast) window.toast("Design als Vorlage gespeichert.", "ok");
        openTemplates();
      })
      .catch((err) => { if (window.toast) window.toast(err.message, "error"); });
  }

  document.getElementById("ae-templates-btn").addEventListener("click", openTemplates);
  document.getElementById("ae-save-template-btn").addEventListener("click", () => {
    const name = (document.getElementById("ann-name").value || "").trim() || "Mein Design";
    saveTemplate(name);
  });
  const langSwitch = document.getElementById("ae-editor-lang-switch");
  if (langSwitch) {
    langSwitch.querySelectorAll("[data-editor-lang]").forEach((b) => {
      b.addEventListener("click", () => { if (b.dataset.editorLang !== editorLang) setEditorLang(b.dataset.editorLang); });
    });
  }
  document.getElementById("ae-modal-close").addEventListener("click", () => modal.classList.add("hidden"));
  document.getElementById("ae-modal-backdrop").addEventListener("click", () => modal.classList.add("hidden"));

  /* ------------------------------------------------------------------ *
   *  Speichern
   * ------------------------------------------------------------------ */
  const saveBtn = document.getElementById("ann-save-btn");
  const saveStatus = document.getElementById("ann-save-status");
  const nameInput = document.getElementById("ann-name");
  const csrfToken = () => document.querySelector('meta[name="csrf-token"]').content;

  function allImagesLoaded() {
    for (const el of project.elements) {
      if ((el.type === "image") && el.file) {
        const hit = imageCache[el.file];
        if (!hit || !hit.loaded) return false;
      }
    }
    const b = project.background;
    if (b && b.file) {
      const hit = imageCache[b.file];
      if (!hit || !hit.loaded) return false;
    }
    return true;
  }

  function waitForImages(timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (allImagesLoaded() || Date.now() - t0 > timeout) resolve();
        else setTimeout(tick, 80);
      };
      tick();
    });
  }

  saveBtn.addEventListener("click", async () => {
    saveStatus.classList.remove("error");
    saveStatus.textContent = "Wird gespeichert …";
    saveBtn.disabled = true;
    try {
      project.name = (nameInput && nameInput.value.trim()) || project.name || "Ankündigungsbild";
      if (bgImage && bgFile) {
        // Neues Hintergrundbild wird im FormData mitgeschickt und vom
        // Server gespeichert; die Vorschau nutzt derweil das lokale Bild.
        project.background.file = null;
      }
      await waitForImages(6000);
      // Ein PNG je Sprache: `file` = Standardsprache (Deutsch), dazu
      // `file_en` für die weitere Sprache. Das Display wählt automatisch.
      project.languages = EDITOR_LANGS.slice();
      project.defaultLanguage = DEFAULT_LANG;
      const fd = new FormData();
      const savedLang = editorLang;
      try {
        for (const l of EDITOR_LANGS) {
          editorLang = l;
          exporting = true;
          selectedId = null;
          render();
          exporting = false;
          const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
          if (!blob) throw new Error("Bild konnte nicht erzeugt werden.");
          if (l === DEFAULT_LANG) fd.append("file", blob, "announcement.png");
          else fd.append("file_" + l, blob, "announcement_" + l + ".png");
        }
      } finally {
        exporting = false;
        editorLang = savedLang;
      }
      render();

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
    }
  });

  /* ------------------------------------------------------------------ *
   *  Start
   * ------------------------------------------------------------------ */
  function preloadProjectImages() {
    const b = project.background || {};
    if (b.file) loadImage(b.file);
    for (const el of project.elements) {
      if (el.type === "image" && el.file) loadImage(el.file);
    }
  }

  function init() {
    project = migrateProject(project);
    applyZoom();
    renderLayers();
    renderInspector();
    renderBgInspector();
    bindBg();
    renderWeatherInspector();
    preloadProjectImages();
    render();
    if (isNew) {
      const fit = document.getElementById("ae-zoom-fit");
      if (fit) fit.click();
      setTimeout(openTemplates, 150);
    }
  }

  init();
})();
