/**
 * Akshara, as a bookmarklet.
 *
 * The CLI drives a headless browser at someone else's page. A web app can't:
 * same-origin forbids reading a cross-origin document, and most real sites
 * refuse to load in an iframe anyway.
 *
 * A bookmarklet sidesteps the whole problem by not being cross-origin. It runs
 * as first-party script in a page you have already loaded, so it can read the
 * DOM, the computed styles and the canvas metrics of any site you can visit —
 * including ones behind a login, which a scanner could never reach.
 *
 * Two constraints shape the code below:
 *
 *   1. It ships as a single `javascript:` URL. Injecting <script src> would be
 *      cleaner but Content-Security-Policy blocks it on exactly the sites worth
 *      auditing, so everything is inline and self-contained.
 *   2. It is a guest in someone else's document. The UI lives in a shadow root
 *      so the host page's CSS cannot reach it, and nothing outside that root is
 *      mutated except a highlight outline that is removed on close.
 */
(() => {
  const ID = "__akshara_panel__";
  const existing = document.getElementById(ID);
  if (existing) { existing.remove(); return; }

  /* ---- scripts ---------------------------------------------------------- */
  const S = [
    ["Devanagari", 0x0900, 0x097f, false, 0x0966],
    ["Bengali",    0x0980, 0x09ff, false, 0x09e6],
    ["Gurmukhi",   0x0a00, 0x0a7f, false, 0x0a66],
    ["Gujarati",   0x0a80, 0x0aff, false, 0x0ae6],
    ["Odia",       0x0b00, 0x0b7f, false, 0x0b66],
    ["Tamil",      0x0b80, 0x0bff, true,  0x0be6],
    ["Telugu",     0x0c00, 0x0c7f, false, 0x0c66],
    ["Kannada",    0x0c80, 0x0cff, false, 0x0ce6],
    ["Malayalam",  0x0d00, 0x0d7f, true,  0x0d66],
    ["Sinhala",    0x0d80, 0x0dff, true,  null],
  ];
  const VIR = new Set([0x094d,0x09cd,0x0a4d,0x0acd,0x0b4d,0x0bcd,0x0c4d,0x0ccd,0x0d4d,0x0dca]);
  const MARK = /\p{Mn}|\p{Mc}/u;
  const INDIC = /[ऀ-෿]/;
  const scriptOf = (cp) => S.find((s) => cp >= s[1] && cp <= s[2]) || null;
  const isMark = (cp) => MARK.test(String.fromCodePoint(cp));
  const isBase = (cp) => scriptOf(cp) && !isMark(cp) && !VIR.has(cp);
  const isJoin = (cp) => cp === 0x200c || cp === 0x200d;
  const digit = (cp) => S.some((s) => s[4] && cp >= s[4] && cp <= s[4] + 9);

  /* ---- akshara segmentation --------------------------------------------
     A virama binds forward into the next consonant; marks bind backward. The
     virama test must come first: every virama is General_Category=Mn, so a
     plain mark test swallows the character that forms the conjunct. */
  function seg(text) {
    const cps = [...text], off = []; let o = 0;
    for (const c of cps) { off.push(o); o += c.length; } off.push(o);
    const out = []; let i = 0;
    while (i < cps.length) {
      const cp = cps[i].codePointAt(0), st = i;
      let broken = false, open = false;
      if (!scriptOf(cp)) { i++; }
      else if (isMark(cp) || VIR.has(cp)) {
        broken = true;
        while (i < cps.length) {
          const c = cps[i].codePointAt(0);
          if (isMark(c) || VIR.has(c) || isJoin(c)) i++; else break;
        }
      } else {
        i++;
        for (;;) {
          if (i >= cps.length) break;
          const n = cps[i].codePointAt(0);
          if (VIR.has(n)) {
            i++;
            while (i < cps.length && isJoin(cps[i].codePointAt(0))) i++;
            if (i < cps.length && isBase(cps[i].codePointAt(0))) { i++; continue; }
            open = true; break;
          }
          if (isMark(n) || isJoin(n)) { i++; continue; }
          break;
        }
      }
      out.push({ t: text.slice(off[st], off[i]), s: off[st], e: off[i], broken, open });
    }
    return out;
  }

  /* ---- font probes ------------------------------------------------------ */
  const cv = document.createElement("canvas");
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const GENERIC = new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui",
    "ui-serif","ui-sans-serif","ui-monospace","ui-rounded","math","emoji","fangsong"]);

  const ink = (t, f) => { cx.font = f; const m = cx.measureText(t);
    return (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0); };

  const hash = (ch, f) => {
    const c = document.createElement("canvas"); c.width = 48; c.height = 48;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.font = f.replace(/\d+(\.\d+)?px/, "32px"); x.textBaseline = "alphabetic";
    x.fillText(ch, 6, 40);
    const d = x.getImageData(0, 0, 48, 48).data; let h = 0, first = -1;
    for (let i = 3, p = 0; i < d.length; i += 4, p++) {
      const on = d[i] > 40 ? 1 : 0;
      if (on && first < 0) first = p;
      h = (Math.imul(h, 31) + on) | 0;
    }
    return h + ":" + first;
  };
  const BLANK = hash(" ", "32px monospace");
  const tofu = (ch, f) => { const nd = hash("￿", f); return nd !== BLANK && hash(ch, f) === nd; };

  // Must differ from BOTH sentinels: Chrome's per-script fallback does not
  // resolve to the last generic in the stack, so matching either one means the
  // family contributed nothing.
  const covers = (fam, t) => {
    const bare = fam.replace(/^["']|["']$/g, "");
    if (GENERIC.has(bare.toLowerCase())) return true;
    const q = '"' + bare + '"';
    const w = (st) => { cx.font = "32px " + st; return cx.measureText(t).width; };
    return w(q + ", monospace") !== w("monospace") && w(q + ", serif") !== w("serif");
  };

  /* ---- walk ------------------------------------------------------------- */
  const groups = new Map();
  const addF = (key, f, el) => {
    const g = groups.get(key);
    if (g) { g.n++; if (g.els.length < 40) g.els.push(el); return; }
    groups.set(key, { ...f, n: 1, els: [el] });
  };

  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const scripts = new Set();
  let examined = 0;

  while (w.nextNode()) {
    const node = w.currentNode, raw = node.nodeValue || "", text = raw.trim();
    if (!text || !INDIC.test(text)) continue;
    const el = node.parentElement; if (!el) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(el.nodeName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    examined++;

    for (const ch of text) { const s = scriptOf(ch.codePointAt(0)); if (s) scripts.add(s[0]); }

    const size = parseFloat(cs.fontSize) || 16;
    const font = cs.fontStyle + " " + cs.fontWeight + " " + size + "px " + cs.fontFamily;

    // clipping
    let lh = parseFloat(cs.lineHeight);
    if (!isFinite(lh)) { cx.font = font; const m = cx.measureText("Hxg");
      lh = (m.fontBoundingBoxAscent || size * 0.8) + (m.fontBoundingBoxDescent || size * 0.2); }
    const ih = ink(text, font);
    if (ih > lh * 1.02) {
      const hid = cs.overflow === "hidden" || cs.overflowX === "hidden";
      addF("clip|" + cs.fontFamily + "|" + Math.round(size) + "|" + Math.round(lh), {
        c: "clipping", sev: hid ? "error" : "warn",
        title: "Glyphs " + (ih - lh).toFixed(1) + "px taller than the line box",
        txt: text, fix: "line-height needs to be at least " + (ih / size).toFixed(2) + " here",
      }, el);
    }

    // fallback
    const stack = cs.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const only = [...text].filter((c) => INDIC.test(c)).join("");
    let got = null;
    for (const f of stack) if (covers(f, only)) { got = f; break; }
    const want = stack[0] || "";
    if (!got) {
      addF("fb-none|" + cs.fontFamily, { c: "fallback", sev: "warn",
        title: "No font in the stack covers this script", txt: text,
        fix: "add a face for this script before the generic fallback" }, el);
    } else if (want && got !== want) {
      addF("fb|" + want + "|" + got, { c: "fallback", sev: "warn",
        title: 'Falls back to ' + got + ' — the Latin is in ' + want, txt: text,
        fix: "pick an Indic companion face with matching weight and x-height" }, el);
    }

    // tofu
    const bad = []; const seen = new Set();
    for (const ch of text) {
      if (!INDIC.test(ch) || seen.has(ch)) continue; seen.add(ch);
      if (tofu(ch, font)) bad.push(ch);
    }
    if (bad.length) {
      addF("tofu|" + cs.fontFamily + "|" + bad.join(""), { c: "tofu", sev: "error",
        title: bad.length + " character" + (bad.length > 1 ? "s" : "") + " rendering as a blank box",
        txt: bad.join(" "), fix: "widen the webfont subset, or add a Noto face" }, el);
    }

    // damaged strings
    const sg = seg(text).filter((x) => scriptOf(x.t.codePointAt(0) || 0));
    if (sg.length) {
      if (sg.some((x) => x.broken)) {
        addF("tr-b|" + text, { c: "truncation", sev: "error",
          title: "A vowel sign with nothing to attach to", txt: text,
          fix: "cut on akshara boundaries, not UTF-16 indices" }, el);
      }
      const last = sg[sg.length - 1], sc = scriptOf(last.t.codePointAt(0));
      if (last.open && sc && !sc[3]) {
        const ell = /(?:…|\.\.\.)\s*$/.test(text);
        addF("tr-v|" + text, { c: "truncation", sev: ell ? "error" : "warn",
          title: ell ? "Cut mid-letter, then given an ellipsis" : "Ends on a half-formed letter",
          txt: text, fix: "cut on akshara boundaries, not UTF-16 indices" }, el);
      }
    }
    if (text.normalize("NFC") !== text) {
      addF("nfc|" + text, { c: "normalisation", sev: "warn", title: "Not in NFC form",
        txt: text, fix: "normalise at the API and database boundaries" }, el);
    }
    let di = false, da = false;
    for (const ch of text) { const c = ch.codePointAt(0);
      if (digit(c)) di = true; else if (c > 47 && c < 58) da = true; }
    if (di && da) {
      addF("num|" + text, { c: "numerals", sev: "info",
        title: "Two numeral systems in one string", txt: text,
        fix: "settle on one numeral system per locale" }, el);
    }

    // a cluster divided across two DOM nodes — shaping cannot cross the boundary
    const par = node.parentElement;
    if (par && par.childNodes.length > 1) {
      const parts = [...par.childNodes].map((n) => n.textContent || "");
      const joined = parts.join("");
      if (INDIC.test(joined)) {
        const cuts = new Set(); let acc = 0;
        for (const p of parts.slice(0, -1)) { acc += p.length; cuts.add(acc); }
        for (const x of seg(joined)) {
          if (x.e - x.s < 2) continue;
          for (const c of cuts) if (c > x.s && c < x.e) {
            addF("split|" + joined.slice(x.s, x.e), { c: "linebreak", sev: "error",
              title: "Markup cuts through the middle of a letter",
              txt: joined.slice(x.s, x.e),
              fix: "split on akshara boundaries before wrapping either half" }, par);
          }
        }
      }
    }
  }

  /* ---- report ----------------------------------------------------------- */
  const rank = { error: 0, warn: 1, info: 2 };
  const found = [...groups.values()].sort((a, b) => rank[a.sev] - rank[b.sev]);
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of found) counts[f.sev]++;

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    '.p{width:390px;max-height:74vh;overflow:auto;background:#fdfdfc;color:#1a1a19;' +
    'font:13px/1.5 ui-serif,Georgia,serif;border:1px solid #d8d5cf;' +
    'box-shadow:0 8px 40px rgba(0,0,0,.22)}' +
    '@media (prefers-color-scheme:dark){.p{background:#16161a;color:#e8e6e0;border-color:#33312e}}' +
    '.h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;' +
    'padding:11px 13px;border-bottom:1px solid #e3e1dc;position:sticky;top:0;background:inherit}' +
    '.h b{font-weight:400;font-size:14px}' +
    '.h .m{font:10px ui-monospace,monospace;opacity:.6}' +
    '.x{cursor:pointer;font:12px ui-monospace,monospace;opacity:.6;background:none;border:0;color:inherit}' +
    '.f{padding:10px 13px;border-bottom:1px solid #e3e1dc;cursor:pointer}' +
    '.f:hover{background:rgba(127,127,127,.09)}' +
    '.f .k{font:10px ui-monospace,monospace;opacity:.6;letter-spacing:.04em}' +
    '.f .k .e{color:#9c3a2f;opacity:1}' +
    '.f .t{margin:2px 0 3px}' +
    '.f .s{font-size:14px;opacity:.85;word-break:break-word}' +
    '.f .x2{font:10px ui-monospace,monospace;opacity:.55;margin-top:3px}' +
    '.ok{padding:16px 13px;font:12px ui-monospace,monospace;opacity:.7}' +
    '</style>' +
    '<div class="p"><div class="h"><div><b>Akshara</b> ' +
    '<span class="m">' + (scripts.size ? [...scripts].join(", ") : "no Indic text") +
    ' · ' + examined + ' nodes</span></div>' +
    '<button class="x" title="close">close</button></div>' +
    (found.length
      ? found.map((f, i) =>
          '<div class="f" data-i="' + i + '">' +
          '<div class="k">' + f.c + ' · <span class="' + (f.sev === "error" ? "e" : "") + '">' +
          f.sev + '</span>' + (f.n > 1 ? " · ×" + f.n : "") + '</div>' +
          '<div class="t">' + esc(f.title) + '</div>' +
          '<div class="s">' + esc(f.txt.slice(0, 70)) + '</div>' +
          (f.fix ? '<div class="x2">' + esc(f.fix) + '</div>' : "") +
          '</div>').join("")
      : '<div class="ok">' + (scripts.size ? "nothing wrong on this page" : "no Indic text found here") + '</div>') +
    '<div class="ok">' + counts.error + " errors · " + counts.warn + " warnings · " + counts.info + " notes</div>";

  document.documentElement.appendChild(host);

  let lit = [];
  const clear = () => { lit.forEach((e) => (e.style.outline = e.__ak || "")); lit = []; };
  root.querySelectorAll(".f").forEach((row) => {
    row.addEventListener("click", () => {
      clear();
      const f = found[+row.dataset.i];
      lit = f.els.slice(0, 40);
      lit.forEach((e) => { e.__ak = e.style.outline;
        e.style.outline = "2px solid " + (f.sev === "error" ? "#c0342c" : "#a5730f"); });
      f.els[0].scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
  root.querySelector(".x").addEventListener("click", () => { clear(); host.remove(); });
})();
