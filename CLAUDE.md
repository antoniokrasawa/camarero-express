# Camarero Express

Antonio uses this phone trainer to prepare for a 1–2 month waiter/bartender job in Valencia. It is static: `docs/` is served by GitHub Pages at https://antoniokrasawa.github.io/camarero-express/, which redeploys about a minute after each push.

- Content lives in `docs/content/*.json` and follows `docs/content/SCHEMA.md`. Run `python tools/validate.py` after every edit.
- Spanish is the colloquial register of Spain: tú/vosotros in the main field, usted in `es_alt`. Verify facts before writing them, and never invent one.
- Progress is stored in the phone's `localStorage`. Never rename an item `id`, because progress is keyed on it.

## ✋ Reports ("разбери жалобы")
The ✋ button on every screen posts a note together with its context (card/scene/quiz, what speech recognition heard) to `https://77-42-69-208.sslip.io/camarero-api/report`.

| Part | Where |
|---|---|
| Server code | `server/report_server.py`, copied by hand to `/opt/camarero/app/` on hetzner (`scp`, then `docker restart camarero-api`) |
| Service | `camarero-api` in `/opt/bots/docker-compose.yml` |
| Route | `handle_path /camarero-api/*` in the sslip.io block of `serp-platform/Caddyfile` |
| Data | `/opt/camarero/data/reports.jsonl` + `handled.jsonl` |

Workflow:
1. `python tools/reports.py` shows the open reports.
2. Fix the content, then validate, commit and push.
3. `python tools/reports.py --done <id> ... --note "<what changed>"` marks them handled.

If the phone was offline, reports wait in its `localStorage` outbox and are sent on the next app start.

## Costs
Nothing is paid. Voice is the browser's built-in Web Speech API (speechSynthesis + SpeechRecognition), and no Claude or other API is called.
