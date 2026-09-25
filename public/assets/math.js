/* amog.fun LaTeX support (KaTeX + amsthm-style environments).
 *
 *   <script src="/assets/math.js" defer></script>
 *
 * Math
 *   inline   $\Hom(A, B)$  or  \( ... \)
 *   display  $$\int_0^1 f$$  or  \[ ... \]
 *   commutative diagrams via $$\begin{CD} ... \end{CD}$$
 *   macros: \Hom \Cat \Grp \Set \Fun \id \op
 *
 * Environments (write them straight into the HTML, may span several <p>s)
 *   \begin{lemma}[Optional title]\label{lem:key} ... \end{lemma}
 *   theorem lemma proposition corollary conjecture definition example remark exercise proof
 *   starred (\begin{lemma*}) = unnumbered.  \ref{lem:key} -> link "Lemma 1".
 *   HTML form also works: <div data-env="lemma" data-title="Yoneda" id="lem:key">...</div>
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
    corollary: ["Corollary", "thm"], conjecture: ["Conjecture", "conj"], definition: ["Definition", "def"],
    example: ["Example", "note"], remark: ["Remark", "note"], exercise: ["Exercise", "note"], proof: ["Proof", "proof"],
  };
  const BEGIN = new RegExp(String.raw`\\begin\{(${Object.keys(ENVS).join("|")})(\*?)\}`);
  const SKIP = "script,style,textarea,pre,code,noscript,.no-math,.katex";
  let counter = 0;
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
      const num = numbered ? ++counter : null;
      const full = num ? `${name} ${num}` : name;
      if (el.id && kind !== "proof") labels.set(el.id, full);

      const body = document.createElement("div");
      body.className = "env-body";
      body.append(...el.childNodes);
      el.classList.add("env", `env-${kind}`);

      if (kind === "proof") {
        const lab = Object.assign(document.createElement("span"), { className: "env-label", textContent: (el.dataset.title ? `Proof of ${el.dataset.title}` : "Proof") + "." });
        const qed = Object.assign(document.createElement("span"), { className: "env-qed", textContent: "∎" });
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
        a.href = "#" + encodeURIComponent(m[1]);
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

  window.amogMath = async (el = document.body) => {
    convertLatexEnvs(el);
    decorate(el);
    resolveRefs(el);
    await ready;
    window.renderMathInElement(el, options);
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
  `;
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.amogMath());
  else window.amogMath();
})();
