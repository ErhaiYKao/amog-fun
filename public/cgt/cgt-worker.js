/* "Think harder" for the CGT playground: rebuilds the library from its definitions and runs one analysis with a big
 * budget, off the main thread. Message in: {id, defs: [[name, expr]], task: {type: "value", name} | {type: "rel", a, b}, ms}.
 * Out: {id, result} (null if it ran out of time) or {id, error}. */
importScripts("/cgt/cgt.js");
onmessage = e => {
  const { id, defs, task, ms } = e.data, env = {};
  try {
    for (const [name, expr] of defs) env[name] = CGT.parse(expr, env);
    let result;
    if (task.type === "value") { const r = CGT.analyse(env[task.name], 1e10, ms); result = r && { name: r.name, outcome: r.outcome }; }
    else result = CGT.relate(env[task.a], env[task.b], 1e10, ms);
    postMessage({ id, result });
  } catch (err) { postMessage({ id, error: err.message }); }
};
