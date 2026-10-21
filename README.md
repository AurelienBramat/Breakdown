# Hackathon-AWS-NFL

Football-manager style replay + what-if simulator for the NFL Big Data Bowl tracking data.

## Run

1. Data lives in `nfl-big-data-bowl-regional-event-data-main/data/` (override with `DATA_DIR`).
2. `node app/server.js` (no dependencies) and open http://localhost:3000

## Features

- Replay any pass play frame by frame: players, trails, line of scrimmage, first-down line, events, player stats (speed, separation, PFF role, pressures, blocks).
- Defensive tendencies per team (man/zone rate by down, rushers, blitz rate, coverage calls).
- What-if: redraw offensive routes, choose the defense (as played / team tendency / man / zone); defenders re-react with real top speed, accel limits and reaction delay. Reports separation at the throw vs the real play.
