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

1. **Replay:** a clean 2D replay of any play with broadcast-style context (score, down and distance, clock), a camera that follows the action, and coach overlays (route chart, live "who's open" separation, pressure and blocking breakdown). Each play runs from the line-up through the throw, catch, run after the catch and tackle, with a click-to-jump "play story" timeline.
2. **Scouting:** each defense's tendencies, computed from real snaps. For example: "Dallas plays man 45% of the time on 3rd down, blitzes on 26% of snaps, and Cover-1 is its favourite call."
3. **What-if simulation:** coaches can change almost anything about the play. Give any receiver a new route (route tree, or draw one and drag its points), move any player's pre-snap alignment, send any defender on a blitz, put him in man on a receiver you pick or drop him into a zone spot you click, switch the coverage call, and choose when the QB throws and to whom. The play re-simulates instantly through to the outcome (sack, catch, breakup or interception, then the run after the catch), and every scenario can be undone or saved.
4. **Compare:** put the real play, the current what-if and any saved scenarios side by side. They play in sync on mini fields, with a scorecard table (result, yards, time to throw, target, most open receiver) and a 🏆 on the best result. A coach can test three play calls against the same defense and see which one wins.
5. **Scouting reports:** tendencies and a plain-language playstyle summary for any team (offense or defense) or any player, over one game, several or all of them. A coordinator can see how an opponent really plays: how often they blitz, which coverage they lean on and where it leaks, who they target and where, and which pass rusher gets home. Every number links back to the plays behind it.

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
| **Left: play list** | Search ("Brady", "deep", "Cover-1"), quick filters (3rd down, Red zone, Big play 20+, TD, Sack, INT, Incomplete), and filters by quarter (Q1–Q4, OT) and by offense. Each play has a result badge. |
| **Centre: field** | Auto-zoom camera, with the offense always attacking left → right. Hover a player for his name; click him for details. Toggles: Names, Route chart, Who's open (green ≥ 3 yds, yellow 1.5–3, red < 1.5), Trails, Full field. After the throw, the rest of the play is reconstructed (labelled on screen) and the real result spot is marked with ✕. |
| **Controls** | Play/pause, previous/next play, jump to Snap or Throw, a timeline with clickable events, and 0.25×–2× speed (0.5× by default). |
| **Right: Play tab** | Game situation (who leads, time left, red zone), a **play story** timeline (line-up → motion / play action → snap → pressure → throw → catch → tackle, plus penalty flags; click a step to jump there), the plays before and after, then formation, personnel, coverage, dropback, rushers or blitz, time to throw, who pressured the QB, beaten blocks, and the selected player's card. |
| **Right: What-if tab** | 1) Pick any player (chips or click the field). 2) Offense: a route from the route tree (15 routes, short/normal/deep) or draw your own, then drag the gold points to fine-tune. Defense: as played / blitz / man on a receiver / zone drop (click the spot). Drag any player at the snap to change his alignment. 3) Defense call. 4) Quarterback: throw time slider and throw target (or "best open"). 5) Scenario: a list of every change (✕ removes one), Undo (also Ctrl+Z), Reset, and Save / load named scenarios (kept in your browser). A results card under the field shows the simulated outcome vs the real one, plus each receiver's separation. |
| **Compare view** | From the What-if tab, **⚖ Compare** opens the real play, the current what-if and every saved scenario for this snap side by side (up to 4 shown at once; toggle any on or off). One set of controls plays them all in sync. The table underneath compares result, yards, ball-out time, target and its separation (marked *auto* when the QB picked the most open man), most open receiver and number of changes. 🏆 marks the best result: most yards, a TD +10, a sack −5, an interception counts as −30. |
| **Right: Defense tab** | The team's man/zone split (overall and on this down), average rushers, blitz rate, box count and coverage-call distribution. |
| **📊 Scouting** (header button, or click a team on the scoreboard) | Pick **Team** (offense / defense) or **Player** (type a name), then the games: all, one, or any mix. **Team offense:** playstyle summary vs the league, completion %, yds/att, TD/INT, sack and pressure rate, time to throw, deep and play-action rates, 3rd-down conversion, how open the target was, a pass map (deep/short × left/middle/right), coverages faced and results against each, formations, personnel, by-down table, receivers (routes, targets, catches, yards, target share, average separation) and pass protection (pressures allowed). **Team defense:** the same from the other side, plus man/zone and blitz rates, rushers, pass-rusher table and coverage table (targets allowed as the nearest defender). **Player:** jobs on pass plays, where he lines up (in plain words), and passing, receiving, pass rush, protection or coverage numbers depending on what he does. Names link to player reports; the biggest plays open in the replay. |

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

The code is in `simulate()` in [`app/index.html`](app/index.html). It steps the whole play frame by frame at 10 Hz, so every player can react to every other player.

**1. Offense**
- An edited player runs his new route from his (possibly moved) spot at the snap. He accelerates at 5 yd/s² up to his real top speed, loses speed at each cut (up to 55% for a full reversal) and settles when the route ends.
- A moved player without a new route runs his real route, shifted to his new spot.
- Everyone else keeps his exact real tracking, then coasts once the tracking runs out (needed when the QB holds the ball longer than he really did).

**2. Defense:** each defender gets a job.

| Job | When | Behaviour |
|---|---|---|
| React | Coverage defender, same call as played | Real track, shifted by how far "his" receiver moved off the real route (man), or by whichever receiver is in his area (zone, fading out from 3 to 10 yds); 0.3 s reaction delay. Defenders nobody's change affects keep their real track. |
| Man | Forced man call, or the coach picks a receiver | Trails the receiver, closing the cushion he had at the snap over about 2 s |
| Zone | Forced zone call (landmark: 8 yds underneath, 14+ deep), or the coach clicks a spot | Drops to the spot and breaks on the closest receiver within 7 yds |
| Blitz | The coach sends him | Unblocked if rushers outnumber blockers (runs at the QB); otherwise picked up at the line |
| Rush | Real pass rushers | Real rush; after the tracking ends they keep squeezing the pocket |

"Their usual" picks man or zone, whichever this defense plays more often on this down (from `/api/team`). Each defender is limited by his own real top speed, 7 yd/s² acceleration and the reaction delay (`LAG`, `AMAX`, `DT` constants, shared movement step `kin()`).

**3. Pressure.** A blitzer within 1 yd of the QB before the throw is a sack. So is a real rusher, if the QB now holds the ball longer than he really did.

**4. Throw and outcome.** The ball goes to the coach's target, or to the most open receiver. It is led to where he will be (along his drawn route if he has one) at about 18 yd/s. Defenders near the spot break on the ball after 0.5 s. Then:
- the receiver is 1.5+ yds from the spot → incomplete (he can't get there)
- a defender beats him to the spot within 0.4 yd, and he was covered at the throw → interception
- he was 1.5+ yds open at the throw, or no defender is within 2 yds → catch
- otherwise → broken up

After a catch (or interception) the carrier runs upfield, away from the nearest chaser, until a defender gets within 1 yd, he steps out of bounds, or he scores.

**How good is it?** The outcome thresholds were fitted on ~400 real throws. On 4 games it was not tuned on (233 throws), it calls catch vs no catch right **72.5%** of the time (always guessing "catch" gets 69%). The yards on correctly predicted catches are within 3 yds of the real gain at the median (6 yds at the 75th percentile). It can't tell *which* passes were really intercepted. These are hand-tuned heuristics: use them to compare scenarios, not to predict exact results. Replacing them with a model trained on the tracking data is the top roadmap item.

## API reference

All endpoints are `GET` and return JSON.

| Endpoint | Returns |
|---|---|
| `/api/games` | All games (`gameId`, week, teams, date) |
| `/api/plays?game=<gameId>` | All plays of a game (the `plays.csv` rows) |
| `/api/play?game=<gameId>&play=<playId>` | `{ play, dir, nFrames, events: {frame: name}, ents: [...] }` |
| `/api/team?t=<abbr>` | Defensive tendencies: `{ all, byDown: {1..4} }`, each `{ n, man, zone, rush, blitz, box, cov: {call: count} }` |
| `/api/players` | Every player who appears in the PFF data: `{ id, name, pos, team }` |
| `/api/report?team=<abbr>&side=off\|def&games=<id,id>` | Team scouting report: `{ stats, league, leaders, top, games, selected }`. `games` is optional (default: all of the team's games) |
| `/api/report?player=<nflId>&games=<id,id>` | Player scouting report: `{ player, snaps, roles, aligned, me, grid, qb, league, top }` |

Each entity in `ents` looks like `{ id, jersey, team, name, pos, role, lined, hit, hurry, sack, beaten, blocked, f: [[x, y, speed, orientation, direction], …] }`, with one entry in `f` per frame. The ball has `id: "ball"`.

---

## Project structure

```
app/
  server.js        Node stdlib HTTP server: CSV parsing, team tendencies, tracking cache, JSON API
  report.js        Scouting engine: parses targets/results from the play-by-play, aggregates team, player and league stats, tracking summaries (time to throw, separation) per game; self-check: node app/report.js
  index.html       Whole front-end: layout/CSS, canvas renderer, playback, what-if UI and engine
nfl-big-data-bowl-regional-event-data-main/
  data/            Big Data Bowl CSVs (+ tracking/ per game)
  README.md        Official column-by-column data dictionary
```

Where to change things in `index.html`:
- Field drawing and overlays: `drawField()`, `draw()`
- Camera: `computeView()`
- Route tree: the `ROUTES` constant (each waypoint is `[downfield yds, outside yds]`)
- Simulation: `simulate()` (defender jobs, sack check, throw outcome thresholds) and its constants `LAG`, `DT`, `AMAX`; shared movement physics: `kin()`; drawn routes: `routeTrack()`
- What-if panel and scenario state (undo, save/load): `renderWhatIf()`, `change()`, `undo()`, `snapWi()`
- Compare view: `openCompare()`, `summary()` (scorecard and ranking), `renderCompare()`, `drawInto()` (draws one scenario into its mini field)
- Scouting view: `openScout()`, `renderScout()`, `playstyle()` (the summary sentences and their thresholds vs the league), `alignLabel()` (PFF alignment codes → words); the stats themselves live in `app/report.js`
- Post-throw reconstruction: `reconstruct()` (description parsing: `findPlayer()`, `spotX()`, the `NAME` regex)
- Play story timeline: `playStory()`
- Play filters: the `FILTERS` object

---

## Limitations

- **Pass plays only, 2021 weeks 1–8:** this is the scope of the Big Data Bowl dataset. There are no run plays and no special teams.
- **Tracking covers only about 0.7 s before the snap to 0.5 s after the throw or sack**, because the dataset was built to study pass rushing. The rest of each play (ball flight, catch or incompletion or interception, run after the catch, tackle) is reconstructed in `reconstruct()` from the play-by-play text: the target, tackler, interceptor and the official yardage and spots. The end result is real; the path to it is approximate, and it is labelled "reconstructed" on screen.
- **What-if outcomes are heuristic.** See "How good is it?" above. Linemen keep their real blocks; they don't re-target a new blitzer.
- **Heuristic defense:** the rules above are plausible, not validated. Pass rushers and blockers aren't re-simulated.
- **Scouting covers pass plays only** (the dataset has no runs), so "3rd-down conversion" and "yds/play" are on dropbacks. Targets and results come from the play-by-play text; "nearest defender" coverage numbers approximate who was responsible.
- **Single process and in-memory cache.** That's fine for a demo, but not multi-tenant.

## Roadmap

1. **Learned defense model:** train a model on every tracking frame to predict each defender's next movement, given the receivers and the coverage (SageMaker).
2. **Probabilistic outcomes:** catch probability and expected yards instead of one deterministic result, plus the chance of a sack.
3. **Smarter blocking:** linemen and backs pick up blitzers instead of keeping their real blocks.
4. **AI play breakdowns:** a plain-language explanation of any play or what-if (Amazon Bedrock).
5. **Shareable links and clips** for a play or a what-if scenario.
6. **More data:** full seasons, run plays, and teams' own tracking data.

---

*Data © NFL / Pro Football Focus, provided through the NFL Big Data Bowl for non-commercial competition use. A commercial product would need its own data licensing.*
