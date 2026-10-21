# Gridiron Replay

**Rewatch any NFL pass play like a coach, then change it and see how the defense would have reacted.**

Gridiron Replay turns raw NFL player-tracking data (every player's position 10 times a second) into a football-manager-style 2D replay. You can scrub through a play, see who was open, who pressured the QB and what coverage the defense called. Then you can give a receiver a different route, or switch the defense's call, and watch a simulated version of the same snap play out. The defense reacts based on how that team actually plays.

> Built for the AWS × NFL hackathon on the NFL Big Data Bowl dataset (2021 season, weeks 1–8).

---

## Table of contents

- [For investors and partners](#for-investors-and-partners)
- [Product tour](#product-tour)
- [Quick start (developers)](#quick-start-developers)
- [Architecture](#architecture)
- [The data](#the-data)
- [How the what-if simulator works](#how-the-what-if-simulator-works)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

---

## For investors and partners

### The problem
NFL teams and media already collect tracking data on every player in every game, but it mostly ends up as numbers in spreadsheets or as broadcast graphics. Two groups are left out:

- **Coaches and analysts** at college, high-school and semi-pro level can't afford pro-grade film and analytics tools. Even pros can only ask "what happened?". They can't easily ask **"what would have happened if…?"**
- **Fans** watch highlights passively. Fantasy players, bettors and students of the game want to understand *why* a play worked, and there are few interactive tools that explain it.

### The product
A browser app that does three things:

1. **Replay:** a clean 2D replay of any play with broadcast-style context (score, down and distance, clock), a camera that follows the action, and coach overlays (route chart, live "who's open" separation, pressure and blocking breakdown).
2. **Scouting:** each defense's tendencies, computed from real snaps. For example: "Dallas plays man 45% of the time on 3rd down, blitzes on 26% of snaps, and Cover-1 is its favourite call."
3. **What-if simulation:** change the play (tap a route from the route tree, or draw one) and choose the defensive call ("as called", "their usual", man, zone). The simulation replays the snap instantly. It shows how every defender adjusts and which receiver would have been the QB's best read.

### Why it's different
- **Interactive, not passive:** the what-if engine is the core feature. Most analytics tools describe a play; this one lets you rerun it with changes.
- **Grounded in real data:** every replay is real tracking data. The simulation starts from the real snap and only changes what your edit affects. Defender speed limits come from each player's real top speed, and the "their usual" call comes from that team's real tendencies.
- **Zero friction:** it runs in a browser, needs no install, and has zero dependencies. A play loads in under a second.

### Who it's for
| Segment | Use |
|---|---|
| College and high-school coaching staffs | Game-plan against an opponent's tendencies; teach route concepts against real coverages |
| Media and broadcasters | Interactive "what if he'd run a post?" segments |
| Fantasy and sports-betting audiences | Understand receiver usage and how open players really get |
| Fans and education | Learn the game by playing with real plays |

### Business model options
- **Subscription (B2C):** free replays, paid what-if and scouting.
- **Team licence (B2B):** each team or program uploads its own tracking or film-derived data.
- **Media and API licensing:** embeddable replay and what-if widgets for publishers.

### Built on AWS (scaling path)
The prototype is a single Node.js process. The production path maps directly onto AWS:

- **S3 + CloudFront:** tracking files and the static front-end.
- **Lambda or ECS (Fargate):** the API (it's stateless, so it scales out).
- **SageMaker:** train a defender-movement model on all tracking frames to replace the hand-tuned rules (see the roadmap).
- **Amazon Bedrock:** natural-language play breakdowns ("Why was Evans open?") and a chat coach.

### Current status
A working prototype covering 122 games and 8,557 pass plays, with replay, scouting and what-if simulation all working end to end.

---

## Product tour

| Area | What you can do |
|---|---|
| **Header** | Pick a game. The scoreboard shows the score, quarter, clock, down and distance, ball spot and possession. |
| **Left: play list** | Search ("Brady", "deep", "Cover-1"), quick filters (3rd down, Red zone, Big play 20+, TD, Sack, INT, Incomplete), and filter by offense. Each play has a result badge. |
| **Centre: field** | Auto-zoom camera, with the offense always attacking left → right. Hover a player for his name; click him for details. Toggles: Names, Route chart, Who's open (green ≥ 3 yds, yellow 1.5–3, red < 1.5), Trails, Full field. |
| **Controls** | Play/pause, previous/next play, jump to Snap or Throw, a timeline with clickable events, and 0.25×–2× speed. |
| **Right: Play tab** | Formation, personnel, coverage, dropback, rushers or blitz, time to throw, who pressured the QB, beaten blocks, and the selected player's card. |
| **Right: What-if tab** | 1) Pick a player 2) pick a route (or draw one) and its depth 3) pick the defense call. It re-simulates instantly. An **Original / What-if** switch sits on the field, and a results card under the field shows the best read and each receiver's real vs simulated separation. |
| **Right: Defense tab** | The team's man/zone split (overall and on this down), average rushers, blitz rate, box count and coverage-call distribution. |

**Keyboard:** `Space` play/pause · `←` `→` step a frame · `S` snap · `T` throw · `N` / `P` next/previous play.

---

## Quick start (developers)

Requirements: **Node.js 18+**. Nothing else: no `npm install`, no build step, no database.

```bash
git clone https://github.com/AurelienBramat/Hackathon-AWS-NFL.git
cd Hackathon-AWS-NFL
node app/server.js
# → http://localhost:3000
```

The repo includes the dataset (~826 MB), so the first clone takes a while.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `nfl-big-data-bowl-regional-event-data-main/data` | Folder containing the CSVs |

Startup parses the game, play, player and PFF CSVs in about 5–10 seconds. Each game's tracking file loads on first request and is cached; the cache holds 6 games.

---

## Architecture

```
┌────────────────────────── browser (app/index.html) ──────────────────────────┐
│  play list + filters │ canvas renderer (camera, overlays) │ tabs: play/what-if/defense │
│                      │ what-if engine (simulate())        │                           │
└──────────────▲──────────────────────────────────────────────────────────────┘
               │ JSON over HTTP
┌──────────────┴──────────── node (app/server.js, stdlib only) ────────────────┐
│ startup: parse games / plays / players / PFF scouting  →  team tendencies    │
│ on demand: parse tracking_<gameId>.csv → frames per play (FIFO cache, 6 games)│
└──────────────▲──────────────────────────────────────────────────────────────┘
               │ fs
        data/*.csv (NFL Big Data Bowl)
```

Design choices:
- **No dependencies, on purpose:** a ~20-line CSV parser and Node's `http` module cover everything we need. The whole app is two files you can read in one sitting.
- **The simulation runs in the browser:** it's pure math over about 50 frames × 22 players, so it finishes in milliseconds and every UI change re-runs it instantly.
- **Normalised coordinates:** the client flips plays where the offense went left, so the offense always attacks right. That keeps the drawing code and the simulation free of direction checks.

---

## The data

Source: [NFL Big Data Bowl](https://www.kaggle.com/competitions/nfl-big-data-bowl-2023) (tracking by NFL Next Gen Stats, scouting by Pro Football Focus). The full column reference is in [`nfl-big-data-bowl-regional-event-data-main/README.md`](nfl-big-data-bowl-regional-event-data-main/README.md).

| File | Rows | Key | Contents |
|---|---|---|---|
| `games.csv` | 122 | `gameId` | Teams, week, date |
| `plays.csv` | 8,557 | `gameId, playId` | Down, distance, formation, personnel, coverage (PFF), result, description |
| `players.csv` | 1,679 | `nflId` | Name, position, height, weight |
| `pffScoutingData.csv` | 188,254 | `gameId, playId, nflId` | Role (pass route / block / rush / coverage), alignment, hits, hurries, sacks, blocks |
| `tracking/tracking_<gameId>.csv` | ~90k per game | `gameId, playId, nflId, frameId` | x, y (yards), speed, orientation, direction, events at 10 Hz |

Coordinates: the field is 120 × 53.3 yards, with end zones at x 0–10 and 110–120. `absoluteYardlineNumber` is the line of scrimmage in tracking x.

---

## How the what-if simulator works

The code is in `simulate()` in [`app/index.html`](app/index.html). It simulates from the snap to the throw (or the sack).

**1. Offense.** An edited player runs his new route from his real position at the snap:
- He accelerates at 5 yd/s² up to his real top speed (at least 7 yd/s).
- He loses speed at each cut, scaled by the sharpness of the turn (up to 55% for a full reversal).
- He settles when the route ends.

Every player you didn't edit keeps his exact real tracking.

**2. Assignments.** Each coverage defender is linked to the receiver he stayed closest to, on average, during the real play. In man coverage this matches his real assignment.

**3. Defensive reaction**, depending on the call you choose:

| Call | Behaviour |
|---|---|
| Same as played, **man** | The defender keeps his real track, shifted by how far his receiver moved from the original route, with a 0.3 s reaction delay |
| Same as played, **zone** | The defender keeps his real track, but breaks on an edited receiver who enters his area (full reaction within 3 yds, fading out by 10 yds) |
| **Forced man** | He trails his assigned receiver, closing the cushion he had at the snap over about 2 s |
| **Forced zone** | He drops to a landmark (8 yds for underneath defenders, 14+ yds for deep ones) and breaks on the closest receiver within 7 yds |
| **Their usual** | Man or zone, whichever this defense plays more often on this down (from `/api/team`) |

Only defenders whose situation actually changed are re-simulated. Everyone else stays on real data.

**4. Physics limits.** Each defender is capped at 103% of his own real top speed, 7 yd/s² acceleration and a 0.3 s reaction delay (`LAG`, `AMAX`, `DT` constants).

**5. Output.** Each receiver's separation from the nearest defender at the throw, simulated vs real, and the "best read" (the most open receiver).

The reaction rules are hand-tuned heuristics that produce plausible results. They are not a trained model. Replacing them with a model learned from the tracking frames is the top roadmap item.

---

## API reference

All endpoints are `GET` and return JSON.

| Endpoint | Returns |
|---|---|
| `/api/games` | All games (`gameId`, week, teams, date) |
| `/api/plays?game=<gameId>` | All plays of a game (the `plays.csv` rows) |
| `/api/play?game=<gameId>&play=<playId>` | `{ play, dir, nFrames, events: {frame: name}, ents: [...] }` |
| `/api/team?t=<abbr>` | Defensive tendencies: `{ all, byDown: {1..4} }`, each `{ n, man, zone, rush, blitz, box, cov: {call: count} }` |

Each entity in `ents` looks like `{ id, jersey, team, name, pos, role, lined, hit, hurry, sack, beaten, blocked, f: [[x, y, speed, orientation, direction], …] }`, with one entry in `f` per frame. The ball has `id: "ball"`.

---

## Project structure

```
app/
  server.js        Node stdlib HTTP server: CSV parsing, team tendencies, tracking cache, JSON API
  index.html       Whole front-end: layout/CSS, canvas renderer, playback, what-if UI and engine
nfl-big-data-bowl-regional-event-data-main/
  data/            Big Data Bowl CSVs (+ tracking/ per game)
  README.md        Official column-by-column data dictionary
```

Where to change things in `index.html`:
- Field drawing and overlays: `drawField()`, `draw()`
- Camera: `computeView()`
- Route tree: the `ROUTES` constant (each waypoint is `[downfield yds, outside yds]`)
- Simulation: `simulate()` and its constants `LAG`, `DT`, `AMAX`
- Play filters: the `FILTERS` object

---

## Limitations

- **Pass plays only, 2021 weeks 1–8:** this is the scope of the Big Data Bowl dataset. There are no run plays and no special teams.
- **The simulation ends at the throw.** It doesn't predict catch probability or yards after catch, and the ball isn't redirected to a new route.
- **Heuristic defense:** the rules above are plausible, not validated. Pass rushers and blockers aren't re-simulated.
- **Single process and in-memory cache.** That's fine for a demo, but not multi-tenant.

## Roadmap

1. **Learned defense model:** train a model on every tracking frame to predict each defender's next movement, given the receivers and the coverage (SageMaker).
2. **Catch probability and expected yards** at the throw, so a what-if reports "+0.4 expected yards" instead of only separation.
3. **Defensive what-ifs:** add a blitzer, rotate a safety, switch a corner's leverage.
4. **AI play breakdowns:** a plain-language explanation of any play or what-if (Amazon Bedrock).
5. **Shareable links and clips** for a play or a what-if scenario.
6. **More data:** full seasons, run plays, and teams' own tracking data.

---

*Data © NFL / Pro Football Focus, provided through the NFL Big Data Bowl for non-commercial competition use. A commercial product would need its own data licensing.*
