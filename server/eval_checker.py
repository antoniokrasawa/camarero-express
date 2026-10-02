"""Compare grading models on fixed cases with known verdicts.

    docker exec camarero-api python /app/eval_checker.py [model ...]

Costs real money (~$0.001-0.003 per case per model), bypasses the cache.
"""
import sys
import time

import checker

S = "Поздороваться и спросить, сколько их"
CASES = [
    # (situation, target, refs, heard, expected)
    (S, "es", ["¡Buenas! ¿Cuántos sois?", "Buenas noches, ¿para cuántas personas?"], ["buenas cuántas personas sois"], "correct"),
    (S, "es", ["¡Buenas! ¿Cuántos sois?"], ["hola buenas noches mesa para cuántos"], "correct"),
    ("Предложить принести счёт", "es", ["¿Os traigo la cuenta?"], ["queréis la cuenta"], "correct"),
    ("Предложить принести счёт", "es", ["¿Os traigo la cuenta?"], ["yo quiero la cuenta por favor"], "wrong"),
    ("Спросить про воду: бутылка или кран", "en", ["Bottled water or tap water?"], ["would you like still or tap water"], "correct"),
    ("Спросить, готовы ли заказать", "es", ["¿Ya sabéis qué vais a pedir?"], ["estáis listos para ordenar"], "minor"),
    ("Спросить, готовы ли заказать", "es", ["¿Ya sabéis qué vais a pedir?"], ["ya sabéis lo que vais a tomar"], "correct"),
    ("Спросить, как прожарить мясо", "es", ["¿Cómo la queréis: poco hecha, al punto o muy hecha?"], ["cómo lo queréis el carne"], "minor"),
    ("Извиниться за ожидание", "es", ["Perdonad la espera, ahora mismo os lo traigo."], ["perdón por la espera ya mismo sale"], "correct"),
    ("Извиниться за ожидание", "es", ["Perdonad la espera, ahora mismo os lo traigo."], ["la cuenta por favor"], "wrong"),
    ("Предложить десерт", "es", ["¿Os apetece algún postre?"], ["queréis algún postre o café"], "correct"),
    ("Предложить десерт", "es", ["¿Os apetece algún postre?"], ["you want some dessert"], "wrong"),
    # cases where Haiku claimed a greeting was missing although it was said
    ('The guest said: "Hola, buenas noches. ¿Tenéis mesa para dos? No hemos reservado." The waiter should: Greet them, offer terrace or inside',
     "es", ["¡Buenas noches! Sí, claro. ¿Preferís terraza o dentro?"], ["buenas noches sí claro terraza o dentro"], "correct"),
    (S, "es", ["¡Buenas! ¿Cuántos sois?", "Buenas noches, ¿para cuántas personas?"], ["hola buenas mesa para dos"], "minor"),
    (S, "es", ["¡Buenas! ¿Cuántos sois?", "Buenas noches, ¿para cuántas personas?"], ["hola cuántas personas"], "correct"),
]

models = sys.argv[1:] or ["claude-haiku-4-5", "claude-sonnet-5-5"]
for model in models:
    ok, usd, t_all = 0, 0.0, 0.0
    print(f"\n=== {model}")
    for sit, tgt, refs, heard, exp in CASES:
        t0 = time.time()
        res, u = checker.grade(sit, tgt, "ru", refs, heard, model=model)
        dt = time.time() - t0
        t_all += dt; usd += u["usd"]; ok += res["verdict"] == exp
        mark = "OK " if res["verdict"] == exp else "XX "
        print(f"{mark}{dt:4.1f}s {res['verdict']:7} (want {exp:7}) {res['score']:3} | {heard[0]} | {res.get('comment','')}")
    print(f"--> {ok}/{len(CASES)} right, avg {t_all/len(CASES):.1f}s, ${usd:.4f} total, ${usd/len(CASES):.4f}/check")
