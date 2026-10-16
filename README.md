# Helicopter

A smooth, dependency-free browser helicopter game: **hold to climb, release to fall.**
Live at https://helicopter.superbyte.eu

## Play

- Mouse / touch: press and hold anywhere to climb, release to fall.
- Keyboard: hold Space, W or Arrow Up. `M` toggles sound.
- Fly as far as you can through the cave and dodge the rock blocks. The cave narrows and speeds up the further you go.
- Enter a nickname on the start screen; after each crash your score is submitted and the top 10 leaderboard is shown (best score per nickname).
- Open ⚙️ settings on the start or game-over screen to pick the Night (default) or Disco theme and toggle sound.
- Your nickname, personal best, theme and sound preference are stored locally in the browser.

## Local development

```bash
python3 -m http.server 8111 --directory public
```

Open `http://127.0.0.1:8111`. The game is static (`public/`): Canvas 2D rendering with a fixed 120 Hz physics step, synthesised Web Audio (no asset files). The leaderboard API (`server/app.py`, Python stdlib + SQLite, no dependencies) stores scores in `data/scores.db` (git-ignored):

```bash
HELI_PORT=8112 HELI_DB=/tmp/scores.db python3 server/app.py
```

Endpoints: `GET /api/leaderboard?limit=10`, `POST /api/score` `{nick, score, ms}`. Nicknames are 1-16 chars (letters, digits, space, `. _ -`); scores are checked against the elapsed play time and rate-limited, which deters casual cheating but is not tamper-proof.

## Deployment

The API runs as the `helicopter-api` systemd service (`deploy/helicopter-api.service`, bound to 127.0.0.1:8110) and Nginx proxies `/api/` to it with its own rate limit. Back up `data/scores.db` before risky changes. Static files are served by Nginx from `public/` using `deploy/helicopter.superbyte.eu.nginx.conf` (installed as `/etc/nginx/sites-enabled/helicopter-superbyte.conf`), with a Let's Encrypt certificate named `helicopter.superbyte.eu`, HTTP→HTTPS redirect, strict CSP and other security headers.

## Changelog

**2026-10-16 — Settings, Disco theme, smaller helicopter (HELI-4, HELI-5).** A new ⚙️ settings panel (on the start and game-over screens) lets you choose the theme and toggle sound; the choice is remembered. The original Night theme stays the default, and the new Disco theme adds colour-cycling skies, sweeping light beams, a mirror ball, sparkles and a rainbow neon cave edge. The helicopter is now half its previous size, with its collision box, smoke trail and rotor check scaled to match.

**2026-10-15 — No stale cache — Always show the latest version.** Static files used to be cached by browsers for an hour, so players could keep seeing the old yellow helicopter after an update. They are now revalidated on every load (cheap, ETag-based), so new versions appear immediately.

**2026-10-15 — Taller tunnel, red helicopter, leaderboard (HELI-1, HELI-2, HELI-3).** The cave is now noticeably taller (starts 500 units high and narrows to 310 instead of 250), so it is easier to fly. The helicopter is red, including smoke-free crash debris and the favicon. The start screen asks for a nickname, and after every crash the score is saved in a new SQLite-backed leaderboard service and the top 10 is shown with your own row highlighted.

**2026-10-15 — Initial release — Helicopter game.** First version of the game: hold-to-climb physics with smooth tilt and rotor animation, procedurally generated cave that narrows over time, rock obstacles, parallax night sky, smoke and crash particles, screen shake, synthesised rotor and crash sounds, mute toggle, local best score, and mouse, touch and keyboard controls. Deployed at helicopter.superbyte.eu.
