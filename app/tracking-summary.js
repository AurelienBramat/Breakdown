// Shared by the server (replay) and the scouting workers (summary-worker.js).

// tracking_<gameId>.csv -> { playId: { ents: { id: { id, jersey, team, f: [[x, y, speed, o, dir], ...] } }, events, nFrames, dir } }
function parseTracking(text) {
  const lines = text.split('\n'), byPlay = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 16) continue;
    const playId = +c[1], frame = +c[3] - 1;
    const pl = (byPlay[playId] ||= { ents: {}, events: {}, nFrames: 0 });
    const id = c[2] === 'NA' ? 'ball' : c[2];
    const e = (pl.ents[id] ||= { id, jersey: c[5] === 'NA' ? null : +c[5], team: c[6], f: [] });
    e.f[frame] = [+c[8], +c[9], +c[10], +c[14] || 0, +c[15] || 0]; // x y speed orientation direction
    if (id === 'ball' && c[15].trim() !== 'None') pl.events[frame] = c[15].trim();
    pl.nFrames = Math.max(pl.nFrames, frame + 1);
    pl.dir = c[7];
  }
  return byPlay;
}

// Per play: time to throw, and each route runner's separation from (and id of) the nearest defender at the throw.
// roles: { playId: { routes: [nflId], defs: [nflId] } }
function summarize(byPlay, roles) {
  const out = {};
  for (const [playId, r] of Object.entries(roles)) {
    const t = byPlay[playId]; if (!t) continue;
    const ev = Object.entries(t.events).map(([f, e]) => [+f, e]);
    const S = ev.find(([, e]) => /ball_?snap/.test(e))?.[0];
    const E = ev.find(([f, e]) => f > (S ?? -1) && /pass_?forward|qb_sack|qb_strip_sack|^run$/.test(e))?.[0];
    if (S == null || E == null) continue;
    const at = id => t.ents[id]?.f[E], defs = r.defs.filter(at), sep = {}, near = {};
    for (const id of r.routes) {
      const me = at(id); if (!me || !defs.length) continue;
      let best = Infinity, who = null;
      for (const d of defs) { const q = at(d), dd = Math.hypot(q[0] - me[0], q[1] - me[1]); if (dd < best) { best = dd; who = d; } }
      sep[id] = Math.round(best * 100) / 100; near[id] = who;
    }
    out[playId] = { tt: (E - S) / 10, sep, near };
  }
  return out;
}
module.exports = { parseTracking, summarize };
