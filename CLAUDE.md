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
- amog.fun/thesis (public/thesis/): Amog's parody paper, hand-converted from the .tex (PDF + .tex downloads alongside). The `.paper` class is a light 'sheet' scope that redefines the color tokens so env boxes restyle themselves.
