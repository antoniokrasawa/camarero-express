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

## App language
⚙ → «Язык приложения» (`S.settings.promptLang`: ru/en/es) switches **everything**: UI strings (`docs/i18n.js`, keyed by the Russian original; `node tools/check_i18n.js` fails on any untranslated key), deck/section titles (`title_en/_es`), prompts (`p_en/p_es`), notes, scene hints, and quiz explanations. The answer language is a separate ES/EN switch in the header.

## Automatic grading (Speak + Scenes) and costs
The browser's Web Speech API does TTS and speech-to-text for free, with the language set explicitly to es-ES or en-GB (no auto-detect). `evaluate()` in `app.js` then grades in three tiers:
1. **Exact match:** every reference word was said in order, with at most one extra word. Graded correct on the phone, free.
2. **Anything else:** `POST /camarero-api/check` → `server/checker.py` → **Claude Haiku 4.5**, about $0.0013 and ~1.3 s per check.
   - Verdicts are correct / minor / wrong, mapped to SRS good / hard / again. A natural alternative wording counts as correct, and the reference is shown as «Чаще говорят».
   - Identical answers are served from `/data/check_cache.json`, which is free.
   - There is a daily cap: `CHECK_DAILY_USD`, default $1.5. Spend is logged in `/data/spend.jsonl`. `curl https://77-42-69-208.sslip.io/camarero-api/health` shows the spend.
3. **Server unreachable, or the cap is hit:** the local word-match score is used, ≥80% → correct, ≥50% → minor.

Only the first attempt per card is graded; retries are for practice.

Model choice was measured with `server/eval_checker.py`, which runs 15 fixed cases and costs real money:
- Haiku scored 12/15 at 1.3 s; Sonnet 5.5 scored 11/15 at 2.3 s and $0.0034 per check. Sonnet's comments are more precise.
- To switch, set the `CHECK_MODEL` env on the container.

The API key is LA's: `/opt/ga/.env` is mounted read-only at `/run/la.env`, and only its `ANTHROPIC_API_KEY` line is read. The container image is `server/Dockerfile` (python + anthropic SDK); its code is bind-mounted from `/opt/camarero/app`. To redeploy, `scp` the files, then run `docker restart camarero-api`.
