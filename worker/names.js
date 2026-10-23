/* Leaderboard name checks (worker/leaderboard.js), in three layers:
 *   1. nameProblem: a short wordlist, after undoing leetspeak, accents and stretched letters. Pure, runs in Node.
 *   2. checkName: each new name is asked about once (Workers AI, binding AI) and the verdict is kept in D1 lb_names.
 *      If the model is down or answers nonsense, the name is let through and not cached, so it's asked again next time.
 *   3. worker/admin.js: block or allow a name by hand (an admin verdict beats both of the above).
 * The lists are rot13 so the source doesn't read like a list of slurs. */
const rot13 = s => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97));
// anywhere in the name, letters only ("xX_slur_Xx")
const PARTS = "avttre avttn avtyrg snttbg xvxr puvax genaal ergneq encvfg uvgyre shpx fuvg cravf chffl cbea juber fyhg ovgpu nffubyr qvyqb jnaxre wvmm zbyrfg anmvf"
  .split(" ").map(rot13);
// whole words only, since they hide inside harmless ones (Scunthorpe, analysis, Dickens, torpedo)
const WORDS = new Set("phag pbpx qvpx snt sntf anmv xxx fcvp phz frk nany gvgf gjng pbba tbbx encr crqb"
  .split(" ").map(rot13));
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", 9: "g", "@": "a", $: "s", "!": "i", "|": "i" };

// the ways a name could be read: as written, and with 1 read as l
function readings(name) {
  const base = String(name).replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return [base, base.replace(/1/g, "l")].map(s => s.replace(/[0-9@$!|]/g, c => LEET[c] || c).replace(/(\p{L})\1{2,}/gu, "$1"));
}

// null if the name looks fine, else why not
export function nameProblem(name) {
  for (const s of readings(name)) {
    const squashed = s.replace(/[^\p{L}]/gu, "");
    if (PARTS.some(w => squashed.includes(w))) return "wordlist";
    if (s.split(/[^\p{L}]+/u).some(w => WORDS.has(w)) || WORDS.has(squashed)) return "wordlist";
  }
  return null;
}

export const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
// lenient on purpose: a stricter wording blocked "amog the destroyer", "xXSlayerXx" and "Gauss is a fraud"
export const PROMPT = "You screen player names for the leaderboard of a casual math games website. Gamer names are usually "
  + "playful, boastful or edgy, and that is fine: names about destroying, killing, slaying, death, doom, villains, "
  + "monsters, insults to math itself, your-mom jokes, crude-but-harmless jokes, nonsense and any language are ALLOWED. "
  + "BLOCK only names that contain a slur, attack a group of people (race, religion, gender, sexuality, disability), "
  + "are sexually explicit, tell someone to kill themselves, or praise real atrocities or hate figures, "
  + "including disguised spellings. When unsure, ALLOW. Reply with exactly one word: ALLOW or BLOCK.";

// true = allowed, false = blocked, null = no usable answer
export async function aiVerdict(ai, name, timeout = 3000) {
  let timer;
  try {
    const r = await Promise.race([
      ai.run(MODEL, { messages: [{ role: "system", content: PROMPT }, { role: "user", content: `Name: ${JSON.stringify(name)}` }], max_tokens: 4, temperature: 0 }),
      new Promise(res => { timer = setTimeout(res, timeout, null); }),
    ]);
    const a = String(r?.response ?? "").trim().toUpperCase();
    return a.startsWith("BLOCK") ? false : a.startsWith("ALLOW") ? true : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

// may this (already cleaned) name go on the leaderboard?
export async function checkName(env, name, now = Date.now()) {
  const row = await env.DB.prepare("SELECT ok, why FROM lb_names WHERE name = ?").bind(name).first();
  if (row && row.why === "admin") return !!row.ok;
  if (nameProblem(name)) return false;
  if (row) return !!row.ok;
  if (!env.AI) return true;
  const ok = await aiVerdict(env.AI, name);
  if (ok === null) return true;
  await env.DB.prepare("INSERT OR IGNORE INTO lb_names (name, ok, why, checked) VALUES (?, ?, ?, ?)").bind(name, ok ? 1 : 0, "ai", now).run();
  return ok;
}
