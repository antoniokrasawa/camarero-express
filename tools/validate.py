"""Validate content JSON: decks, quiz, dialogue graphs. Run: python tools/validate.py"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = next(p for p in (ROOT / "docs" / "content", ROOT / "app" / "content") if p.exists())
DECKS = ["servicio", "vocab", "platos", "bebidas", "vender", "equipo"]
errors, ids = [], Counter()


def err(msg):
    errors.append(msg)


def load(name):
    p = CONTENT / f"{name}.json"
    if not p.exists():
        err(f"missing {p.name}")
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        err(f"{p.name}: bad JSON: {e}")
        return None


summary = []
for d in DECKS:
    deck = load(d)
    if not deck:
        continue
    n = 0
    for sec in deck.get("sections", []):
        for it in sec.get("items", []):
            n += 1
            ids[it.get("id")] += 1
            for f in ("id", "kind", "ru", "es"):
                if not it.get(f):
                    err(f"{d}/{sec.get('id')}: item {it.get('id')} lacks {f}")
            if it.get("kind") not in ("phrase", "word"):
                err(f"{d}: {it.get('id')} kind={it.get('kind')!r}")
            for f in ("p_en", "p_es"):
                if not it.get(f):
                    err(f"{d}: {it.get('id')} lacks {f} (prompt in EN/ES)")
            if it.get("note") and not (it.get("note_en") and it.get("note_es")):
                err(f"{d}: {it.get('id')} has note but lacks note_en/note_es")
            if "extra" in it and not isinstance(it["extra"], dict):
                err(f"{d}: {it.get('id')} extra must be an object")
    summary.append(f"{d}: {n} items, {len(deck.get('sections', []))} sections")
for i, c in ids.items():
    if c > 1:
        err(f"duplicate id {i} x{c}")

quiz = load("quiz")
if quiz:
    for s in quiz.get("sets", []):
        pos = Counter()
        for q in s.get("questions", []):
            opts = q.get("options", [])
            if not (0 <= q.get("answer", -1) < len(opts)):
                err(f"quiz/{s['id']}: answer out of range: {q.get('q')}")
            if len(set(opts)) != len(opts):
                err(f"quiz/{s['id']}: duplicate options: {q.get('q')}")
            pos[q.get("answer")] += 1
        summary.append(f"quiz/{s['id']}: {len(s.get('questions', []))} q, answer positions {dict(pos)}")

dlg = load("dialogos")
if dlg:
    for sc in dlg.get("scenes", []):
        nodes, sid = sc.get("nodes", {}), sc.get("id")
        if sc.get("start") not in nodes:
            err(f"scene {sid}: start missing")
            continue
        for nid, n in nodes.items():
            for x in n.get("next", []) or []:
                if x.get("to") not in nodes:
                    err(f"scene {sid}: {nid} -> {x.get('to')} missing")
            if not n.get("end") and not n.get("next"):
                err(f"scene {sid}: {nid} has no next and no end")
            if not n.get("guest") and not n.get("you") and not n.get("end"):
                err(f"scene {sid}: {nid} is empty")
        seen, stack = set(), [sc["start"]]
        while stack:
            k = stack.pop()
            if k in seen or k not in nodes:
                continue
            seen.add(k)
            stack += [x["to"] for x in nodes[k].get("next", []) or []]
        unreach = set(nodes) - seen
        if unreach:
            err(f"scene {sid}: unreachable {sorted(unreach)}")
        ends = [k for k in seen if nodes[k].get("end") or not nodes[k].get("next")]
        if len(ends) < 2:
            err(f"scene {sid}: only {len(ends)} reachable endings")
        summary.append(f"scene {sid}: {len(nodes)} nodes, {len(ends)} endings")

print("\n".join(summary))
if errors:
    print(f"\n{len(errors)} ERRORS:")
    print("\n".join(errors))
    sys.exit(1)
print("\nOK")
