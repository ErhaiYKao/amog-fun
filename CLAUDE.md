# amog.fun

Static site on Cloudflare Workers (assets only), deployed with `npx wrangler deploy` (wrangler is already OAuth'd on this machine).
Custom domains amog.fun and www.amog.fun are configured in `wrangler.jsonc`.

Conventions:
- Each project is a self-contained folder `public/<slug>/` served at `amog.fun/<slug>`. Keep projects quick & dirty and dependency-free (plain HTML/JS, CDN imports are fine).
- Register every project in `public/projects.json` (slug, title, signature, blurb, tags). The landing page renders cards from it.
- `signature` is a joke morphism, e.g. `"dotsandboxes : Bored → Amused"`.
- Shared style: `/assets/amog.css` (dark starfield, Instrument Serif / STIX Two Text / JetBrains Mono, generator colors `--g1` cyan, `--g2` red, `--g3` lime). Put a `.topbar` with the `amog.fun∘` brand linking home on every page.
- Theme: Amog Magnussen is the founder & chief mathematician (group theory, category theory, obby). Copy leans into math jokes.
- LaTeX: include `<script src="/assets/math.js" defer></script>`; then `$inline$`, `$$display$$`, `\(..\)`, `\[..\]` render via KaTeX. Macros: \Hom \Cat \Grp \Set \id \op. Call `amogMath(el)` for dynamically inserted content; class `no-math` opts out. Blurbs in projects.json may use LaTeX.
- Theorem environments (same math.js): `\begin{lemma}[Title]\label{lem:x} ... \end{lemma}`, also theorem/proposition/corollary/conjecture/definition/example/remark/exercise/proof, starred = unnumbered, `\ref{lem:x}` links. Can span several <p>s. Reference + demo page: amog.fun/latex (public/latex/). Not listed in projects.json.
- Paper-style numbering: wrap sections in `<section data-section="2">` to get Lemma 2.1, Remark 2.2, ... (shared counter per section). Also `question` env, and `data-qed="□"` on an ancestor to change the proof symbol. Display equations auto-shrink (≥72%) to fit narrow screens.
- drafts/thesis/: Amog's parody paper (paper layout using the LaTeX envs + `.paper` light-sheet scope). Deliberately NOT deployed (privacy: it identifies Amog). Never move it into public/ or link to it.
- amog.fun/alchemy (public/alchemy/): SkyFactory-style skyblock crafting/idle game. **All items, recipes, drop tables, smelting, quests and balance live in `data.js`** (Amog's recipes go there; the format is documented at the top of the file). engine.js is pure logic (no DOM, runs in Node); ui.js/panels.js/island.js render; icons.js draws pixel icons procedurally from each item's `icon: [shape, color, extra]`. After changing data.js, sanity-check that the chain is still completable (a Node bot that plays engine.js end to end is the easiest way). Saves are in localStorage key `amog.alchemy.v1`.
- Git: this repo is public at github.com/ErhaiYKao/amog-fun. Commit and push only as ErhaiYKao (local git config + credential helper are already set). Never commit as the owner's personal account, and never add personal info, local paths, credentials or .env files.
- amog.fun/amog-space-program (public/amog-space-program/): the Amog Space Program rocket incremental, ported from ErhaiYKao/erhaiykao.github.io. Tests + balance sim live in tools/amog-space-program/ (run: node --test tools/amog-space-program/asp.test.mjs). Feedback button opens issues on ErhaiYKao/amog-fun.
- amog.fun/axis-order-incremental: the last version (Jul 2026, "AXIS ORDER — Ascendancy") of Axis Order, recovered from an overwritten commit in ErhaiYKao/erhaiykao.github.io-archive. Single self-contained file; saves are manual export strings.
- amog.fun/nim (public/nim/): Nim family. kit.js = shared engine (turns, perfect AI via isP, hints, scores); each variant (index.html = classic, fibonacci/, wythoff/, kayles/, staircase/, northcott/) supplies create/moves/apply/isP/render/math. Add a variant: new folder + entry in VARIANTS in kit.js.
