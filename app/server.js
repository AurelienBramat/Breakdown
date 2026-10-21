// Zero-dependency server: node app/server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseTracking } = require('./tracking-summary');
const { createSummaries } = require('./summaries');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'nfl-big-data-bowl-regional-event-data-main', 'data');
const PORT = process.env.PORT || 3000;

// Minimal CSV parser (handles quoted fields with commas). Returns array of objects.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => {
    const o = {};
    head.forEach((h, i) => { const v = r[i]; o[h] = v === 'NA' || v === '' ? null : (isNaN(v) ? v : +v); });
    return o;
  });
}
const load = f => parseCSV(fs.readFileSync(path.join(DATA, f), 'utf8'));

console.log('Loading CSVs...');
const games = load('games.csv');
const plays = load('plays.csv');
const players = Object.fromEntries(load('players.csv').map(p => [p.nflId, p]));
const pff = {}; // `${gameId}-${playId}` -> rows
for (const r of load('pffScoutingData.csv')) (pff[`${r.gameId}-${r.playId}`] ||= []).push(r);
console.log(`${games.length} games, ${plays.length} plays`);

// Defensive tendencies per team: how they usually play, overall and by down.
function bucket() { return { n: 0, man: 0, zone: 0, rush: 0, blitz: 0, box: 0, cov: {} }; }
const teams = {};
for (const p of plays) {
  const t = (teams[p.defensiveTeam] ||= { all: bucket(), byDown: {} });
  const rushers = (pff[`${p.gameId}-${p.playId}`] || []).filter(r => r.pff_role === 'Pass Rush').length;
  for (const b of [t.all, (t.byDown[p.down] ||= bucket())]) {
    b.n++;
    if (p.pff_passCoverageType === 'Man') b.man++;
    if (p.pff_passCoverageType === 'Zone') b.zone++;
    b.rush += rushers; if (rushers >= 5) b.blitz++;
    b.box += p.defendersInBox || 0;
    if (p.pff_passCoverage) b.cov[p.pff_passCoverage] = (b.cov[p.pff_passCoverage] || 0) + 1;
  }
}

// Tracking: one CSV per game, parsed on demand. ponytail: FIFO cache of 6 games (~400MB worst case), make it LRU if memory matters.
const trackCache = new Map();
const trackFile = gameId => path.join(DATA, 'tracking', `tracking_${gameId}.csv`);
function tracking(gameId) {
  if (trackCache.has(gameId)) return trackCache.get(gameId);
  const byPlay = parseTracking(fs.readFileSync(trackFile(gameId), 'utf8'));
  if (trackCache.size >= 6) trackCache.delete(trackCache.keys().next().value);
  trackCache.set(gameId, byPlay);
  return byPlay;
}

function playPayload(gameId, playId) {
  const tr = tracking(gameId)[playId];
  if (!tr) return null;
  const roles = Object.fromEntries((pff[`${gameId}-${playId}`] || []).map(r => [r.nflId, r]));
  const ents = Object.values(tr.ents).map(e => {
    const p = players[e.id] || {}, r = roles[e.id] || {};
    return { ...e, name: p.displayName, pos: p.officialPosition, role: r.pff_role, lined: r.pff_positionLinedUp,
      hit: r.pff_hit, hurry: r.pff_hurry, sack: r.pff_sack, beaten: r.pff_beatenByDefender, blocked: r.pff_nflIdBlockedPlayer };
  });
  return { play: plays.find(p => p.gameId === gameId && p.playId === playId), dir: tr.dir, nFrames: tr.nFrames, events: tr.events, ents };
}

// scouting: tracking summaries are computed by a worker pool in the background (and cached on disk), never on this thread
let summaries;
const reports = require('./report').createReports({ games, plays, players, pff, summaryFor: id => summaries.get(id) });
summaries = createSummaries({ gameIds: games.map(g => g.gameId), rolesFor: reports.rolesFor, fileFor: trackFile, cacheFile: path.join(__dirname, '.cache', 'track-summaries.json'),
  threads: process.env.SCOUT_THREADS ? Math.max(1, +process.env.SCOUT_THREADS) : undefined });

const json = (res, o) => { res.writeHead(o ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const g = +u.searchParams.get('game'), p = +u.searchParams.get('play');
  try {
    if (u.pathname === '/api/games') return json(res, games);
    if (u.pathname === '/api/plays') return json(res, plays.filter(x => x.gameId === g));
    if (u.pathname === '/api/play') return json(res, playPayload(g, p));
    if (u.pathname === '/api/team') return json(res, teams[u.searchParams.get('t')]);
    if (u.pathname === '/api/players') return json(res, reports.playerList);
    if (u.pathname === '/api/report' || u.pathname === '/api/progress') {
      const ids = (u.searchParams.get('games') || '').split(',').filter(Boolean).map(Number);
      const t = u.searchParams.get('team'), id = +u.searchParams.get('player');
      if (t && !teams[t]) return json(res, null);
      const need = t || id ? reports.gameIdsFor({ team: t, player: id }, ids) : undefined;
      if (u.pathname === '/api/progress') return json(res, summaries.progress(need));
      if (!need) return json(res, null);
      return summaries.ensure(need).then(() => json(res, t ? reports.teamReport(t, u.searchParams.get('side') === 'def' ? 'def' : 'off', ids) : reports.playerReport(id, ids)))
        .catch(e => { console.error(e); res.writeHead(500); res.end(String(e.message)); });
    }
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res); }
    json(res, null);
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, () => { console.log(`http://localhost:${PORT}`); summaries.warmAll(); });
