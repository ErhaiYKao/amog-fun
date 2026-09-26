/* amog.fun LaTeX support (KaTeX + amsthm-style environments).
 *
 *   <script src="/assets/math.js" defer></script>
 *
 * Math
 *   inline   $\Hom(A, B)$  or  \( ... \)
 *   display  $$\int_0^1 f$$  or  \[ ... \]
 *   commutative diagrams via $$\begin{CD} ... \end{CD}$$ (square grids only), or tikz-cd:
 *     <script type="text/tikzcd">A \arrow[r, "f"] \arrow[dr, "h"'] & B \arrow[d, dashed, "g"] \\ & C</script>
 *     arrow options: udlr direction, "label" ('  = other side, description = on the line),
 *     no head, dashed, dotted, two heads, maps to, bend left/right[=deg].  data-row-sep / data-col-sep (em).
 *   macros: \Hom \Cat \Grp \Set \Fun \id \op \N \Z \Q \R \C
 *   page preamble: <script type="text/tex-preamble">\newcommand{\im}{\operatorname{im}}</script>
 *
 * Environments (write them straight into the HTML, may span several <p>s)
 *   \begin{lemma}[Optional title]\label{lem:key} ... \end{lemma}
 *   theorem lemma proposition corollary conjecture question definition notation example remark exercise proof
 *   starred (\begin{lemma*}) = unnumbered.  \ref{lem:key} -> link "Lemma 1".
 *   HTML form also works: <div data-env="lemma" data-title="Yoneda" id="lem:key">...</div>
 *   Numbering: shared counter (Lemma 1, Theorem 2, ...). Inside <section data-section="2"> it goes
 *   per section like amsthm [section]: Lemma 2.1, Remark 2.2, ...  data-qed="□" on any ancestor
 *   changes the end-of-proof symbol (default ∎).
 *
 * Wrap anything in class="no-math" to opt out. For content added later: amogMath(element).
 */
(() => {
  const V = "0.18.9";
  const CDN = `https://cdn.jsdelivr.net/npm/katex@${V}/dist`;
  const macros = {
    "\\Hom": "\\operatorname{Hom}",
    "\\Cat": "\\mathbf{Cat}",
    "\\Grp": "\\mathbf{Grp}",
    "\\Set": "\\mathbf{Set}",
    "\\Fun": "\\mathbf{Fun}",
    "\\id": "\\mathrm{id}",
    "\\op": "^{\\mathrm{op}}",
    "\\N": "\\mathbb{N}", "\\Z": "\\mathbb{Z}", "\\Q": "\\mathbb{Q}", "\\R": "\\mathbb{R}", "\\C": "\\mathbb{C}",
  };
  const options = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false },
    ],
    ignoredClasses: ["no-math"],
    throwOnError: false,
    macros,
  };

  // ---------- environments ----------
  const ENVS = {
    theorem: ["Theorem", "thm"], lemma: ["Lemma", "thm"], proposition: ["Proposition", "thm"],
    corollary: ["Corollary", "thm"], conjecture: ["Conjecture", "conj"], question: ["Question", "conj"],
    definition: ["Definition", "def"], notation: ["Notation", "def"],
    example: ["Example", "note"], remark: ["Remark", "note"], exercise: ["Exercise", "note"], proof: ["Proof", "proof"],
  };
  const BEGIN = new RegExp(String.raw`\\begin\{(${Object.keys(ENVS).join("|")})(\*?)\}`);
  const SKIP = "script,style,textarea,pre,code,noscript,.no-math,.katex";
  let counter = 0;
  const sectionCounters = new Map();
  const labels = new Map();

  function textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  const isBlank = el => el && el.nodeType === 1 && el.tagName === "P" && !el.textContent.trim() && !el.querySelector("img,svg,canvas,iframe");

  // \begin{x}...\end{x} in the page text  ->  <div data-env="x">...</div>
  function convertLatexEnvs(root) {
    for (let guard = 0; guard < 500; guard++) {
      const nodes = textNodes(root);
      let hit = null;
      for (let i = 0; i < nodes.length && !hit; i++) {
        const m = BEGIN.exec(nodes[i].data);
        if (!m) continue;
        const endTok = `\\end{${m[1]}${m[2]}}`;
        for (let j = i; j < nodes.length; j++) {
          const k = nodes[j].data.indexOf(endTok, j === i ? m.index + m[0].length : 0);
          if (k >= 0) { hit = { bn: nodes[i], bi: m.index, blen: m[0].length, en: nodes[j], ei: k, elen: endTok.length, name: m[1], star: m[2] }; break; }
        }
      }
      if (!hit) return;

      let title = null, head = hit.blen;
      const tm = /^\s*\[([^\]]*)\]/.exec(hit.bn.data.slice(hit.bi + hit.blen));
      if (tm) { title = tm[1]; head += tm[0].length; }

      const range = document.createRange();
      range.setStart(hit.bn, hit.bi);
      range.setEnd(hit.en, hit.ei + hit.elen);
      const frag = range.extractContents();
      const tn = textNodes(frag);
      tn[0].data = tn[0].data.slice(head);
      const last = tn[tn.length - 1];
      last.data = last.data.slice(0, last.data.length - hit.elen);

      const div = document.createElement("div");
      div.dataset.env = hit.name;
      if (hit.star) div.dataset.star = "";
      if (title != null) div.dataset.title = title;
      div.append(frag);
      [...div.children].forEach(c => isBlank(c) && c.remove());
      range.insertNode(div);

      // tidy up the paragraphs the markers were cut out of
      if (isBlank(div.previousElementSibling)) div.previousElementSibling.remove();
      if (isBlank(div.nextElementSibling)) div.nextElementSibling.remove();
      const p = div.parentElement;
      if (p && p.tagName === "P" && [...p.childNodes].every(n => n === div || (n.nodeType === 3 && !n.data.trim()))) p.replaceWith(div);
    }
  }

  // <div data-env> -> numbered, boxed environment
  function decorate(root) {
    root.querySelectorAll("[data-env]:not(.env)").forEach(el => {
      const spec = ENVS[el.dataset.env];
      if (!spec) return;
      const [name, kind] = spec;

      for (const t of textNodes(el)) {
        const m = /\\label\{([^}]+)\}/.exec(t.data);
        if (m) { el.id = m[1]; t.data = t.data.replace(m[0], ""); break; }
      }
      const numbered = kind !== "proof" && !("star" in el.dataset);
      const sec = el.parentElement && el.parentElement.closest("[data-section]");
      let num = null;
      if (numbered && sec) {
        const k = sec.dataset.section, n = (sectionCounters.get(k) || 0) + 1;
        sectionCounters.set(k, n);
        num = `${k}.${n}`;
      } else if (numbered) num = ++counter;
      const full = num ? `${name} ${num}` : name;
      if (el.id && kind !== "proof") labels.set(el.id, full);

      const body = document.createElement("div");
      body.className = "env-body";
      body.append(...el.childNodes);
      el.classList.add("env", `env-${kind}`);

      if (kind === "proof") {
        const lab = Object.assign(document.createElement("span"), { className: "env-label", textContent: (el.dataset.title ? `Proof of ${el.dataset.title}` : "Proof") + "." });
        const qed = Object.assign(document.createElement("span"), { className: "env-qed", textContent: (el.closest("[data-qed]") || { dataset: {} }).dataset.qed || "∎" });
        const kids = [...body.childNodes].filter(n => !(n.nodeType === 3 && !n.data.trim()));
        const isP = n => n && n.nodeType === 1 && n.tagName === "P";
        (isP(kids[0]) ? kids[0] : body).prepend(lab, " ");
        (isP(kids[kids.length - 1]) ? kids[kids.length - 1] : body).append(qed);
        el.append(body);
      } else {
        const hd = document.createElement("div");
        hd.className = "env-head";
        hd.append(Object.assign(document.createElement("span"), { className: "env-label", textContent: full }));
        if (el.dataset.title) {
          const t = document.createElement("span");
          t.className = "env-title";
          t.textContent = el.dataset.title;
          hd.append(t);
        }
        el.append(hd, body);
      }
    });
  }

  function resolveRefs(root) {
    for (const t of textNodes(root)) {
      if (!t.data.includes("\\ref{")) continue;
      const frag = document.createDocumentFragment();
      let rest = t.data, m;
      while ((m = /\\ref\{([^}]+)\}/.exec(rest))) {
        frag.append(rest.slice(0, m.index));
        const a = document.createElement("a");
        a.className = "env-ref";
        a.href = "#" + encodeURI(m[1]);
        a.textContent = labels.get(m[1]) || `??(${m[1]})`;
        frag.append(a);
        rest = rest.slice(m.index + m[0].length);
      }
      frag.append(rest);
      t.replaceWith(frag);
    }
  }

  // ---------- KaTeX ----------
  const load = (tag, attrs) => new Promise((res, rej) => {
    const n = document.createElement(tag);
    Object.assign(n, attrs);
    n.onload = res; n.onerror = rej;
    document.head.appendChild(n);
  });
  const ready = (async () => {
    load("link", { rel: "stylesheet", href: `${CDN}/katex.min.css`, crossOrigin: "anonymous" });
    await load("script", { src: `${CDN}/katex.min.js`, crossOrigin: "anonymous" });
    await load("script", { src: `${CDN}/contrib/auto-render.min.js`, crossOrigin: "anonymous" });
  })();

  // shrink display equations that are a bit too wide for their column (down to 72%), else let them scroll
  function fitDisplays(root) {
    root.querySelectorAll(".katex-display").forEach(d => {
      d.style.fontSize = "";
      if (d.scrollWidth <= d.clientWidth + 1) return;
      const em = parseFloat(getComputedStyle(d).fontSize) / parseFloat(getComputedStyle(d.parentElement).fontSize);
      d.style.fontSize = Math.max(0.72, (em * d.clientWidth) / d.scrollWidth * 0.98).toFixed(3) + "em";
    });
  }
  let fitTimer;
  addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitDisplays(document); layoutAll(document); }, 150); });

  // ---------- page preamble: \newcommand etc. land in the shared macros ----------
  function runPreambles(root) {
    root.querySelectorAll('script[type="text/tex-preamble"]').forEach(s => {
      window.katex.renderToString(s.textContent, { macros, globalGroup: true, throwOnError: false });
      s.remove();
    });
  }

  // ---------- tikz-cd ----------
  // split at top-level (brace depth 0) occurrences of any token in `seps`
  function splitTop(src, seps) {
    const out = [[]];
    let depth = 0, cur = "", quote = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\" && src[i + 1] !== "\\") { cur += ch + (src[i + 1] || ""); i++; continue; }
      if (ch === '"' && depth === 0) quote = !quote;
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      const sep = depth === 0 && !quote && seps.find(t => src.startsWith(t, i));
      if (sep) { out[out.length - 1].push(cur); cur = ""; if (sep === "\\\\") out.push([]); i += sep.length - 1; continue; }
      cur += ch;
    }
    out[out.length - 1].push(cur);
    return out;
  }

  function parseArrowOpts(str) {
    const a = { dr: 0, dc: 0, label: null, swap: false, desc: false, head: true, dash: null, bend: 0, twoHeads: false, mapsTo: false };
    for (let opt of splitTop(str, [","])[0]) {
      opt = opt.trim();
      if (!opt) continue;
      if (/^[udlr]+$/.test(opt)) {
        for (const c of opt) { if (c === "u") a.dr--; if (c === "d") a.dr++; if (c === "l") a.dc--; if (c === "r") a.dc++; }
      } else if (opt[0] === '"') {
        const end = opt.lastIndexOf('"');
        a.label = opt.slice(1, end);
        const rest = opt.slice(end + 1);
        a.swap = /'|swap/.test(rest);
        a.desc = /description/.test(rest);
      } else if (opt === "no head" || opt === "dash" || opt === "-") a.head = false;
      else if (opt === "dashed") a.dash = "5 4";
      else if (opt === "dotted") a.dash = "1 3";
      else if (opt === "two heads") a.twoHeads = true;
      else if (opt === "maps to" || opt === "mapsto") a.mapsTo = true;
      else if (/^bend (left|right)/.test(opt)) {
        const deg = +(opt.split("=")[1] || 30);
        a.bend = (opt.includes("left") ? 1 : -1) * deg * Math.PI / 180;
      }
    }
    return a;
  }

  function parseTikzcd(src) {
    const cells = [], arrows = [];
    splitTop(src.trim(), ["\\\\", "&"]).forEach((row, r) => row.forEach((cell, c) => {
      const tex = cell.replace(/\\ar(?:row)?\s*\[((?:[^\[\]{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\]/g, (_, opts) => {
        const a = parseArrowOpts(opts);
        arrows.push({ ...a, r, c });
        return "";
      }).trim();
      cells.push({ r, c, tex });
    }));
    return { cells, arrows };
  }

  function renderTikzcd(script) {
    const { cells, arrows } = parseTikzcd(script.textContent);
    const wrap = document.createElement("div");
    wrap.className = "tikzcd-wrap";
    const grid = document.createElement("div");
    grid.className = "tikzcd";
    grid.style.rowGap = (script.dataset.rowSep || 3.2) + "em";
    grid.style.columnGap = (script.dataset.colSep || 3.6) + "em";
    const nodes = new Map();
    for (const cell of cells) {
      const d = document.createElement("div");
      d.className = "tikzcd-cell";
      d.style.gridRow = cell.r + 1;
      d.style.gridColumn = cell.c + 1;
      if (cell.tex) {
        const span = document.createElement("span");
        window.katex.render(cell.tex, span, { macros, throwOnError: false });
        d.append(span);
        nodes.set(`${cell.r},${cell.c}`, span);
      }
      grid.append(d);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("tikzcd-arrows");
    grid.append(svg);
    for (const a of arrows) {
      a.from = nodes.get(`${a.r},${a.c}`);
      a.to = nodes.get(`${a.r + a.dr},${a.c + a.dc}`);
      if (a.label != null) {
        a.labelEl = document.createElement("span");
        a.labelEl.className = "tikzcd-label" + (a.desc ? " desc" : "");
        window.katex.render(a.label, a.labelEl, { macros, throwOnError: false });
        grid.append(a.labelEl);
      }
    }
    grid._arrows = arrows;
    wrap.append(grid);
    script.replaceWith(wrap);
  }

  // where the ray from the centre of `box` in direction (dx, dy) leaves it (plus a small gap)
  function exitPoint(box, dx, dy, gap = 4) {
    const hw = box.w / 2 + gap, hh = box.h / 2 + gap;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return [box.x + dx * t, box.y + dy * t];
  }

  function layoutTikzcd(grid) {
    const wrap = grid.parentElement;
    grid.style.fontSize = "";
    if (grid.scrollWidth > wrap.clientWidth && wrap.clientWidth > 0) {
      const pad = 24; // .tikzcd horizontal padding, which does not scale with the font
      grid.style.fontSize = Math.max(0.5, (wrap.clientWidth - pad) / (grid.scrollWidth - pad) * 0.98).toFixed(3) + "em";
    }
    const g = grid.getBoundingClientRect();
    const boxOf = el => { const r = el.getBoundingClientRect(); return { x: r.left - g.left + r.width / 2, y: r.top - g.top + r.height / 2, w: r.width, h: r.height }; };
    const svg = grid.querySelector(".tikzcd-arrows");
    svg.setAttribute("viewBox", `0 0 ${g.width} ${g.height}`);
    svg.setAttribute("width", g.width);
    svg.setAttribute("height", g.height);
    let paths = "";
    const P = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
    for (const a of grid._arrows) {
      if (!a.from || !a.to) continue;
      const A = boxOf(a.from), B = boxOf(a.to);
      let dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const nx = dy, ny = -dx; // left of the direction of travel (screen coords)
      const cs = Math.cos(a.bend), sn = Math.sin(a.bend);
      const out = [dx * cs + nx * sn, dy * cs + ny * sn];   // departure direction
      const inn = [dx * cs - nx * sn, dy * cs - ny * sn];   // arrival direction
      const S = exitPoint(A, out[0], out[1]);
      const E = exitPoint(B, -inn[0], -inn[1]);
      const k = Math.hypot(E[0] - S[0], E[1] - S[1]) * 0.39;
      const C1 = [S[0] + out[0] * k, S[1] + out[1] * k], C2 = [E[0] - inn[0] * k, E[1] - inn[1] * k];
      const dash = a.dash ? ` stroke-dasharray="${a.dash}"` : "";
      paths += a.bend ? `<path d="M${P(S)} C${P(C1)} ${P(C2)} ${P(E)}"${dash}/>` : `<path d="M${P(S)} L${P(E)}"${dash}/>`;
      const head = (tip, [ux, uy]) => {
        const px = uy, py = -ux, at = (b, s) => [tip[0] - ux * b + px * s, tip[1] - uy * b + py * s];
        return `<path d="M${P(at(6.5, 4))} Q${P(at(2.5, 0.9))} ${P(tip)} Q${P(at(2.5, -0.9))} ${P(at(6.5, -4))}"/>`;
      };
      if (a.head) paths += head(E, inn);
      if (a.head && a.twoHeads) paths += head([E[0] - inn[0] * 4, E[1] - inn[1] * 4], inn);
      if (a.mapsTo) paths += `<path d="M${P([S[0] + nx * 4, S[1] + ny * 4])} L${P([S[0] - nx * 4, S[1] - ny * 4])}"/>`;

      if (a.labelEl) {
        const M = a.bend ? [(S[0] + 3 * C1[0] + 3 * C2[0] + E[0]) / 8, (S[1] + 3 * C1[1] + 3 * C2[1] + E[1]) / 8] : [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2];
        const lw = a.labelEl.offsetWidth, lh = a.labelEl.offsetHeight;
        const side = a.swap ? -1 : 1;
        const off = a.desc ? 0 : Math.abs(nx) * lw / 2 + Math.abs(ny) * lh / 2 + 3;
        a.labelEl.style.left = (M[0] + side * nx * off - lw / 2) + "px";
        a.labelEl.style.top = (M[1] + side * ny * off - lh / 2) + "px";
      }
    }
    svg.innerHTML = paths;
  }
  const layoutAll = root => root.querySelectorAll(".tikzcd").forEach(layoutTikzcd);

  window.amogMath = async (el = document.body) => {
    convertLatexEnvs(el);
    decorate(el);
    resolveRefs(el);
    await ready;
    runPreambles(el);
    window.renderMathInElement(el, options);
    el.querySelectorAll('script[type="text/tikzcd"]').forEach(renderTikzcd);
    fitDisplays(el);
    layoutAll(el);
    if (document.fonts) document.fonts.ready.then(() => { fitDisplays(el); layoutAll(el); });
  };

  const style = document.createElement("style");
  style.textContent = `
    .katex { font-size: 1.08em; }
    .katex-display { margin: 1em 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
    .env {
      --acc: var(--g1, #4fd6e8);
      position: relative; margin: 1.4em 0; padding: 18px 22px 18px;
      border: 1px solid var(--line-2, #34333f); border-left: 3px solid var(--acc); border-radius: 12px;
      background:
        linear-gradient(120deg, color-mix(in srgb, var(--acc) 9%, transparent), transparent 55%),
        var(--bg-2, #111118);
    }
    .env-def  { --acc: var(--g3, #c8f04a); }
    .env-conj { --acc: var(--g2, #ff5a5f); }
    .env-note { --acc: var(--muted, #9c99a8); background: transparent; }
    .env-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .env .env-label {
      font-family: var(--mono, monospace); font-size: 12px; font-style: normal; font-weight: 500;
      letter-spacing: .09em; text-transform: uppercase; color: var(--acc);
    }
    .env-title { font-family: var(--display, serif); font-style: italic; font-size: 1.3em; line-height: 1.1; color: var(--ink, #ece8de); }
    .env-title::before { content: "("; opacity: .5; } .env-title::after { content: ")"; opacity: .5; }
    .env-thm .env-body, .env-conj .env-body { font-style: italic; }
    .env-body > :first-child { margin-top: 0; }
    .env-body > :last-child { margin-bottom: 0; }
    .env-body p { margin: 0 0 .7em; }
    .env-proof { margin: 1em 0; padding: 2px 0 2px 20px; border: 0; border-left: 1px dashed var(--line-2, #34333f); border-radius: 0; background: none; }
    .env-proof .env-label { font-family: var(--serif, serif); font-style: italic; font-size: 1em; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--ink, #ece8de); }
    .env-qed { float: right; margin-left: 1em; color: var(--ink, #ece8de); }
    .env-body::after { content: ""; display: block; clear: both; }
    a.env-ref { color: var(--g1, #4fd6e8); text-decoration: none; border-bottom: 1px dotted currentColor; font-style: normal; }
    .env:target { box-shadow: 0 0 0 2px var(--acc); }
    .tikzcd-wrap { margin: 1.2em 0; padding: 8px 0; display: flex; justify-content: safe center; overflow-x: auto; overflow-y: hidden; }
    .tikzcd { position: relative; display: inline-grid; justify-items: center; align-items: center; padding: 6px 12px; }
    .tikzcd-cell { white-space: nowrap; }
    .tikzcd-arrows { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none;
      fill: none; stroke: currentColor; stroke-width: 1.1; stroke-linecap: round; stroke-linejoin: round; }
    .tikzcd-label { position: absolute; white-space: nowrap; font-size: .8em; line-height: 1; }
    .tikzcd-label.desc { background: var(--cd-bg, var(--bg, #0a0a0f)); padding: 1px 3px; }
    .env .tikzcd-label.desc { --cd-bg: var(--bg-2, #111118); }
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.amogMath());
  else window.amogMath();
})();
