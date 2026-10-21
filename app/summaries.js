// Background pre-computation of per-game tracking summaries for scouting reports.
// - a fixed pool of worker threads (cpus - 1, max 6: each worker briefly holds one ~7MB game in memory)
// - one job per game; games a report is waiting on jump to the front of the queue; no job runs twice
// - results cached on disk (app/.cache), invalidated when the tracking files or the summary code version change
// Self-check: node app/summaries.js
const { Worker } = require('worker_threads');
const os = require('os'), fs = require('fs'), path = require('path');
const VERSION = 1; // bump when summarize() output changes

function createSummaries({ gameIds, rolesFor, fileFor, cacheFile, threads, log = console.log }) {
  const done = new Map(), waiters = new Map(), running = new Set();
  let queue = [], pool = [], saveTimer = null;
  const nThreads = threads ?? Math.max(1, Math.min(6, os.cpus().length - 1));

  // cache key: code version + size/mtime of every tracking file
  const signature = gameIds.map(id => { try { const s = fs.statSync(fileFor(id)); return `${id}:${s.size}:${s.mtimeMs}`; } catch { return `${id}:missing`; } }).join('|');
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION && c.signature === signature) for (const [id, s] of Object.entries(c.data)) done.set(+id, s);
  } catch { /* no cache yet */ }
  if (done.size) log(`scouting cache: ${done.size}/${gameIds.length} games ready`);

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const tmp = cacheFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, signature, data: Object.fromEntries(done) }));
        fs.renameSync(tmp, cacheFile); // atomic: a crash never leaves a half-written cache
      } catch (e) { log('scouting cache not saved: ' + e.message); }
    }, 1000);
  }
  function spawn() {
    const w = new Worker(path.join(__dirname, 'summary-worker.js'));
    w.on('message', m => finish(w, m));
    w.on('error', e => { log('summary worker crashed: ' + e.message); const id = w.job; pool = pool.filter(x => x !== w); if (id != null) finish(null, { gameId: id, error: e.message }); pool.push(spawn()); pump(); });
    return w;
  }
  function pump() {
    if (!queue.length) return;
    if (!pool.length) pool = Array.from({ length: nThreads }, spawn);
    for (const w of pool) {
      if (w.job != null) continue;
      let id; while (queue.length && (done.has(id = queue.shift()) || running.has(id))) id = undefined;
      if (id === undefined) break;
      w.job = id; running.add(id);
      w.postMessage({ gameId: id, file: fileFor(id), roles: rolesFor(id) });
    }
  }
  function finish(w, { gameId, summary, error }) {
    if (w) w.job = null;
    running.delete(gameId);
    if (error) log(`summary failed for ${gameId}: ${error}`); // report goes on without tracking stats for that game
    done.set(gameId, summary || {});
    for (const r of waiters.get(gameId) || []) r();
    waiters.delete(gameId);
    save(); pump();
    if (!queue.length && !running.size) { pool.forEach(x => x.terminate()); pool = []; } // idle: give the memory back
  }
  // resolve once every game in ids is summarized; those games go to the front of the queue
  function ensure(ids) {
    const missing = ids.filter(id => !done.has(id));
    if (!missing.length) return Promise.resolve();
    const set = new Set(missing);
    queue = [...missing.filter(id => !running.has(id)), ...queue.filter(id => !set.has(id))];
    const p = Promise.all(missing.map(id => new Promise(r => { if (!waiters.has(id)) waiters.set(id, []); waiters.get(id).push(r); })));
    pump();
    return p;
  }
  function warmAll() { const q = new Set(queue); queue.push(...gameIds.filter(id => !done.has(id) && !q.has(id))); pump(); }
  const progress = (ids = gameIds) => ({ done: ids.filter(id => done.has(id)).length, total: ids.length, running: running.size, threads: nThreads });
  return { ensure, warmAll, progress, get: id => done.get(id) };
}
module.exports = { createSummaries };

// ---- self-check: the pool's results match a plain single-threaded run, priority + dedupe work, cache round-trips
if (require.main === module) {
  const assert = require('assert');
  const { parseTracking, summarize } = require('./tracking-summary');
  const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'nfl-big-data-bowl-regional-event-data-main', 'data');
  const fileFor = id => path.join(DATA, 'tracking', `tracking_${id}.csv`);
  const ids = fs.readdirSync(path.join(DATA, 'tracking')).slice(0, 4).map(f => +f.match(/\d+/)[0]);
  // fake roles: everyone with a jersey on the home side "runs routes", the other side "defends"
  const rolesFor = id => { const t = parseTracking(fs.readFileSync(fileFor(id), 'utf8')), r = {};
    for (const [pid, pl] of Object.entries(t)) { const teams = [...new Set(Object.values(pl.ents).map(e => e.team).filter(x => x !== 'football'))];
      r[pid] = { routes: Object.values(pl.ents).filter(e => e.team === teams[0]).map(e => +e.id), defs: Object.values(pl.ents).filter(e => e.team === teams[1]).map(e => +e.id) }; }
    return r; };
  const roles = Object.fromEntries(ids.map(id => [id, rolesFor(id)]));
  const cacheFile = path.join(os.tmpdir(), `gr-summary-selfcheck-${process.pid}.json`);
  (async () => {
    const S = createSummaries({ gameIds: ids, rolesFor: id => roles[id], fileFor, cacheFile, threads: 2, log: () => {} });
    const order = [];
    const p1 = S.ensure([ids[3]]).then(() => order.push(ids[3]));
    S.warmAll(); S.ensure([ids[3], ids[3]]); // duplicate requests must not run the job twice
    await p1; await S.ensure(ids);
    assert.strictEqual(order[0], ids[3]);
    for (const id of ids) assert.deepStrictEqual(S.get(id), summarize(parseTracking(fs.readFileSync(fileFor(id), 'utf8')), roles[id]));
    assert.deepStrictEqual(S.progress(), { done: 4, total: 4, running: 0, threads: 2 });
    await new Promise(r => setTimeout(r, 1300)); // let the debounced save land
    const S2 = createSummaries({ gameIds: ids, rolesFor: () => { throw new Error('should come from cache'); }, fileFor, cacheFile, threads: 2, log: () => {} });
    assert.strictEqual(S2.progress().done, 4);
    fs.unlinkSync(cacheFile);
    console.log('summaries self-check passed');
  })().catch(e => { console.error(e); process.exit(1); });
}
