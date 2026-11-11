"""
Netlify Function entry point for the SPICA verdict engine.

Served at /.netlify/functions/api/* and rewritten to /api/* (see
netlify.toml). Pure stdlib + verdicts.py — no Flask in the function,
so there is nothing to install. The bundled data/ folder beside this
file is the same cleaned PSI data the frontend ships.

Route handling is prefix-tolerant: the function accepts both the
rewritten path (/api/verdict) and the direct path
(/.netlify/functions/api/verdict), since Netlify's rewrite behaviour
for event.path is not something to bet the demo on.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import verdicts  # noqa: E402

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}

ATMOSPHERES = verdicts.ATMOSPHERE_KEYS


def _resp(status, payload):
    return {"statusCode": status, "headers": CORS,
            "body": json.dumps(payload)}


def _err(status, message):
    return _resp(status, {"error": message})


def _route(path):
    p = (path or "/").split("?")[0]
    for prefix in ("/.netlify/functions/api", "/api"):
        if p == prefix:
            return "/"
        if p.startswith(prefix + "/"):
            return p[len(prefix):]
    return p


def _float_param(params, name):
    raw = params.get(name)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"param {name} must be a number, got {raw!r}")


def _verdict_from_params(data, params):
    """Preset (?atmosphere=) or live (?o2=&pressure=) verdict.
    flow is accepted and echoed — it changes flame shape only, never
    the verdict (PSI verdicts are O2 x pressure)."""
    material = params.get("material")
    if not material:
        raise ValueError("param material is required")
    flow = _float_param(params, "flow")
    atmosphere = params.get("atmosphere")
    if atmosphere:
        if atmosphere not in ATMOSPHERES:
            raise ValueError(f"unknown atmosphere {atmosphere!r} "
                             f"(want one of {', '.join(ATMOSPHERES)})")
        verdict = verdicts.get_verdict(data, material, atmosphere)
    else:
        o2 = _float_param(params, "o2")
        pressure = _float_param(params, "pressure")
        if o2 is None or pressure is None:
            raise ValueError("give ?atmosphere=ISS|Orion|Exploration "
                             "or ?o2=&pressure=")
        verdict = verdicts.get_live_verdict(data, material, o2, pressure)
    if verdict.get("kind") == "NO_DATA" and material not in data.verdicts:
        raise LookupError(f"unknown material {material!r}")
    verdict = dict(verdict)
    verdict["line"] = verdicts.verdict_line(verdict)
    if flow is not None:
        verdict["flow_cm_s"] = flow
        verdict["flow_note"] = ("Flow changes flame shape only; "
                                "PSI verdicts are O2 x pressure.")
    return verdict


def handler(event, context):
    try:
        method = (event.get("httpMethod") or "GET").upper()
        if method == "OPTIONS":
            return {"statusCode": 204, "headers": CORS, "body": ""}
        if method != "GET":
            return _err(405, "only GET is supported")
        route = _route(event.get("path") or "/")
        params = event.get("queryStringParameters") or {}
        data = verdicts.get_data()

        if route in ("/", ""):
            return _resp(200, {
                "service": "spica-verdict-engine",
                "version": 1,
                "endpoints": [
                    "GET /api/health", "GET /api/materials",
                    "GET /api/verdict?material=&atmosphere=  (or ?o2=&pressure=&flow=)",
                    "GET /api/scatter?material=all|<material>",
                    "GET /api/ranking?atmosphere=  (or ?o2=&pressure=)",
                    "GET /api/evidence?material=&atmosphere=  (or ?o2=&pressure=)",
                    "GET /api/brief?atmosphere=",
                    "GET /api/freshness",
                ],
                "snapshot": data.snapshot(),
                "disclaimer": verdicts.DISCLAIMER,
            })

        if route == "/health":
            return _resp(200, {"status": "ok", "service": "spica-verdict-engine",
                               "version": 1, **data.snapshot()})

        if route == "/materials":
            return _resp(200, {"materials": verdicts.list_materials(data),
                               "count": len(data.verdicts),
                               "snapshot": data.snapshot()})

        if route == "/verdict":
            try:
                return _resp(200, _verdict_from_params(data, params))
            except ValueError as exc:
                return _err(400, str(exc))
            except LookupError as exc:
                return _err(404, str(exc))

        if route == "/scatter":
            material = params.get("material", "all")
            if material != "all" and material not in data.verdicts:
                return _err(404, f"unknown material {material!r}")
            points = verdicts.get_scatter_points(data, material)
            return _resp(200, {"material": material, "count": len(points),
                               "counts": verdicts.scatter_counts(data),
                               "points": points,
                               "note": "997 points have both O2 and "
                                       "pressure; 11 PSI-10 rows record "
                                       "pressure but no O2 and are counted, "
                                       "not plotted."})

        if route == "/ranking":
            atmosphere = params.get("atmosphere")
            if atmosphere:
                if atmosphere not in ATMOSPHERES:
                    return _err(400, f"unknown atmosphere {atmosphere!r}")
                return _resp(200, {"atmosphere": atmosphere,
                                   **verdicts.get_ranking(data, atmosphere)})
            o2 = _float_param(params, "o2")
            pressure = _float_param(params, "pressure")
            if o2 is None or pressure is None:
                return _err(400, "give ?atmosphere=ISS|Orion|Exploration "
                                 "or ?o2=&pressure=")
            return _resp(200, {"o2": o2, "pressure": pressure, "custom": True,
                               **verdicts.get_ranking_live(data, o2, pressure)})

        if route == "/evidence":
            material = params.get("material")
            if not material:
                return _err(400, "param material is required")
            if material not in data.verdicts:
                return _err(404, f"unknown material {material!r}")
            atmosphere = params.get("atmosphere")
            if atmosphere:
                if atmosphere not in ATMOSPHERES:
                    return _err(400, f"unknown atmosphere {atmosphere!r}")
                return _resp(200, verdicts.evidence_pack(data, material, atmosphere))
            o2 = _float_param(params, "o2")
            pressure = _float_param(params, "pressure")
            if o2 is None or pressure is None:
                return _err(400, "give ?atmosphere=ISS|Orion|Exploration "
                                 "or ?o2=&pressure=")
            return _resp(200, verdicts.evidence_pack(data, material, None, o2, pressure))

        if route == "/brief":
            atmosphere = params.get("atmosphere")
            if not atmosphere:
                return _err(400, "param atmosphere is required")
            if atmosphere not in ATMOSPHERES:
                return _err(400, f"unknown atmosphere {atmosphere!r}")
            return _resp(200, verdicts.mission_brief(data, atmosphere))

        if route == "/freshness":
            live = verdicts.check_psi_live()
            return _resp(200, {
                "psi": live,
                "snapshot": data.snapshot(),
                "note": ("Verdicts use the cleaned snapshot when PSI is "
                         "unreachable from this host; nothing is re-fetched "
                         "or faked.")})

        return _err(404, f"unknown route {route!r}")
    except Exception as exc:  # never leak a bare 500 without a message
        return _err(500, f"{type(exc).__name__}: {exc}")
