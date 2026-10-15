# Helicopter

A smooth, dependency-free browser helicopter game: **hold to climb, release to fall.**
Live at https://helicopter.superbyte.eu

## Play

- Mouse / touch: press and hold anywhere to climb, release to fall.
- Keyboard: hold Space, W or Arrow Up. `M` toggles sound.
- Fly as far as you can through the cave and dodge the rock blocks. The cave narrows and speeds up the further you go.
- Your best distance and sound preference are stored locally in the browser.

## Local development

```bash
python3 -m http.server 8111 --directory public
```

Open `http://127.0.0.1:8111`. Everything is static (`public/`): Canvas 2D rendering with a fixed 120 Hz physics step, synthesised Web Audio (no asset files).

## Deployment

Static files are served by Nginx from `public/` using `deploy/helicopter.superbyte.eu.nginx.conf` (installed as `/etc/nginx/sites-enabled/helicopter-superbyte.conf`), with a Let's Encrypt certificate named `helicopter.superbyte.eu`, HTTP→HTTPS redirect, strict CSP and other security headers.

## Changelog

**2026-10-15 — Initial release — Helicopter game.** First version of the game: hold-to-climb physics with smooth tilt and rotor animation, procedurally generated cave that narrows over time, rock obstacles, parallax night sky, smoke and crash particles, screen shake, synthesised rotor and crash sounds, mute toggle, local best score, and mouse, touch and keyboard controls. Deployed at helicopter.superbyte.eu.
