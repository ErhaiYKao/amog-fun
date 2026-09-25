/* amog.fun LaTeX support (KaTeX).
 *
 *   <script src="/assets/math.js" defer></script>
 *
 * Then write math anywhere in the page:
 *   inline   $\mathrm{Hom}(A, B)$   or  \( ... \)
 *   display  $$\int_0^1 f$$         or  \[ ... \]
 *   commutative squares via \begin{CD} ... \end{CD}
 * Wrap text in class="no-math" to opt out. For content added later, call amogMath(element).
 * Handy macros: \Hom, \Cat, \Grp, \Set, \id, \op.
 */
(() => {
  const V = "0.18.9";
  const CDN = `https://cdn.jsdelivr.net/npm/katex@${V}/dist`;
  const macros = {
    "\\Hom": "\\operatorname{Hom}",
    "\\Cat": "\\mathbf{Cat}",
    "\\Grp": "\\mathbf{Grp}",
    "\\Set": "\\mathbf{Set}",
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
    await ready;
    window.renderMathInElement(el, options);
  };

  const style = document.createElement("style");
  style.textContent = ".katex { font-size: 1.08em; } .katex-display { margin: 1em 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }";
  document.head.appendChild(style);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.amogMath());
  else window.amogMath();
})();
