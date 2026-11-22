// Search/social metadata for every page: titles, canonical URL, Open Graph, breadcrumbs (JSON-LD),
// plus public/sitemap.xml. Idempotent: rewrites the block between <!-- seo --> and <!-- /seo --> each run.
// Run after adding or renaming a page:  node tools/seo/seo.mjs   (VERTEX: then npm run build:site --prefix vertex)
// Icons and the social card (public/og.png) come from tools/seo/icons.py (needs Pillow).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ORIGIN = "https://amog.fun";
const SITE = "Magnussen Institute for Applied Fun";

// path -> { title (full <title>), name (breadcrumb + og:title), desc (only where the page has none), noindex }
const PAGES = {
  "": { title: "amog.fun · Math Games, Puzzles & Trinkets", name: "amog.fun" },
  "mathcraft": { title: "Mathcraft: Prove Theorems by Crafting · amog.fun", name: "Mathcraft" },
  "vertex": { title: "VERTEX: First-Person Shotgun Platformer · amog.fun", name: "VERTEX" },
  "cgt": { title: "CGT Playground: Combinatorial Game Theory · amog.fun", name: "CGT Playground" },
  "coefficient-game": { title: "The Coefficient Choosing Game · amog.fun", name: "The Coefficient Choosing Game" },
  "fermimac": { title: "Fermimac: Estimation Game & Fermi Questions · amog.fun", name: "Fermimac" },
  "omegamac": { title: "Omegamac: Mental Math Trainer · amog.fun", name: "Omegamac" },
  "omegamac/functions": { title: "Omegamac Functions Explained · amog.fun", name: "Functions" },
  "palinode": { title: "Palinode: A Small Game of Favors · amog.fun", name: "Palinode" },
  "alchemy": { title: "Alchemy: Skyblock Crafting & Idle Game · amog.fun", name: "Alchemy" },
  "coin-flips": { title: "Coin Flip Court: Randomness Tester · amog.fun", name: "Coin Flip Court" },
  "blog": { title: "Math Blog · amog.fun", name: "Blog" },
  "blog/dirichlet": { title: "Dirichlet's Theorem · amog.fun", name: "Dirichlet's Theorem", type: "article" },
  "blog/linear-algebra": { title: "An Unintuitive Guide to Linear Algebra · amog.fun", name: "An Unintuitive Guide to Linear Algebra", type: "article" },
  "blog/mobius": { title: "Möbius Inversion & Inclusion-Exclusion · amog.fun", name: "Möbius", type: "article" },
  "dotsandboxes": { title: "Dots and Boxes vs. AI · amog.fun", name: "Dots & Boxes" },
  "nim": { title: "Play Nim vs. a Perfect AI · amog.fun", name: "Nim" },
  "nim/fibonacci": { title: "Fibonacci Nim vs. AI · amog.fun", name: "Fibonacci Nim" },
  "nim/wythoff": { title: "Wythoff's Game vs. AI · amog.fun", name: "Wythoff's Game" },
  "nim/kayles": { title: "Kayles vs. AI · amog.fun", name: "Kayles" },
  "nim/staircase": { title: "Staircase Nim vs. AI · amog.fun", name: "Staircase Nim" },
  "nim/northcott": { title: "Northcott's Game vs. AI · amog.fun", name: "Northcott's Game" },
  "nim/subtraction": { title: "Subtraction Game vs. AI · amog.fun", name: "Subtraction Game" },
  "nim/hackenbush": { title: "Blue-Red Hackenbush vs. AI · amog.fun", name: "Blue-Red Hackenbush" },
  "whack-a-moni": { title: "Whack-a-Moni · amog.fun", name: "Whack-a-Moni" },
  "amog-space-program": { title: "Amog Space Program: Rocket Incremental Game · amog.fun", name: "Amog Space Program" },
  "axis-order-incremental": { title: "AXIS ORDER — Ascendancy · amog.fun", name: "AXIS ORDER",
    desc: "AXIS ORDER — Ascendancy, an incremental game: gather faith, spread pamphlets, and ascend until Amog I is satisfied." },
  "achievements": { title: "Achievements · amog.fun", name: "Achievements" },
  "latex": { title: "LaTeX on amog.fun", name: "LaTeX" },
  "alphamac": { noindex: true },
  "404": { noindex: true, file: "public/404.html" },
};

const esc = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const url = p => `${ORIGIN}/${p ? p + "/" : ""}`;
const meta = (html, attr, key) => {
  const m = html.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, "i"));
  return m ? unesc(m[1]) : null;
};
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function block(path, cfg, html, vite, ogOld) {
  const iv = vite ? " vite-ignore" : "";
  if (cfg.noindex) return [`<meta name="robots" content="noindex">`];
  const desc = cfg.desc || meta(html, "name", "description");
  const ogDesc = ogOld || desc;
  const out = [];
  if (cfg.desc && !meta(html, "name", "description")) out.push(`<meta name="description" content="${esc(cfg.desc)}">`);
  out.push(
    `<link rel="canonical" href="${url(path)}">`,
    `<meta property="og:type" content="${cfg.type || "website"}">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:url" content="${url(path)}">`,
    `<meta property="og:title" content="${esc(path ? cfg.name : SITE)}">`,
    `<meta property="og:description" content="${esc(ogDesc)}">`,
    `<meta property="og:image" content="${ORIGIN}/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="theme-color" content="#0a0a0f">`,
  );
  // Google takes the site favicon from the home page; other pages keep their own tab icons
  if (!path) out.push(
    `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="manifest" href="/site.webmanifest">`,
  );
  else if (!/<link rel="icon"/.test(html)) out.push(`<link rel="icon" href="/favicon.svg" type="image/svg+xml"${iv}>`);
  out.push(`<link rel="apple-touch-icon" href="/apple-touch-icon.png"${iv}>`);
  if (!path) {
    out.push(ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": ORIGIN + "/#website", name: SITE, alternateName: ["amog.fun", "Magnussen Institute"], url: ORIGIN + "/" },
        { "@type": "Organization", "@id": ORIGIN + "/#org", name: SITE, url: ORIGIN + "/", logo: ORIGIN + "/icon-512.png" },
      ],
    }));
  } else {
    const parts = path.split("/"), items = [{ name: "amog.fun", item: url("") }];
    parts.forEach((_, i) => {
      const p = parts.slice(0, i + 1).join("/");
      items.push({ name: PAGES[p]?.name || p, item: url(p) });
    });
    out.push(ld({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, ...it })),
    }));
  }
  return out;
}

const sitemap = [];
for (const [path, cfg] of Object.entries(PAGES)) {
  const vite = path === "vertex";
  const file = cfg.file || (vite ? "vertex/index.html" : `public/${path ? path + "/" : ""}index.html`);
  if (!existsSync(file)) { console.error("missing", file); process.exitCode = 1; continue; }
  let html = readFileSync(file, "utf8");
  const ogOld = meta(html, "property", "og:description");
  html = html.replace(/\n[ \t]*<!-- seo -->[\s\S]*?<!-- \/seo -->/, "");
  // drop hand-written tags the block now owns
  html = html.replace(/\n[ \t]*<meta (property="og:[^"]*"|name="twitter:[^"]*"|name="theme-color"|name="robots")[^>]*>/g, "");
  html = html.replace(/\n[ \t]*<link rel="(canonical|apple-touch-icon|manifest)"[^>]*>/g, "");
  if (!path) html = html.replace(/\n[ \t]*<link rel="icon" href="data:[^\n]*/, "");
  if (cfg.title) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(cfg.title)}</title>`);
  const anchor = html.match(/\n([ \t]*)<meta name="description"[^>]*>/) || html.match(/\n([ \t]*)<title>.*<\/title>/);
  const ind = anchor[1];
  const lines = block(path, cfg, html, vite, ogOld);
  const ins = `\n${ind}<!-- seo -->\n${lines.map(l => ind + l).join("\n")}\n${ind}<!-- /seo -->`;
  html = html.slice(0, anchor.index + anchor[0].length) + ins + html.slice(anchor.index + anchor[0].length);
  writeFileSync(file, html);
  if (!cfg.noindex) {
    let lastmod = "";
    try { lastmod = execFileSync("git", ["log", "-1", "--format=%cs", "--", file]).toString().trim(); } catch {}
    sitemap.push(`  <url><loc>${url(path)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  }
}
writeFileSync("public/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join("\n")}\n</urlset>\n`);
console.log(`seo: ${Object.keys(PAGES).length} pages, ${sitemap.length} in sitemap`);
