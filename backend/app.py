"""
SPICA verdict-engine API — Flask dev server.

Same routes and same numbers as the deployed Netlify Function
(app/netlify/functions/api.mjs, JavaScript — Netlify Functions do not
support Python). This server imports the Python port in verdicts.py
(same file, same math as the app's src/lib/data.js); both are pinned
to the same known values by their test suites.

Run:
    python3 app.py            # http://127.0.0.1:5000
    SPICA_DATA_DIR=../data python3 app.py   # use the project data dir

The frontend (npm run dev) proxies /api to this server (see
vite.config.js), and VITE_API_BASE=http://127.0.0.1:5000 works too.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request  # noqa: E402

import verdicts  # noqa: E402

app = Flask(__name__)


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
        if atmosphere not in verdicts.ATMOSPHERE_KEYS:
            raise ValueError(f"unknown atmosphere {atmosphere!r} "
                             f"(want one of {', '.join(verdicts.ATMOSPHERE_KEYS)})")
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


@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/health")
def health():
    data = verdicts.get_data()
    return jsonify({"status": "ok", "service": "spica-verdict-engine",
                    "version": 1, **data.snapshot()})


@app.route("/api/materials")
def materials():
    data = verdicts.get_data()
    return jsonify({"materials": verdicts.list_materials(data),
                    "count": len(data.verdicts),
                    "snapshot": data.snapshot()})


@app.route("/api/verdict")
def verdict():
    data = verdicts.get_data()
    try:
        return jsonify(_verdict_from_params(data, request.args.to_dict()))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except LookupError as exc:
        return jsonify({"error": str(exc)}), 404


@app.route("/api/scatter")
def scatter():
    data = verdicts.get_data()
    material = request.args.get("material", "all")
    if material != "all" and material not in data.verdicts:
        return jsonify({"error": f"unknown material {material!r}"}), 404
    points = verdicts.get_scatter_points(data, material)
    return jsonify({"material": material, "count": len(points),
                    "counts": verdicts.scatter_counts(data),
                    "points": points,
                    "note": "997 points have both O2 and pressure; 11 PSI-10 "
                            "rows record pressure but no O2 and are counted, "
                            "not plotted."})


@app.route("/api/ranking")
def ranking():
    data = verdicts.get_data()
    atmosphere = request.args.get("atmosphere")
    if atmosphere:
        if atmosphere not in verdicts.ATMOSPHERE_KEYS:
            return jsonify({"error": f"unknown atmosphere {atmosphere!r}"}), 400
        return jsonify({"atmosphere": atmosphere,
                        **verdicts.get_ranking(data, atmosphere)})
    try:
        o2 = float(request.args["o2"])
        pressure = float(request.args["pressure"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "give ?atmosphere=ISS|Orion|Exploration "
                                 "or ?o2=&pressure="}), 400
    return jsonify({"o2": o2, "pressure": pressure, "custom": True,
                    **verdicts.get_ranking_live(data, o2, pressure)})


@app.route("/api/evidence")
def evidence():
    data = verdicts.get_data()
    material = request.args.get("material")
    if not material:
        return jsonify({"error": "param material is required"}), 400
    if material not in data.verdicts:
        return jsonify({"error": f"unknown material {material!r}"}), 404
    atmosphere = request.args.get("atmosphere")
    if atmosphere:
        if atmosphere not in verdicts.ATMOSPHERE_KEYS:
            return jsonify({"error": f"unknown atmosphere {atmosphere!r}"}), 400
        return jsonify(verdicts.evidence_pack(data, material, atmosphere))
    try:
        o2 = float(request.args["o2"])
        pressure = float(request.args["pressure"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "give ?atmosphere=ISS|Orion|Exploration "
                                 "or ?o2=&pressure="}), 400
    return jsonify(verdicts.evidence_pack(data, material, None, o2, pressure))


@app.route("/api/brief")
def brief():
    data = verdicts.get_data()
    atmosphere = request.args.get("atmosphere")
    if not atmosphere:
        return jsonify({"error": "param atmosphere is required"}), 400
    if atmosphere not in verdicts.ATMOSPHERE_KEYS:
        return jsonify({"error": f"unknown atmosphere {atmosphere!r}"}), 400
    return jsonify(verdicts.mission_brief(data, atmosphere))


@app.route("/api/coverage")
def coverage():
    data = verdicts.get_data()
    material = request.args.get("material")
    if not material:
        return jsonify({"error": "param material is required"}), 400
    if material not in data.verdicts:
        return jsonify({"error": f"unknown material {material!r}"}), 404
    atmosphere = request.args.get("atmosphere")
    if atmosphere:
        if atmosphere not in verdicts.ATMOSPHERE_KEYS:
            return jsonify({"error": f"unknown atmosphere {atmosphere!r}"}), 400
        return jsonify(verdicts.get_coverage(data, material, atmosphere_key=atmosphere))
    try:
        o2 = float(request.args["o2"])
        pressure = float(request.args["pressure"])
    except (KeyError, TypeError, ValueError):
        if "o2" in request.args or "pressure" in request.args:
            return jsonify({"error": "give ?atmosphere=ISS|Orion|Exploration "
                                     "or ?o2=&pressure="}), 400
        return jsonify(verdicts.get_coverage(data, material))
    return jsonify(verdicts.get_coverage(data, material, o2_pct=o2, pressure_psi=pressure))


@app.route("/api/plan")
def plan():
    data = verdicts.get_data()
    raw = request.args.get("materials")
    if not raw:
        return jsonify({"error": "param materials is required (comma-separated list)"}), 400
    materials = [s.strip() for s in raw.split(",") if s.strip()]
    if not materials:
        return jsonify({"error": "param materials is required (comma-separated list)"}), 400
    for m in materials:
        if m not in data.verdicts:
            return jsonify({"error": f"unknown material {m!r}"}), 404
    atmosphere = request.args.get("atmosphere")
    if atmosphere:
        if atmosphere not in verdicts.ATMOSPHERE_KEYS:
            return jsonify({"error": f"unknown atmosphere {atmosphere!r}"}), 400
        return jsonify(verdicts.mission_plan(data, materials, atmosphere_key=atmosphere))
    try:
        o2 = float(request.args["o2"])
        pressure = float(request.args["pressure"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "give ?atmosphere=ISS|Orion|Exploration "
                                 "or ?o2=&pressure="}), 400
    return jsonify(verdicts.mission_plan(data, materials, o2_pct=o2, pressure_psi=pressure))


@app.route("/api/freshness")
def freshness():
    data = verdicts.get_data()
    return jsonify({"psi": verdicts.check_psi_live(),
                    "snapshot": data.snapshot(),
                    "note": "Verdicts use the cleaned snapshot when PSI is "
                            "unreachable from this host; nothing is re-fetched "
                            "or faked."})


@app.route("/")
def index():
    data = verdicts.get_data()
    return jsonify({"service": "spica-verdict-engine", "version": 1,
                    "endpoints": ["GET /api/health", "GET /api/materials",
                                  "GET /api/verdict", "GET /api/scatter",
                                  "GET /api/ranking", "GET /api/evidence",
                                  "GET /api/brief", "GET /api/freshness"],
                    "snapshot": data.snapshot(),
                    "disclaimer": verdicts.DISCLAIMER})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))
