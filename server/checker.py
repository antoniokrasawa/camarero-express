"""Grade a spoken answer that does not match the reference word for word.

The client only calls this when what speech recognition heard differs from the
reference phrase; an exact match is graded on the phone for free. A model
decides whether the answer is still right and natural (counts as correct, with
the reference shown as "more common"), slightly off, or wrong.

One check is ~650 input + ~120 output tokens. Guards:
- identical (refs, heard, langs) answers are served from a cache and cost nothing;
- a daily dollar cap (CHECK_DAILY_USD, default 1.5) — over it the endpoint
  returns 429 and the app falls back to its local word-match score.
Spend is logged per call in /data/spend.jsonl.
"""
import hashlib
import json
import os
import re
import threading
from datetime import date, datetime, timezone

import anthropic

MODEL = os.environ.get("CHECK_MODEL", "claude-haiku-4-5")
PRICES = {"claude-haiku-4-5": (1.00, 5.00), "claude-sonnet-5-5": (2.00, 10.00)}  # $ per 1M tokens in/out
DAILY_USD = float(os.environ.get("CHECK_DAILY_USD", "1.5"))
DATA = os.environ.get("DATA_DIR", "/data")
CACHE_FILE = os.path.join(DATA, "check_cache.json")
SPEND_FILE = os.path.join(DATA, "spend.jsonl")
KEY_FILE = os.environ.get("ANTHROPIC_KEY_FILE", "/run/la.env")
_lock = threading.Lock()
_client = None

UI_LANG = {"ru": "Russian", "en": "English", "es": "Spanish"}
TARGET = {"es": "Spanish as spoken in Spain", "en": "English"}

SYSTEM = """You grade one spoken answer of a learner who is preparing to work as a waiter or bartender in Valencia, Spain. The learner's native language is Russian.

You get: the situation (what the waiter has to do or say), the target language, one or more reference answers written by a teacher, and what speech recognition heard (one to three alternatives).

Speech recognition never writes question marks or exclamation marks: always assume the learner used the right intonation, so "queréis algo más" is the question "¿Queréis algo más?". Speech recognition is also imperfect: ignore punctuation, capital letters, missing accents, digits instead of words, and obvious mishearings of similar-sounding words. Pick the alternative that best matches what the learner most likely said.

Judge the answer as an experienced native waiter would, and be generous about wording. There are many right ways to say the same thing; the references are only examples.
- "correct": a native waiter could plausibly say this in this moment and the guest would get exactly what is meant. Synonyms, extra polite words, a question where the reference makes an offer (or the other way round), a different but natural word order or structure, near-equivalent terms: all correct. Example: reference "¿Os pongo algo de beber?", heard "qué queréis tomar" -> correct. Score 85-100.
- "minor": on task and understandable, but contains something a native would notice as a mistake: wrong gender or agreement, wrong verb form, a clearly non-native or bookish word, a calque from English, the wrong register for the situation, or an important part missing. Example: heard "qué queréis bebar" -> minor (wrong verb form). Score 50-84.
- "wrong": it does not do what the situation asks (says something else, speaks as the guest instead of the waiter), is in the wrong language, or is too broken to understand. Score 0-49.
For Spanish, colloquial tú/vosotros and polite usted are both acceptable unless the situation says otherwise. The situation may be written in Russian or another language; that says nothing about the answer language - only "Target language" does.
Never lower the verdict just because the wording differs from the reference, is longer or shorter, or the reference sounds a bit smoother. "minor" needs a concrete mistake you can name; if you cannot name one, the verdict is "correct". Put "the reference is more common" into "better" and "comment", not into the verdict.

Reply with only a JSON object, no other text:
{"verdict": "correct|minor|wrong", "score": <0-100>, "heard": "<the alternative you judged>", "same_as_ref": <true if it is essentially one of the references>, "better": "<the most common, natural way a native waiter would say it; use a reference when it fits>", "comment": "<at most 20 words in COMMENT_LANG: the concrete mistake, or why a different wording is still fine; empty string if same_as_ref>"}"""


def _api_key():
    """The key is the one LA uses; its env file is mounted read-only and only the
    ANTHROPIC_API_KEY line is read, so LA's other secrets never enter this process."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    with open(KEY_FILE, encoding="utf-8") as f:
        for line in f:
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("no ANTHROPIC_API_KEY")


def _client_get():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=_api_key(), max_retries=1, timeout=20.0)
    return _client


def _read_spend():
    try:
        with open(SPEND_FILE, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def _cache_load():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", str(s).lower())).strip()


def grade(situation, target, ui, refs, heard, model=None):
    """One model call, no cache and no budget check. Returns (verdict dict, usage)."""
    model = model or MODEL
    user = (f"Situation: {situation}\nTarget language: {TARGET[target]}\n"
            + "Reference answers:\n" + "\n".join(f"- {r}" for r in refs)
            + "\nSpeech recognition heard:\n" + "\n".join(f"- {h}" for h in heard)
            + f'\n\nWrite "comment" in {UI_LANG[ui]}, speaking to the learner as "you".')
    kw = {}
    if model.startswith("claude-sonnet"):
        kw["output_config"] = {"effort": "low"}  # a short judgement, not a reasoning task
    msg = _client_get().messages.create(
        model=model, max_tokens=400,
        system=SYSTEM.replace("COMMENT_LANG", UI_LANG[ui]),
        messages=[{"role": "user", "content": user}], **kw,
    )
    text = next((b.text for b in msg.content if b.type == "text"), "")
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError("model returned no JSON")
    try:  # a malformed model reply is a server-side failure (502), not the client's 400
        res = json.loads(m.group(0))
        res["score"] = max(0, min(100, int(res.get("score", 0))))
    except (ValueError, TypeError) as e:
        raise RuntimeError(f"bad model JSON: {e}") from e
    if res.get("verdict") not in ("correct", "minor", "wrong"):
        raise RuntimeError("bad verdict")
    pin, pout = PRICES.get(model, (5.0, 25.0))
    usd = (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6
    return res, {"model": model, "in": msg.usage.input_tokens, "out": msg.usage.output_tokens, "usd": usd}


def check(body):
    """body: {situation, target: es|en, ui: ru|en|es, refs: [..], heard: [..]} -> verdict dict."""
    refs = [str(r)[:300] for r in (body.get("refs") or []) if str(r).strip()][:4]
    heard = [str(h)[:300] for h in (body.get("heard") or []) if str(h).strip()][:3]
    target = body.get("target") if body.get("target") in TARGET else "es"
    ui = body.get("ui") if body.get("ui") in UI_LANG else "ru"
    situation = str(body.get("situation", ""))[:400]
    if not refs or not heard:
        raise ValueError("refs and heard are required")

    key = hashlib.sha1(json.dumps([MODEL, refs, [_norm(h) for h in heard], target, ui], ensure_ascii=False).encode()).hexdigest()
    today = date.today().isoformat()
    with _lock:
        cache = _cache_load()
        if key in cache:
            return dict(cache[key], cached=True)
        if sum(r.get("usd", 0) for r in _read_spend() if r.get("day") == today and r.get("kind") != "menu") >= DAILY_USD:
            raise OverflowError("daily budget reached")

    res, usage = grade(situation, target, ui, refs, heard)
    with _lock:
        with open(SPEND_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({"day": today, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "model": usage["model"], "in": usage["in"], "out": usage["out"],
                                "usd": round(usage["usd"], 6)}) + "\n")
        cache = _cache_load()
        cache[key] = res
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, CACHE_FILE)
    return dict(res, cached=False)


def spend_summary():
    all_rows, today = _read_spend(), date.today().isoformat()
    out = {}
    for kind, cap, model in (("check", DAILY_USD, MODEL), ("menu", float(os.environ.get("MENU_DAILY_USD", "3")), os.environ.get("MENU_MODEL", "claude-sonnet-5-5"))):
        rows = [r for r in all_rows if (r.get("kind") == "menu") == (kind == "menu")]
        out[kind] = {"calls": len(rows), "usd_total": round(sum(r.get("usd", 0) for r in rows), 4),
                     "usd_today": round(sum(r.get("usd", 0) for r in rows if r.get("day") == today), 4),
                     "daily_cap": cap, "model": model}
    return out
