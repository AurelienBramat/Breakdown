// Scouting reports: team (offense / defense) and player tendencies over any set of games.
// Built from plays.csv + PFF scouting (instant) and per-game tracking summaries (time to throw, separation; cached).
// Self-check: node app/report.js
const key = p => `${p.gameId}-${p.playId}`;
const NAME = "[A-Z][a-z]{0,2}\\.\\s?[A-Z][\\w'-]+(?:\\.\\s?[A-Z][a-z][\\w'-]*)?"; // C.Godwin, A.St. Brown (same as the client)
const inc = (o, k, by = 1) => { if (k != null && k !== '') o[k] = (o[k] || 0) + by; };
const r1 = v => Math.round(v * 10) / 10, pct = (a, n) => n ? Math.round(1000 * a / n) / 10 : null;

function createReports({ games, plays, players, pff, tracking }) {
  // short name in a description ("C.Godwin") -> nflId among the players on that snap
  function resolve(short, ids) {
    if (!short) return null;
    const i = short.indexOf('.'), ini = short.slice(0, i), lastN = short.slice(i + 1).trim();
    const c = ids.filter(id => players[id]?.displayName?.endsWith(lastN));
    const hit = c.find(id => players[id].displayName.startsWith(ini)) ?? c[0];
    if (hit != null) return hit;
    return /\.\s/.test(lastN) ? resolve(short.slice(0, short.lastIndexOf('. ')), ids) : null; // "J.Washington. Coverage by…"
  }

  // ---- parse every play once: who was targeted, where, what happened
  const info = {};
  for (const p of plays) {
    const d = p.playDescription || '', rows = pff[key(p)] || [];
    const offIds = rows.filter(r => ['Pass Route', 'Pass Block', 'Pass'].includes(r.pff_role)).map(r => r.nflId);
    const m = d.match(/pass (?:incomplete )?(short|deep) (left|middle|right)/);
    const target = resolve(d.match(new RegExp(`(?:\\bto|intended for) (${NAME})`))?.[1], offIds);
    const rushers = rows.filter(r => r.pff_role === 'Pass Rush').length;
    info[key(p)] = {
      att: ['C', 'I', 'IN'].includes(p.passResult), comp: p.passResult === 'C', int: p.passResult === 'IN',
      sack: p.passResult === 'S', scramble: p.passResult === 'R',
      yds: p.passResult === 'C' ? (p.prePenaltyPlayResult ?? p.playResult ?? 0) : 0,
      td: p.passResult === 'C' && /TOUCHDOWN/.test(d), depth: m?.[1], dir: m?.[2], target, rushers,
      pressured: rows.some(r => r.pff_hit === 1 || r.pff_hurry === 1 || r.pff_sack === 1),
    };
  }

  // ---- tracking summary per game (time to throw, separation of every route runner at the throw)
  const tsCache = new Map();
  function trackSummary(gameId) {
    if (tsCache.has(gameId)) return tsCache.get(gameId);
    const out = {}, tr = tracking(gameId);
    for (const p of plays.filter(p => p.gameId === gameId)) {
      const t = tr[p.playId]; if (!t) continue;
      const ev = Object.entries(t.events).map(([f, e]) => [+f, e]);
      const S = ev.find(([, e]) => /ball_?snap/.test(e))?.[0];
      const E = ev.find(([f, e]) => f > (S ?? -1) && /pass_?forward|qb_sack|qb_strip_sack|^run$/.test(e))?.[0];
      if (S == null || E == null) continue;
      const rows = pff[key(p)] || [], at = id => t.ents[id]?.f[E];
      const defs = rows.filter(r => ['Coverage', 'Pass Rush'].includes(r.pff_role)).map(r => r.nflId).filter(at);
      const sep = {}, near = {};
      for (const r of rows.filter(r => r.pff_role === 'Pass Route')) {
        const me = at(r.nflId); if (!me || !defs.length) continue;
        let best = Infinity, who = null;
        for (const d of defs) { const q = at(d), dd = Math.hypot(q[0] - me[0], q[1] - me[1]); if (dd < best) { best = dd; who = d; } }
        sep[r.nflId] = best; near[r.nflId] = who;
      }
      out[p.playId] = { tt: (E - S) / 10, sep, near };
    }
    tsCache.set(gameId, out);
    return out;
  }

  // ---- aggregate a set of plays (team offense / defense / one QB)
  function passStats(list, withTracking) {
    const s = { dropbacks: list.length, att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, scrambles: 0, pa: 0, pressured: 0, blitz: 0, rushers: 0, box: 0,
      explosive: 0, deep: 0, third: 0, thirdConv: 0, formation: {}, personnelO: {}, personnelD: {}, dropback: {}, coverage: {}, covType: {},
      grid: {}, byDown: {}, byCov: {}, tt: [], tgtSep: [] };
    for (const p of list) {
      const x = info[key(p)];
      if (x.att) { s.att++; if (x.comp) { s.comp++; s.yds += x.yds; if (x.yds >= 20) s.explosive++; } if (x.int) s.int++; if (x.td) s.td++; }
      if (x.sack) s.sacks++; if (x.scramble) s.scrambles++; if (p.pff_playAction) s.pa++; if (x.pressured) s.pressured++;
      s.rushers += x.rushers; if (x.rushers >= 5) s.blitz++; s.box += p.defendersInBox || 0;
      inc(s.formation, p.offenseFormation); inc(s.personnelO, p.personnelO); inc(s.personnelD, p.personnelD);
      inc(s.dropback, p.dropBackType); inc(s.coverage, p.pff_passCoverage); inc(s.covType, p.pff_passCoverageType);
      if (x.att && x.depth) { if (x.depth === 'deep') s.deep++; const g = (s.grid[`${x.depth} ${x.dir}`] ||= { att: 0, comp: 0, yds: 0 }); g.att++; if (x.comp) { g.comp++; g.yds += x.yds; } }
      const bd = (s.byDown[p.down] ||= { n: 0, yds: 0, conv: 0 }); bd.n++; bd.yds += p.playResult || 0; if ((p.playResult || 0) >= p.yardsToGo) bd.conv++;
      if (p.down === 3) { s.third++; if ((p.playResult || 0) >= p.yardsToGo) s.thirdConv++; }
      if (x.att && p.pff_passCoverage) { const c = (s.byCov[p.pff_passCoverage] ||= { att: 0, comp: 0, yds: 0 }); c.att++; if (x.comp) { c.comp++; c.yds += x.yds; } }
      if (withTracking) { const t = trackSummary(p.gameId)[p.playId]; if (t) { s.tt.push(t.tt); if (x.target && t.sep[x.target] != null) s.tgtSep.push(t.sep[x.target]); } }
    }
    const avg = a => a.length ? r1(a.reduce((u, v) => u + v, 0) / a.length) : null;
    Object.assign(s, {
      compPct: pct(s.comp, s.att), ypa: s.att ? r1(s.yds / s.att) : null, sackRate: pct(s.sacks, s.dropbacks), scrambleRate: pct(s.scrambles, s.dropbacks),
      paRate: pct(s.pa, s.dropbacks), pressureRate: pct(s.pressured, s.dropbacks), blitzRate: pct(s.blitz, s.dropbacks),
      avgRushers: s.dropbacks ? r1(s.rushers / s.dropbacks) : null, avgBox: s.dropbacks ? r1(s.box / s.dropbacks) : null,
      deepRate: pct(s.deep, s.att), intRate: pct(s.int, s.att), explosiveRate: pct(s.explosive, s.att), thirdConvRate: pct(s.thirdConv, s.third),
      manRate: pct(s.covType.Man || 0, s.dropbacks), zoneRate: pct(s.covType.Zone || 0, s.dropbacks), tt: avg(s.tt), tgtSep: avg(s.tgtSep),
    });
    return s;
  }

  // ---- per-player leaders inside a set of plays
  function leaders(list, withTracking) {
    const L = {};
    const get = id => (L[id] ||= { id, name: players[id]?.displayName, pos: players[id]?.officialPosition, routes: 0, tgt: 0, rec: 0, yds: 0, td: 0,
      rush: 0, hurry: 0, hit: 0, sack: 0, block: 0, allowed: 0, beaten: 0, cover: 0, nearTgt: 0, nearComp: 0, nearYds: 0, sep: [] });
    for (const p of list) {
      const x = info[key(p)], t = withTracking ? trackSummary(p.gameId)[p.playId] : null;
      for (const r of pff[key(p)] || []) {
        const o = get(r.nflId);
        if (r.pff_role === 'Pass Route') { o.routes++; if (t?.sep[r.nflId] != null) o.sep.push(t.sep[r.nflId]); }
        if (r.pff_role === 'Pass Rush') { o.rush++; o.hurry += r.pff_hurry || 0; o.hit += r.pff_hit || 0; o.sack += r.pff_sack || 0; }
        if (r.pff_role === 'Pass Block') { o.block++; o.allowed += (r.pff_hurryAllowed || 0) + (r.pff_hitAllowed || 0) + (r.pff_sackAllowed || 0); o.beaten += r.pff_beatenByDefender || 0; }
        if (r.pff_role === 'Coverage') o.cover++;
      }
      if (x.target != null && x.att) { const o = get(x.target); o.tgt++; if (x.comp) { o.rec++; o.yds += x.yds; } if (x.td) o.td++; }
      const nd = x.target != null && t?.near[x.target];
      if (nd && x.att) { const o = get(nd); o.nearTgt++; if (x.comp) { o.nearComp++; o.nearYds += x.yds; } }
    }
    for (const o of Object.values(L)) { o.pressures = o.hurry + o.hit + o.sack; o.avgSep = o.sep.length ? r1(o.sep.reduce((a, b) => a + b, 0) / o.sep.length) : null; delete o.sep; }
    return Object.values(L);
  }

  const topPlays = list => list.map(p => ({ gameId: p.gameId, playId: p.playId, yds: p.playResult, desc: p.playDescription, q: p.quarter, clock: p.gameClock }))
    .sort((a, b) => b.yds - a.yds).slice(0, 8);
  const league = passStats(plays, false);
  const teamGames = t => games.filter(g => g.homeTeamAbbr === t || g.visitorTeamAbbr === t);

  // which team each player played for (from his PFF role on each snap)
  const playerTeam = {}, playerGames = {};
  for (const p of plays) for (const r of pff[key(p)] || []) {
    const off = ['Pass Route', 'Pass Block', 'Pass'].includes(r.pff_role);
    playerTeam[r.nflId] = off ? p.possessionTeam : p.defensiveTeam;
    (playerGames[r.nflId] ||= new Set()).add(p.gameId);
  }
  const playerList = Object.keys(playerTeam).map(id => ({ id: +id, name: players[id]?.displayName, pos: players[id]?.officialPosition, team: playerTeam[id] }))
    .filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name));

  function teamReport(team, side, gameIds) {
    const avail = teamGames(team), ids = gameIds?.length ? gameIds : avail.map(g => g.gameId);
    const list = plays.filter(p => ids.includes(p.gameId) && (side === 'def' ? p.defensiveTeam : p.possessionTeam) === team);
    const lead = leaders(list, true).filter(o => side === 'def' ? (o.rush || o.cover) && playerTeam[o.id] === team : (o.routes || o.block || o.tgt) && playerTeam[o.id] === team);
    return { kind: 'team', team, side, games: avail, selected: ids, stats: passStats(list, true), league, leaders: lead, top: topPlays(list) };
  }
  function playerReport(id, gameIds) {
    const avail = games.filter(g => playerGames[id]?.has(g.gameId)), ids = gameIds?.length ? gameIds : avail.map(g => g.gameId);
    const mine = plays.filter(p => ids.includes(p.gameId) && (pff[key(p)] || []).some(r => r.nflId === id));
    const roles = {}, aligned = {};
    for (const p of mine) for (const r of pff[key(p)]) if (r.nflId === id) { inc(roles, r.pff_role); inc(aligned, r.pff_positionLinedUp); }
    const asQB = mine.filter(p => (pff[key(p)] || []).some(r => r.nflId === id && r.pff_role === 'Pass'));
    const me = leaders(mine, true).find(o => o.id === id) || {};
    const targeted = mine.filter(p => info[key(p)].target === id && info[key(p)].att);
    const grid = {};
    for (const p of targeted) { const x = info[key(p)]; if (!x.depth) continue; const g = (grid[`${x.depth} ${x.dir}`] ||= { att: 0, comp: 0, yds: 0 }); g.att++; if (x.comp) { g.comp++; g.yds += x.yds; } }
    return { kind: 'player', player: { ...playerList.find(p => p.id === id), id }, games: avail, selected: ids, snaps: mine.length, roles, aligned, me, grid,
      qb: asQB.length ? passStats(asQB, true) : null, league,
      top: topPlays(mine.filter(p => info[key(p)].target === id || asQB.includes(p) || (pff[key(p)] || []).some(r => r.nflId === id && (r.pff_sack || r.pff_hit)))) };
  }
  return { teamReport, playerReport, playerList, info };
}
module.exports = { createReports };

// ---- self-check on a tiny hand-made dataset: node app/report.js
if (require.main === module) {
  const assert = require('assert');
  const games = [{ gameId: 1, week: 1, homeTeamAbbr: 'AAA', visitorTeamAbbr: 'BBB' }];
  const P = (playId, passResult, yds, desc, extra = {}) => ({ gameId: 1, playId, passResult, playResult: yds, prePenaltyPlayResult: yds, playDescription: desc,
    possessionTeam: 'AAA', defensiveTeam: 'BBB', down: 3, yardsToGo: 5, pff_playAction: 0, pff_passCoverage: 'Cover-1', pff_passCoverageType: 'Man', ...extra });
  const plays = [P(1, 'C', 25, 'X.Qb pass deep left to J.Wide to BBB 20 for 25 yards (C.Corner).'),
    P(2, 'I', 0, 'X.Qb pass incomplete short right to J.Wide.'), P(3, 'S', -7, 'X.Qb sacked at AAA 30 for -7 yards (E.Rush).', { pff_playAction: 1 })];
  const players = { 10: { displayName: 'Xavier Qb', officialPosition: 'QB' }, 11: { displayName: 'Jay Wide', officialPosition: 'WR' }, 20: { displayName: 'Ed Rush', officialPosition: 'DE' }, 21: { displayName: 'Cal Corner', officialPosition: 'CB' } };
  const pff = {};
  for (const p of plays) pff[`1-${p.playId}`] = [{ nflId: 10, pff_role: 'Pass' }, { nflId: 11, pff_role: 'Pass Route' },
    { nflId: 20, pff_role: 'Pass Rush', pff_sack: p.playId === 3 ? 1 : 0, pff_hurry: p.playId === 2 ? 1 : 0 }, { nflId: 21, pff_role: 'Coverage' }];
  const R = createReports({ games, plays, players, pff, tracking: () => ({}) });
  const off = R.teamReport('AAA', 'off');
  assert.strictEqual(off.stats.att, 2); assert.strictEqual(off.stats.comp, 1); assert.strictEqual(off.stats.compPct, 50);
  assert.strictEqual(off.stats.yds, 25); assert.strictEqual(off.stats.sacks, 1); assert.strictEqual(off.stats.deepRate, 50);
  assert.strictEqual(off.stats.pressureRate, 66.7); assert.strictEqual(off.stats.thirdConvRate, 33.3); assert.strictEqual(off.stats.paRate, 33.3);
  const wr = off.leaders.find(o => o.id === 11); assert.deepStrictEqual([wr.tgt, wr.rec, wr.yds, wr.routes], [2, 1, 25, 3]);
  const def = R.teamReport('BBB', 'def'); const de = def.leaders.find(o => o.id === 20); assert.deepStrictEqual([de.sack, de.hurry, de.pressures], [1, 1, 2]);
  assert.strictEqual(R.playerReport(11).grid['deep left'].yds, 25);
  assert.strictEqual(R.info['1-1'].target, 11);
  console.log('report self-check passed');
}
