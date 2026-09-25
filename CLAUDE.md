# amog.fun

Static site on Cloudflare Workers (assets only), deployed with `npx wrangler deploy` (wrangler is already OAuth'd on this machine).
Custom domains amog.fun and www.amog.fun are configured in `wrangler.jsonc`.

Conventions:
- Each project is a self-contained folder `public/<slug>/` served at `amog.fun/<slug>`. Keep projects quick & dirty and dependency-free (plain HTML/JS, CDN imports are fine).
- Register every project in `public/projects.json` (slug, title, signature, blurb, tags). The landing page renders cards from it.
- `signature` is a joke morphism, e.g. `"dotsandboxes : Bored → Amused"`.
- Shared style: `/assets/amog.css` (dark starfield, Instrument Serif / STIX Two Text / JetBrains Mono, generator colors `--g1` cyan, `--g2` red, `--g3` lime). Put a `.topbar` with the `amog.fun∘` brand linking home on every page.
- Theme: Amog Magnussen is the founder & chief mathematician (group theory, category theory, obby). Copy leans into math jokes.
