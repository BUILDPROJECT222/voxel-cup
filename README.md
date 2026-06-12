# ⚽ Voxel Cup

Online blocky football game that runs in the browser. Two game modes, bots that fill empty slots, quests that pay out coins, and a persistent leaderboard — all driven by an authoritative Node.js server.

## Modes

- **5v5 Match** — isometric voxel football. Move (`WASD`), sprint (`Shift`), shoot with charged power (`Space`), **slide tackle** (`E`) to steal the ball, and **skill move** (`Q`) to dodge tackles. 3-minute matches, bots fill the empty slots.
- **Head Soccer 1v1** — side-view "sports heads" duel. Move (`A/D`), jump over your opponent (`W`), and head/kick (`Space`) the bouncing ball. First to 5 goals (or most goals in 90s). Grab floating **power-ups**: ⚡ Speed, 🦘 Jump, 🗣️ Big Head, ❄️ Freeze, ⚽ Big Ball.

## Features

- Authoritative server simulation (anti-cheat) with client-side prediction + interpolation for smooth play.
- 6 selectable character skins with a live 3D preview in the lobby.
- Quests & coins, plus a persistent leaderboard keyed by player name.
- Bots so a match always starts, even solo.

## Tech

- **Server:** Node.js, Express (static hosting), `ws` (WebSocket game protocol).
- **Client:** Three.js (5v5 isometric scene + lobby preview) and Canvas 2D (Head Soccer).

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

## Controls

| Action | 5v5 | Head Soccer |
| --- | --- | --- |
| Move | `WASD` | `A` / `D` |
| Jump | — | `W` |
| Sprint | `Shift` | — |
| Shoot / kick | `Space` (hold = power) | `Space` |
| Slide tackle | `E` | — |
| Skill move | `Q` | — |

## Notes

- The leaderboard is stored in `server/leaderboard.json`. On ephemeral hosts (e.g. a plain Railway service without a volume) it resets on each redeploy — attach a persistent volume mounted at `server/` if you want it to survive deploys.
