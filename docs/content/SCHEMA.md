# Content schema

All files are UTF-8 JSON. The app loads them with `fetch`, so any edit shows up on reload.

## Card decks
These files are card decks: `servicio.json`, `vocab.json`, `platos.json`, `bebidas.json`, `vender.json`, `equipo.json`.

```json
{
  "id": "servicio",
  "title": "Сервис: от входа до счёта",
  "sections": [
    {
      "id": "bienvenida",
      "title": "Встреча гостя",
      "items": [
        {
          "id": "srv-bienvenida-01",
          "kind": "phrase",
          "ru": "Поздороваться и спросить, сколько человек",
          "es": "¡Buenas! ¿Cuántos sois?",
          "es_alt": "Buenas noches, ¿para cuántas personas?",
          "en": "Hi there, how many of you?",
          "note": "«sois» — неформально (компания, молодые); usted-вариант для пожилых/формального места"
        }
      ]
    }
  ]
}
```

Item fields:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique and stable. The progress record is keyed on it, so never rename an id. |
| `kind` | yes | `"phrase"` is a full utterance and also appears in the voice drill. `"word"` is a term or vocabulary item and appears in cards only. |
| `ru` | yes | Prompt in Russian: the meaning, or what the situation calls for. |
| `es` | yes | The main Spanish answer, in the colloquial Spain register. |
| `es_alt` | no | An alternative, usually the formal `usted` version or a synonym. |
| `en` | no | English version, used for tourists. Skip it for terms that have no use in English. |
| `note` | no | A short comment in Russian: a nuance, a pitfall, when to use it. |
| `p_en` / `p_es` | yes | The same prompt as `ru`, in English or Spanish. Settings ⚙ → "Язык подсказок" picks which one is shown. `p_es` must not give away the answer: describe the situation or define the word without naming it. |
| `note_en` / `note_es` | if `note` exists | Translations of `note`. |
| `extra` | no | A free-form object for details such as `{"glass":"copa balón","recipe":"..."}`. It is rendered as a small table. |

## Quiz: `quiz.json`

```json
{
  "rules": [ { "ru": "Вес к весу: лёгкое блюдо — лёгкое вино", "es": "Ligero con ligero, potente con potente" } ],
  "sets": [
    {
      "id": "maridaje",
      "title": "Что налить к блюду",
      "questions": [
        {
          "q": "Arroz a banda",
          "options": ["Albariño", "Ribera del Duero Crianza", "PX"],
          "answer": 0,
          "why": "..."
        }
      ]
    }
  ]
}
```

## Dialogues: `dialogos.json`

```json
{
  "scenes": [
    {
      "id": "pareja-cena",
      "title": "Пара на ужин",
      "lang": "es",
      "context": "RU: вечер, ресторан, пара без брони",
      "start": "n1",
      "nodes": {
        "n1": {
          "guest": "Hola, buenas noches. ¿Tenéis mesa para dos?",
          "hint": "Поздоровайся, предложи терраcу или зал",
          "you": ["¡Buenas noches! Sí, claro. ¿Preferís terraza o dentro?"],
          "next": [ { "label": "Terraza, por favor", "to": "n2" } ]
        },
        "fin": { "guest": "¡Muchas gracias, hasta luego!", "end": true }
      }
    }
  ]
}
```

- `guest` is the guest's line, read aloud by TTS. It is optional, because sometimes the waiter speaks first.
- `you` holds the reference answers. The first one is the main answer that the speech-recognition result is compared against.
- `next` holds the guest's possible reactions. Each `to` must name a node that exists.
- Scenes also have `title_en`/`title_es`/`context_en`/`context_es`, and nodes have `hint_en`/`hint_es`. Quiz sets have `title_*`, questions have `why_*` (and `q_*` where `q` contains Russian), and rules have `en`.
- A node with `end: true` (or one without `next`) ends the scene.
