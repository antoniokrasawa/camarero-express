# Camarero Express

A phone trainer for a waiter or bartender job in Spain (Valencia). It trains Spanish and English.

**Live:** https://antoniokrasawa.github.io/camarero-express/

| Mode | What you do |
|---|---|
| Plan | A 4-day programme. Each task opens the right mode with its filter already set. |
| Карточки | Spaced-repetition cards: RU → ES/EN or ES → RU, with a searchable list. |
| Вслух | You see a situation and answer out loud. Speech recognition compares your answer to a reference. |
| Сцены | Branching guest dialogues. Includes an "unpredictable guest" mode. |
| Квиз | Questions on wine pairing, cocktails, coffee and beer, and allergens. |

The content lives in `docs/content/*.json` and follows `docs/content/SCHEMA.md`. Run `python tools/validate.py` to check it.
Progress is saved to `localStorage` in the browser.

To run it locally: `cd docs && python -m http.server 8765`
