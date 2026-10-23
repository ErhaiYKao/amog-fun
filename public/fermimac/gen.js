/* Fermimac — estimation zetamac. Pure (no DOM), runs in Node for tests (tools/fermimac/gen.test.mjs) and in the
 * Worker for the leaderboard replay (worker/fermimac.js).
 *
 * A run is a preset + a seed: makeRun(presetId, seed).next() gives the problems in order, and they don't depend on
 * your guesses (one guess per problem, right or wrong it moves on), so the server can replay a run from its seed.
 * Problems: { type, tex (KaTeX, math only), text (plain), answer (a positive real) }.
 * Presets: math within a relative tolerance, or Fermi questions within a factor. */
(function (root) {
  "use strict";

  const mulberry32 = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ri = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = (a, rng) => a[Math.floor(rng() * a.length)];
  const M = (tex, text, answer) => ({ tex, text, answer });

  // ---------- math ----------
  // π(N) and the n-th prime p_n at round N and n (checked against a sieve in the tests)
  const PI = { 1e3: 168, 2e3: 303, 5e3: 669, 1e4: 1229, 2e4: 2262, 5e4: 5133, 1e5: 9592, 2e5: 17984, 5e5: 41538,
    1e6: 78498, 2e6: 148933, 5e6: 348513, 1e7: 664579, 1e8: 5761455, 1e9: 50847534 };
  const NTH = { 100: 541, 500: 3571, 1000: 7919, 5000: 48611, 10000: 104729, 50000: 611953, 100000: 1299709, 1000000: 15485863 };
  const sci = n => { const e = Math.floor(Math.log10(n)), m = n / 10 ** e; return m === 1 ? `10^{${e}}` : `${m} \\cdot 10^{${e}}`; };
  const fact = n => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const harmonic = n => { if (n <= 1e5) { let s = 0; for (let i = n; i >= 1; i--) s += 1 / i; return s; } return Math.log(n) + 0.5772156649015329 + 1 / (2 * n) - 1 / (12 * n * n); };
  const fib = n => { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; };
  const deg = x => x * Math.PI / 180;

  const MATH = [
    { id: "exp", name: "powers of e", gen: rng => { const x = ri(5, 70, rng) / 10; return M(`e^{${x}}`, `e^${x}`, Math.exp(x)); } },
    { id: "pow2", name: "powers of 2", gen: rng => { let x; do x = ri(30, 200, rng) / 10; while (Number.isInteger(x)); return M(`2^{${x}}`, `2^${x}`, 2 ** x); } },
    { id: "sqrt", name: "square roots", gen: rng => { let n; do n = ri(2, 9999, rng); while (Number.isInteger(Math.sqrt(n))); return M(`\\sqrt{${n}}`, `√${n}`, Math.sqrt(n)); } },
    { id: "cbrt", name: "cube roots", gen: rng => { let n; do n = ri(2, 99999, rng); while (Math.round(Math.cbrt(n)) ** 3 === n); return M(`\\sqrt[3]{${n}}`, `∛${n}`, Math.cbrt(n)); } },
    { id: "ln", name: "natural logs", gen: rng => { const n = ri(3, 99999, rng); return M(`\\ln ${n}`, `ln ${n}`, Math.log(n)); } },
    { id: "log", name: "logs base 2 and 10", gen: rng => rng() < 0.5
      ? (n => M(`\\log_2 ${n}`, `log₂ ${n}`, Math.log2(n)))(ri(5, 999999, rng))
      : (n => M(`\\log_{10} ${n}`, `log₁₀ ${n}`, Math.log10(n)))(ri(20, 9999999, rng)) },
    { id: "mul", name: "big products", gen: rng => { const a = ri(1000, 9999, rng), b = ri(1000, 9999, rng); return M(`${a} \\times ${b}`, `${a} × ${b}`, a * b); } },
    { id: "div", name: "long division", gen: rng => { const a = ri(10000, 999999, rng), b = ri(13, 999, rng); return M(`${a} \\div ${b}`, `${a} ÷ ${b}`, a / b); } },
    { id: "recip", name: "reciprocals", gen: rng => { const n = ri(7, 999, rng); return M(`\\frac{1}{${n}}`, `1/${n}`, 1 / n); } },
    { id: "pow", name: "powers", gen: rng => { const a = ri(11, 99, rng), b = ri(3, 8, rng); return M(`${a}^{${b}}`, `${a}^${b}`, a ** b); } },
    { id: "fact", name: "factorials", gen: rng => { const n = ri(10, 30, rng); return M(`${n}!`, `${n}!`, fact(n)); } },
    { id: "binom", name: "binomials", gen: rng => { const n = ri(20, 60, rng), k = ri(4, Math.floor(n / 2), rng); return M(`\\dbinom{${n}}{${k}}`, `C(${n}, ${k})`, choose(n, k)); } },
    { id: "trig", name: "trig in degrees", gen: rng => {
      const f = pick(["sin", "cos", "tan"], rng), t = ri(5, f === "tan" ? 80 : 85, rng);
      return M(`\\${f} ${t}^\\circ`, `${f} ${t}°`, Math[f](deg(t)));
    } },
    { id: "primes", name: "prime counting", gen: rng => { const N = +pick(Object.keys(PI), rng); return M(`\\pi(${sci(N)})`, `π(${N})`, PI[N]); } },
    { id: "nth", name: "n-th prime", gen: rng => { const n = +pick(Object.keys(NTH), rng); return M(`p_{${n}}`, `the ${n}-th prime`, NTH[n]); } },
    { id: "harm", name: "harmonic numbers", gen: rng => {
      const n = pick([1, 2, 5], rng) * 10 ** ri(1, 8, rng);
      return M(`1 + \\tfrac12 + \\tfrac13 + \\cdots + \\tfrac1{${n >= 1e4 ? sci(n) : n}}`, `1 + 1/2 + … + 1/${n}`, harmonic(n));
    } },
    { id: "fib", name: "Fibonacci numbers", gen: rng => { const n = ri(20, 90, rng); return M(`F_{${n}}`, `F_${n}`, fib(n)); } },
    { id: "interest", name: "compound growth", gen: rng => {
      const r = ri(2, 12, rng), n = ri(5, 50, rng), b = (100 + r) / 100;
      return M(`${b.toFixed(2)}^{${n}}`, `${b.toFixed(2)}^${n}`, b ** n);
    } },
    { id: "digits", name: "digit counts", gen: rng => {
      let b; do b = ri(2, 99, rng); while (b % 10 === 0);
      const n = ri(10, 300, rng);
      return M(`\\text{digits of } ${b}^{${n}}`, `number of digits of ${b}^${n}`, Math.floor(n * Math.log10(b)) + 1);
    } },
    { id: "const", name: "constants", gen: rng => pick([
      () => (n => M(`\\pi^{${n}}`, `π^${n}`, Math.PI ** n))(ri(2, 9, rng)),
      () => M(`e^{\\pi}`, `e^π`, Math.exp(Math.PI)), () => M(`\\pi^{e}`, `π^e`, Math.PI ** Math.E),
      () => M(`\\pi^{\\pi}`, `π^π`, Math.PI ** Math.PI), () => M(`e^{e}`, `e^e`, Math.E ** Math.E),
      () => (n => M(`\\varphi^{${n}}`, `φ^${n}`, ((1 + Math.sqrt(5)) / 2) ** n))(ri(5, 40, rng)),
      () => (n => M(`\\sqrt{${n}}\\,\\pi`, `π√${n}`, Math.PI * Math.sqrt(n)))(ri(2, 99, rng)),
    ], rng)() },
  ];

  // ---------- Fermi questions: [question, answer]. Values as of the mid-2020s, rounded; ×2 tolerance covers the rest.
  const FERMI = [
    // space
    ["Distance from the Earth to the Moon, in km", 384400], ["Distance from the Earth to the Sun, in km", 1.496e8],
    ["Diameter of the Earth, in km", 12742], ["Diameter of the Sun, in km", 1.39e6], ["Diameter of the Moon, in km", 3474],
    ["Mass of the Earth, in kg", 5.97e24], ["Age of the universe, in years", 1.38e10], ["Age of the Earth, in years", 4.54e9],
    ["Seconds sunlight takes to reach the Earth", 499], ["Kilometres in one light-year", 9.46e12],
    ["Distance to the nearest star after the Sun, in light-years", 4.25], ["Surface temperature of the Sun, in kelvin", 5772],
    ["Diameter of Jupiter, in km", 139820], ["How many Earths would fit inside the Sun (by volume)", 1.3e6],
    ["Speed of the Earth around the Sun, in km per second", 29.8], ["Speed of the International Space Station, in km/h", 27600],
    ["Altitude of the International Space Station, in km", 410], ["Length of a year on Mars, in Earth days", 687],
    ["Distance from the Sun to Neptune, in Earth–Sun distances (AU)", 30.1], ["Kilometres light travels in one second", 299792],
    ["Distance the Earth travels around the Sun in a year, in km", 9.4e8], ["People who have walked on the Moon", 12],
    // the Earth
    ["Circumference of the Earth at the equator, in km", 40075], ["Height of Mount Everest, in metres", 8849],
    ["Depth of the Mariana Trench, in metres", 10935], ["Length of the Nile, in km", 6650],
    ["Volume of the Earth's oceans, in cubic km", 1.335e9], ["Surface area of the Earth, in square km", 5.1e8],
    ["Percentage of the Earth's surface covered by ocean", 71], ["Area of the United States, in square km", 9.83e6],
    ["Area of Russia, in square km", 1.71e7], ["Area of the United Kingdom, in square km", 242500],
    ["Mass of the Earth's atmosphere, in kg", 5.15e18], ["Trees on Earth", 3.04e12], ["Member states of the United Nations", 193],
    ["Maximum depth of Lake Baikal, in metres", 1642], ["Area of Antarctica, in square km", 1.42e7],
    ["Average depth of the ocean, in metres", 3688], ["Height of Angel Falls, in metres", 979],
    ["Height of Mount Kilimanjaro, in metres", 5895], ["Islands in Indonesia", 17000], ["Lakes in Finland", 188000],
    ["Lightning strikes on Earth per second", 44], ["Temperature at the centre of the Earth, in °C", 5500],
    ["Length of the River Thames, in km", 346],
    // people
    ["People in the world", 8.1e9], ["People in India", 1.44e9], ["People in the United States", 3.35e8],
    ["People in Japan", 1.24e8], ["People in Australia", 2.7e7], ["People in Canada", 4.1e7],
    ["People in Greater Tokyo", 3.7e7], ["People in New York City", 8.3e6], ["People in London", 8.9e6],
    ["People in the city of Paris (not the suburbs)", 2.1e6], ["People in Iceland", 3.9e5],
    ["Humans who have ever lived", 1.17e11], ["Languages spoken in the world today", 7000],
    ["Babies born worldwide per day", 3.6e5], ["Life expectancy at birth worldwide, in years", 73],
    ["People in the world in the year 1800", 1e9],
    // the body
    ["Bones in an adult human", 206], ["Neurons in a human brain", 8.6e10], ["Hairs on a human head", 1e5],
    ["Litres of blood in an adult", 5], ["Mass of an adult human brain, in kg", 1.4], ["Red blood cells in an adult", 2.5e13],
    ["Length of the DNA in one human cell, stretched out, in metres", 2], ["Heartbeats per day at rest", 1e5],
    ["Cells in a human body", 3.5e13], ["Teeth in an adult mouth, wisdom teeth included", 32], ["Breaths a person takes per day", 2e4],
    ["Area of an adult's skin, in square metres", 1.8], ["Atoms in a human body", 7e27],
    ["Litres of blood the heart pumps per day", 7500], ["Power used by a human brain, in watts", 20],
    ["Food energy an adult needs per day, in kcal", 2200], ["Width of a human hair, in micrometres", 70],
    ["Diameter of a red blood cell, in micrometres", 7.5],
    // animals
    ["Ants on Earth", 2e16], ["Chickens alive at any one time", 2.6e10], ["Wild birds on Earth", 5e10],
    ["Mass of a blue whale, in tonnes", 150], ["Mass of an adult male African elephant, in kg", 6000],
    ["Top speed of a cheetah, in km/h", 110], ["Described species of beetle", 4e5], ["Known species of mammal", 6400],
    ["Dogs in the world", 9e8], ["Length of an E. coli bacterium, in micrometres", 2],
    // made by people
    ["Height of the Eiffel Tower, in metres", 330], ["Height of the Burj Khalifa, in metres", 828],
    ["Total length of the Golden Gate Bridge, in metres", 2737], ["Height of the Statue of Liberty, ground to torch, in metres", 93],
    ["Keys on a piano", 88], ["Length of a marathon, in km", 42.195], ["Mass of a typical car, in kg", 1500],
    ["Grains of rice in a kilogram", 5e4], ["Litres of water in an Olympic swimming pool", 2.5e6],
    ["Words in the King James Bible", 7.83e5], ["Words in all seven Harry Potter books", 1.08e6],
    ["McDonald's restaurants in the world", 4.2e4], ["Commercial flights per day worldwide", 1e5], ["Cars in the world", 1.45e9],
    ["Cups of coffee drunk worldwide per day", 2.25e9], ["Original height of the Great Pyramid of Giza, in metres", 146.6],
    ["Years since the Great Pyramid of Giza was built", 4500], ["Mass of the Great Pyramid of Giza, in tonnes", 6e6],
    ["Steps to walk one kilometre", 1300], ["Articles on the English Wikipedia", 6.9e6],
    ["Hours of video uploaded to YouTube per minute", 500], ["Books in the Library of Congress", 2.5e7],
    ["Transistors in an Apple M1 chip", 1.6e10], ["Active satellites orbiting the Earth", 1e4],
    ["Cruising speed of a passenger jet, in km/h", 900], ["Thickness of a sheet of paper, in mm", 0.1],
    ["Mass of a US penny, in grams", 2.5], ["Mass of a sheet of A4 paper, in grams", 5],
    ["Motor vehicles made worldwide per year", 9.3e7], ["Smartphones sold worldwide per year", 1.2e9],
    ["Emails sent worldwide per day", 3.5e11], ["Google searches per day", 8.5e9],
    // physics and economics
    ["Seconds in a year", 3.156e7], ["Minutes in an 80-year life", 4.2e7], ["Speed of sound in air, in metres per second", 343],
    ["Wavelength of green light, in nanometres", 530], ["Water molecules in a 250 ml glass of water", 8.4e24],
    ["Electricity used worldwide per year, in terawatt-hours", 2.9e4], ["Barrels of oil used worldwide per day", 1e8],
    ["Tonnes of CO₂ emitted worldwide per year", 3.7e10], ["US dollars in circulation as cash", 2.3e12],
    ["World GDP per year, in US dollars", 1.05e14], ["US GDP per year, in US dollars", 2.74e13],
  ].map(([text, answer], i) => ({ id: i, text, answer }));

  // ---------- presets, runs, checking ----------
  const PRESETS = [
    { id: "feynman", name: "Feynman", kind: "math", tol: 0.10, blurb: "math, within 10%" },
    { id: "sharp", name: "Sharp", kind: "math", tol: 0.02, blurb: "math, within 2%" },
    { id: "fermi", name: "Fermi", kind: "fermi", factor: 2, blurb: "the world, within a factor of 2" },
    // GeoGuessr-style: a fixed number of rounds in the time bank, points for how close each guess is
    { id: "guessr", name: "FermiGuessr", kind: "fermi", rounds: 10, blurb: "10 questions, up to 5,000 points each" },
  ];
  const MAX_POINTS = 5000;
  const DURATIONS = [60, 120, 300];
  const preset = id => PRESETS.find(p => p.id === id);

  function makeRun(presetId, seed) {
    const P = preset(presetId), rng = mulberry32(seed);
    if (P.kind === "fermi") {
      let order = [], i = 0;
      const deal = () => { order = FERMI.map(q => q.id); for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; } i = 0; };
      return { next: () => { if (i >= order.length) deal(); const q = FERMI[order[i++]]; return { type: "fermi", tex: null, text: q.text, answer: q.answer }; } };
    }
    let prev = null;
    return { next: () => {
      let p;
      for (let k = 0; k < 5; k++) { const t = pick(MATH, rng); p = { type: t.id, ...t.gen(rng) }; if (!prev || p.text !== prev.text) break; }
      return (prev = p);
    } };
  }

  // a guess as typed: 1234, 1,234, 4.2e18, 4.2×10^18, 4.2*10^18, 10^18, 3k, 2.5M, 1.2bn, 4T, 1.5 million
  const SUFFIX = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
  function parseGuess(s) {
    s = String(s).toLowerCase().replace(/[\s,_]/g, "").replace(/[×x*·]10\^/, "e").replace(/^10\^/, "1e").replace(/−/g, "-");
    const m = s.match(/^(\d*\.?\d+|\d+\.)(?:e([+-]?\d+))?([a-z]*)$/);
    if (!m) return NaN;
    const mult = m[3] ? SUFFIX[m[3]] : 1;
    if (!mult) return NaN;
    return parseFloat(m[1]) * 10 ** (+m[2] || 0) * mult;
  }
  // relative error |g/a - 1| for math, factor max(g/a, a/g) for Fermi
  function check(presetId, prob, guess) {
    const P = preset(presetId), g = typeof guess === "number" ? guess : parseGuess(guess);
    if (!(g > 0) || !Number.isFinite(g)) return false;
    return P.kind === "fermi" ? Math.max(g / prob.answer, prob.answer / g) <= P.factor * (1 + 1e-12)
      : Math.abs(g / prob.answer - 1) <= P.tol * (1 + 1e-12);
  }
  // FermiGuessr: 5000 × (smaller / larger), so exact = 5000, off by ×2 = 2500, off by ×10 = 500
  function points(prob, guess) {
    const g = typeof guess === "number" ? guess : parseGuess(guess);
    if (!(g > 0) || !Number.isFinite(g)) return 0;
    return Math.round(MAX_POINTS * Math.min(g / prob.answer, prob.answer / g));
  }
  // what one guess adds to the score: points in FermiGuessr, else 1 for a hit
  const score = (presetId, prob, guess) => preset(presetId).rounds ? points(prob, guess) : check(presetId, prob, guess) ? 1 : 0;
  // 4 significant figures; scientific notation outside [0.001, 10^7)
  function fmt(x, html = true) {
    if (x >= 1e7 || x < 1e-3) {
      const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
      return html ? `${+m.toPrecision(4)} × 10<sup>${e}</sup>` : `${+m.toPrecision(4)}e${e}`;
    }
    const s = +x.toPrecision(4);
    return s >= 1000 ? s.toLocaleString("en-US", { maximumFractionDigits: 3 }) : String(s);
  }

  root.Fermimac = { PRESETS, DURATIONS, MAX_POINTS, MATH, FERMI, PI, NTH, preset, makeRun, parseGuess, check, points, score, fmt, mulberry32, harmonic, fib, choose, fact };
})(typeof window !== "undefined" ? window : globalThis);
