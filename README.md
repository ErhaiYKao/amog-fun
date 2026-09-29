# amog.fun

Amog Magnussen's playground. One Cloudflare Worker (static assets only) serves the whole domain.
Every folder in `public/` is a route:

```
public/index.html              -> https://amog.fun/
public/dotsandboxes/index.html -> https://amog.fun/dotsandboxes
public/<anything>/index.html   -> https://amog.fun/<anything>
```

## Add a new project

1. `mkdir public/<slug>` and drop an `index.html` (plus any JS/CSS/assets) in it.
   Optionally `<link rel="stylesheet" href="/assets/amog.css">` for the house style (fonts, colors, `.topbar`, `.btn`).
   For LaTeX, add `<script src="/assets/math.js" defer></script>` and write `$...$` / `$$...$$`
   (KaTeX, incl. `\begin{CD}` diagrams and macros `\Hom \Cat \Grp \Set \id \op`). Call `amogMath(el)` after injecting new content.
   Theorem boxes: `\begin{lemma}[Title]\label{lem:x} ... \end{lemma}` (+ theorem, definition, proof, ...), `\ref{lem:x}`. See https://amog.fun/latex
2. Add an entry to `public/projects.json` so it shows up on the landing page.
3. `npx wrangler deploy`

## Develop

```
npx wrangler dev      # http://localhost:8787
npx wrangler deploy   # ship to amog.fun
```

Anything that needs a backend (APIs, D1, KV, etc.) can be added later by giving the Worker a `main` script.
Static files keep working exactly the same.

## Alchemy checks

`node tools/alchemy/bot.mjs` plays from a fresh island through the Terminal Object and the optional advancements.
`node --test tools/alchemy/energy.test.mjs` checks electricity, powered processing, refunds, save migration and offline progress.

Alchemy balance lives in `public/alchemy/data.js`: `POWER` defines generator watts and storage joules,
`ELECTRIC` defines powered station recipes, and `CONFIG.harvester` defines automatic forestry.
