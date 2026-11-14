"""
Verdict engine for "The 34% Question" — SPICA / Flame in Freefall.

Pure-Python port of app/src/lib/data.js (the client-side verdict math).
Every number comes from the NASA PSI cleaned tables bundled beside this
file (data/cleaned.json + data/coverage-verdicts.json) — nothing is
invented, no DOI or test is fabricated.

HONESTY RULES (hard, same as the frontend):
- Verdicts are COVERAGE (tested vs gap), never safety certifications.
- A row with o2_approx=true is never counted as a value (the flag is
  carried on the row so callers can see it).
- Design-range test-matrix summaries are planned matrices, not tests,
  and are never cited as a test (nearest-row search excludes them).
- Flow changes flame shape only; PSI verdicts are O2 x pressure.
- Interpolation is NOT in this module (not approved) — every verdict
  cites the nearest REAL test row.

Single source of truth for the LOCAL stack: app/src/lib/data.js is the
deployed source of truth (the app and the Netlify Function both import
it — Netlify Functions do not support Python, so the deployed function
is JavaScript). This module is a line-for-line Python port of that
file, used ONLY by the Flask dev server (backend/app.py) and its
tests. Both implementations are pinned to the same known values by
their test suites (backend/tests/test_verdicts.py, 22 tests) — if they
ever disagree, the tests fail, never the demo.
"""

import json
import math
import os
import urllib.request

# ---------------------------------------------------------------- data

ATMOSPHERES = {
    "ISS": {"key": "ISS", "name": "ISS", "o2": 21.0, "o2Max": None, "pressure": 14.7,
            "blurb": "International Space Station cabin air"},
    "Orion": {"key": "Orion", "name": "Orion", "o2": 26.5, "o2Max": 30.0, "pressure": 10.2,
              "blurb": "Orion crew capsule (max 30% O2)"},
    "Exploration": {"key": "Exploration", "name": "Exploration", "o2": 34.0, "o2Max": 36.0,
                    "pressure": 8.2, "blurb": "Lunar-base habitat (34% O2 @ 8.2 psi, HLS 34±2%)"},
}
ATMOSPHERE_KEYS = ["ISS", "Orion", "Exploration"]

HEADLINE_MATERIALS = [
    {"key": "SIBAL fabric", "label": "SIBAL fabric", "className": "solid"},
    {"key": "Nomex", "label": "Nomex", "className": "solid"},
    {"key": "PMMA", "label": "PMMA", "className": "solid"},
    {"key": "Methanol", "label": "Methanol droplet", "className": "droplet"},
    {"key": "Heptane", "label": "Heptane droplet", "className": "droplet"},
]

# NASA technical reports behind the two headline investigations.
# Cited by other Flame in Freefall teams; the DOIs in the data are the
# primary citations, these reports are further reading.
CITATIONS = [
    {"ref": "NASA PSI — Physical Sciences Informatics (psi.nasa.gov)",
     "note": "Public NASA data system; the 2,012 cleaned rows come from its "
             "Combustion Science investigations (BASS, BASS-II, FLEX, FLEX-2, "
             "SAFFIRE-I/II, CFI). No login required.",
     "url": "https://psi.nasa.gov/"},
    {"ref": "BASS-II — NASA-TM-202110011385",
     "note": "Burning and Suppression of Solids - II (PSI-25): SIBAL, Nomex "
             "and PMMA microgravity flame tests.",
     "url": "https://ntrs.nasa.gov/citations/20210011385"},
    {"ref": "FLEX — NASA/TP-2015-216046, Table IX",
     "note": "Flame Extinguishment Experiment (PSI-69): methanol and heptane "
             "droplet tests, including extinction outcomes.",
     "url": "https://ntrs.nasa.gov/citations/20150019316"},
]

DISCLAIMER = ("Coverage, not certification: TESTED means the condition was "
              "actually run in microgravity; GAP means no test ever ran "
              "there. Nothing here certifies a material as safe to fly.")


def _default_data_dir():
    """Find the bundled PSI data. Candidates in order: a data/ folder
    beside this file, the app's copy (../src/data from the repo copy),
    the project data/ dir (../data), the app's copy from the project
    root (../app/src/data), then a data/ folder in any ancestor
    directory. All carry the same cleaned tables. This file lives in
    two places — backend/ at the project root (dev) and app/backend/
    (committed in the repo) — so the lookup must work from both."""
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [os.path.join(here, "data"),
             os.path.join(here, "..", "src", "data"),
             os.path.join(here, "..", "data"),
             os.path.join(here, "..", "app", "src", "data")]
    parent = os.path.dirname(here)
    while True:
        cands.append(os.path.join(parent, "data"))
        nxt = os.path.dirname(parent)
        if nxt == parent:
            break
        parent = nxt
    for cand in cands:
        if os.path.isfile(os.path.join(cand, "cleaned.json")) and \
                os.path.isfile(os.path.join(cand, "coverage-verdicts.json")):
            return cand
    raise FileNotFoundError(
        "cleaned.json / coverage-verdicts.json not found beside verdicts.py "
        "or in ../src/data, ../data, ../app/src/data, or any ancestor data/ "
        "(or set SPICA_DATA_DIR)")


class Data:
    """The two bundled JSON files, loaded once."""

    def __init__(self, data_dir=None):
        data_dir = data_dir or os.environ.get("SPICA_DATA_DIR") or _default_data_dir()
        with open(os.path.join(data_dir, "cleaned.json"), encoding="utf-8") as f:
            self.cleaned = json.load(f)
        with open(os.path.join(data_dir, "coverage-verdicts.json"), encoding="utf-8") as f:
            self.verdicts = json.load(f)
        self.rows = self.cleaned["rows"]
        self.meta = self.cleaned.get("meta", {})

    def snapshot(self):
        return {
            "cleaned_at": self.meta.get("cleaned_at"),
            "rows": len(self.rows),
            "investigations": len({r["accession"] for r in self.rows}),
            "tables": len(self.cleaned.get("tables", [])),
            "source": "NASA PSI (Physical Sciences Informatics), public data",
        }


_DATA = None


def get_data(data_dir=None):
    """Cached Data instance (one load per process — the function runtime
    and the Flask dev server both reuse it)."""
    global _DATA
    if _DATA is None or data_dir is not None:
        _DATA = Data(data_dir)
    return _DATA


# ---------------------------------------------------------------- helpers

def mid(min_v, max_v):
    """Mean of a min/max pair (PSI rows store a single value as min == max)."""
    if min_v is None and max_v is None:
        return None
    if min_v is None:
        return max_v
    if max_v is None:
        return min_v
    return (min_v + max_v) / 2


def r2(n):
    """Round to 2 decimals, JS Math.round style (half away from zero).
    Python's round() is banker's rounding and would disagree with the
    frontend on .005 boundaries — same function, same numbers."""
    if n is None:
        return None
    return math.floor(n * 100 + 0.5) / 100 if n >= 0 else math.ceil(n * 100 - 0.5) / 100


def fmt(n, digits=2):
    """JS fmt(): Number(n.toFixed(digits)) as a string; None -> em dash."""
    if n is None:
        return "\u2014"
    s = f"{n:.{digits}f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def label_for(material):
    for m in HEADLINE_MATERIALS:
        if m["key"] == material:
            return m["label"]
    return material


def find_row(data, accession, row_ref):
    """One cleaned row by accession + row ref — never a design-range
    test-matrix summary (those are planned matrices, not tests)."""
    for r in data.rows:
        if (r["accession"] == accession and r["row_ref"] == row_ref
                and not str(r.get("row_kind") or "").startswith("design-range")):
            return r
    return None


def nearest_row_for(data, material, axis, value):
    """Nearest real test row for a material at an O2 level or pressure.
    Per-test + day-aggregate rows only; design-range rows excluded.
    Returns {accession, rowRef, doi, outcome, value} or None."""
    best = None
    best_d = float("inf")
    for r in data.rows:
        if r["material_canonical"] != material:
            continue
        if str(r.get("row_kind") or "").startswith("design-range"):
            continue
        mid_v = mid(r["o2_pct_min"], r["o2_pct_max"]) if axis == "o2" else \
            mid(r["pressure_psi_min"], r["pressure_psi_max"])
        if mid_v is None:
            continue
        d = abs(mid_v - value)
        if d < best_d:
            best_d = d
            best = {"accession": r["accession"], "rowRef": r["row_ref"],
                    "doi": r["doi"], "outcome": r.get("outcome"),
                    "value": mid_v}
    return best


def material_class(data, material):
    """Canonical class of a material, from the cleaned rows (majority)."""
    counts = {}
    for r in data.rows:
        if r["material_canonical"] == material:
            c = r.get("material_class") or "other"
            counts[c] = counts.get(c, 0) + 1
    best, best_n = "other", 0
    for c, n in counts.items():
        if n > best_n:
            best, best_n = c, n
    return best


def gas_materials(data):
    """Gas fuels — a separate group in the ranking, never mixed with
    cabin materials."""
    return [m for m in data.verdicts if material_class(data, m) == "gas"]


def other_solid_materials(data):
    """Solids with O2 coverage that are NOT headline materials. They belong
    in the ranking too — before this helper the mission brief ranked 31 of
    34 materials and silently dropped Silicone, Wax candle and PMMA + Nomex."""
    headline = {m["key"] for m in HEADLINE_MATERIALS}
    return [m for m in data.verdicts
            if m not in headline and material_class(data, m) == "solid"]


def doi_for(verdict, accession):
    inv = (verdict or {}).get("doiByInvestigation") or {}
    entry = inv.get(accession)
    return entry["doi"] if entry else None


# ---------------------------------------------------------------- verdicts

def get_verdict(data, material, atmosphere_key):
    """Preset verdict, straight from coverage-verdicts.json — same shape
    as the frontend's getVerdict(), so the UI renders API verdicts and
    bundled verdicts identically."""
    v = data.verdicts.get(material)
    if not v:
        return {"material": material, "atmosphere": atmosphere_key,
                "kind": "NO_DATA", "overall": "NO DATA", "o2": None, "pressure": None}
    a = v.get("atmospheres", {}).get(atmosphere_key)
    if not a:
        return {"material": material, "atmosphere": atmosphere_key,
                "kind": "NO_DATA", "overall": "NO DATA", "o2": None, "pressure": None}
    overall = a.get("overall", "")
    if overall == "TESTED":
        kind = "TESTED"
    elif overall == "GAP (O2)":
        kind = "GAP_O2"
    elif overall == "GAP (pressure)":
        kind = "GAP_PRESSURE"
    elif str(overall).startswith("PARTIAL"):
        kind = "PARTIAL"
    else:
        kind = "NO_DATA"
    out = {"material": material, "atmosphere": atmosphere_key,
           "kind": kind, "overall": overall}
    out.update(a)
    out["overall"] = overall
    # o2_max_atmos_distance_pts is precomputed in coverage-verdicts.json
    # with the old 37% Exploration max -- recompute it from the live
    # ATMOSPHERES definition (36%, HLS 34+-2%) so the value can never go
    # stale again when the atmosphere definition changes.
    _atm_max = ATMOSPHERES[atmosphere_key].get("o2Max")
    _o2_max = (v.get("o2") or {}).get("max")
    out["o2_max_atmos_distance_pts"] = (
        None if _atm_max is None or _o2_max is None else r2(_atm_max - _o2_max))
    out["doiByInvestigation"] = v.get("o2_by_investigation")
    out["o2Range"] = v.get("o2")
    out["pressureRange"] = v.get("pressure")
    out["nO2Rows"] = v.get("n_o2_rows")
    out["nPRows"] = v.get("n_p_rows")
    return out


def get_live_verdict(data, material, o2_pct, pressure_psi):
    """LIVE verdict at ARBITRARY conditions (O2 %, pressure psi) — a
    line-for-line port of the frontend's getLiveVerdict(). Same rules:
    no O2 levels -> NO_DATA; O2 outside [min, max] -> GAP (O2); O2
    covered + no pressure rows -> PARTIAL; O2 covered + pressure inside
    [min, max] (+-0.1 psi tolerance, pressures are recorded as integer
    mmHg) -> TESTED; else GAP (pressure)."""
    v = data.verdicts.get(material)
    base = {
        "material": material, "custom": True, "atmosphere": "custom",
        "o2Target": o2_pct, "pressureTarget": pressure_psi,
        "kind": "NO_DATA", "overall": "NO DATA",
        "o2": None, "pressure": None,
        "o2_nearest": None, "o2_distance_pts": None, "o2_nearest_row": None,
        "o2_nearest_outcome": None, "o2_verdict": None,
        "pressure_nearest_psi": None, "pressure_distance_psi": None,
        "pressure_nearest_row": None, "pressure_nearest_outcome": None,
        "pressure_verdict": None,
        "o2_max_atmos_distance_pts": None,
        "doiByInvestigation": v.get("o2_by_investigation") if v else None,
        "o2Range": v.get("o2") if v else None,
        "pressureRange": v.get("pressure") if v else None,
        "nO2Rows": v.get("n_o2_rows", 0) if v else 0,
        "nPRows": v.get("n_p_rows", 0) if v else 0,
    }
    if not v or not v.get("o2") or not isinstance(v["o2"].get("levels"), list) \
            or len(v["o2"]["levels"]) == 0:
        return base

    levels = v["o2"]["levels"]
    o2_min, o2_max = v["o2"]["min"], v["o2"]["max"]
    nearest = levels[0]
    best = abs(levels[0] - o2_pct)
    for lv in levels:
        d = abs(lv - o2_pct)
        if d < best:
            best, nearest = d, lv
    o2_row = nearest_row_for(data, material, "o2", nearest)
    base["o2_nearest"] = nearest
    base["o2_nearest_row"] = [o2_row["accession"], o2_row["rowRef"]] if o2_row else None
    base["o2_nearest_outcome"] = o2_row["outcome"] if o2_row else None

    if o2_pct > o2_max:
        base.update({"kind": "GAP_O2", "overall": "GAP (O2)",
                     "o2_verdict": "GAP", "o2_distance_pts": r2(o2_pct - o2_max)})
        return base
    if o2_pct < o2_min:
        base.update({"kind": "GAP_O2", "overall": "GAP (O2)",
                     "o2_verdict": "GAP", "o2_distance_pts": r2(o2_min - o2_pct)})
        return base
    base["o2_verdict"] = "COVERED"
    base["o2_distance_pts"] = r2(abs(o2_pct - nearest))

    if not v.get("pressure") or v["pressure"].get("min") is None:
        base.update({"kind": "PARTIAL",
                     "overall": "PARTIAL \u2014 O2 covered, pressure NOT RECORDED in PSI tables",
                     "pressure_verdict": "NOT RECORDED"})
        return base
    p_min, p_max = v["pressure"]["min"], v["pressure"]["max"]
    tol = 0.1
    if p_min - tol <= pressure_psi <= p_max + tol:
        p_row = nearest_row_for(data, material, "pressure", pressure_psi)
        base.update({"kind": "TESTED", "overall": "TESTED",
                     "pressure_verdict": "COVERED",
                     "pressure_nearest_psi": r2(p_row["value"]) if p_row else r2(p_min),
                     "pressure_nearest_row": [p_row["accession"], p_row["rowRef"]] if p_row else None,
                     "pressure_nearest_outcome": p_row["outcome"] if p_row else None})
        return base
    p_nearest = p_min if pressure_psi < p_min else p_max
    p_row = nearest_row_for(data, material, "pressure", p_nearest)
    base.update({"kind": "GAP_PRESSURE", "overall": "GAP (pressure)",
                 "pressure_verdict": "GAP",
                 "pressure_nearest_psi": r2(p_nearest),
                 "pressure_distance_psi": r2(abs(pressure_psi - p_nearest)),
                 "pressure_nearest_row": [p_row["accession"], p_row["rowRef"]] if p_row else None,
                 "pressure_nearest_outcome": p_row["outcome"] if p_row else None})
    return base


def gap_number(v):
    """The headline number for a verdict: {value, unit, axis}."""
    kind = v.get("kind")
    if kind == "TESTED":
        return {"value": None, "unit": None, "axis": None}
    if kind == "GAP_O2":
        return {"value": v.get("o2_distance_pts"), "unit": "O\u2082 pts", "axis": "o2"}
    if kind == "GAP_PRESSURE":
        return {"value": v.get("pressure_distance_psi"), "unit": "psi", "axis": "pressure"}
    if kind == "PARTIAL":
        return {"value": v.get("o2_distance_pts"), "unit": "O\u2082 pts", "axis": "o2"}
    return {"value": None, "unit": None, "axis": None}


def verdict_line(v):
    """Plain-language verdict line, built ONLY from the verdict record
    (port of the frontend's verdictLine())."""
    atm = ATMOSPHERES.get(v.get("atmosphere") or "")
    m = v.get("material")
    if v.get("custom"):
        o2, psi = fmt(v.get("o2Target"), 1), fmt(v.get("pressureTarget"), 1)
        if v["kind"] == "TESTED":
            return (f"{m} was tested at {o2}% O\u2082 and {psi} psi in microgravity "
                    f"\u2014 the condition was actually run.")
        if v["kind"] == "GAP_O2":
            above = v["o2Target"] > v["o2Range"]["max"]
            edge = v["o2Range"]["max"] if above else v["o2Range"]["min"]
            direction = "above" if above else "below"
            return (f"No {m} test ran {direction} {fmt(edge, 1)}% O\u2082 in PSI \u2014 at {o2}% "
                    f"O\u2082 the cabin is {fmt(v['o2_distance_pts'])} points beyond "
                    f"the tested range. Test first.")
        if v["kind"] == "GAP_PRESSURE":
            above = v["pressureTarget"] < v["pressure_nearest_psi"]
            return (f"{m} was tested at the {o2}% O\u2082 edge, but the nearest tested "
                    f"pressure is {fmt(v['pressure_nearest_psi'])} psi \u2014 "
                    f"{fmt(v['pressure_distance_psi'])} psi {'above' if above else 'below'} "
                    f"the {psi} psi cabin.")
        if v["kind"] == "PARTIAL":
            return (f"{m} is O\u2082-covered at {o2}% O\u2082 \u2014 nearest test "
                    f"{fmt(v['o2_nearest'])}% \u2014 but no PSI table records the test "
                    f"pressure, so this is coverage, not a pressure-tested verdict.")
        return f"No O\u2082 data for {m} in PSI \u2014 it cannot be judged for this cabin."
    if not atm:
        return f"No O\u2082 data for {m} in PSI."
    if v["kind"] == "TESTED":
        return (f"{m} was tested at {fmt(atm['o2'], 1)}% O\u2082 and {fmt(atm['pressure'], 1)} psi in "
                f"microgravity \u2014 the condition was actually run.")
    if v["kind"] == "GAP_O2":
        return (f"No {m} test ran above {fmt(v['o2_nearest'])}% O\u2082 in PSI \u2014 the "
                f"{fmt(atm['o2'], 1)}% {atm['name']} atmosphere is "
                f"{fmt(v['o2_distance_pts'])} points beyond the tested range. Test first.")
    if v["kind"] == "GAP_PRESSURE":
        return (f"{m} was tested at the {fmt(atm['o2'], 1)}% O\u2082 edge, but the nearest tested "
                f"pressure is {fmt(v['pressure_nearest_psi'])} psi \u2014 "
                f"{fmt(v['pressure_distance_psi'])} psi above the {fmt(atm['pressure'], 1)} psi "
                f"{atm['name']} atmosphere.")
    if v["kind"] == "PARTIAL":
        return (f"{m} is O\u2082-covered at {atm['name']} \u2014 nearest test "
                f"{fmt(v['o2_nearest'])}% \u2014 but no PSI table records the test "
                f"pressure, so this is coverage, not a pressure-tested verdict.")
    return f"No O\u2082 data for {m} in PSI \u2014 it cannot be judged for this atmosphere."


# ---------------------------------------------------------------- ranking / scatter

def _rank_entry(data, material, verdict):
    gap, gap_unit, gap_axis = 0, "O\u2082 pts", "o2"
    if verdict.get("kind") == "GAP_O2":
        gap = verdict.get("o2_distance_pts") or 0
    elif verdict.get("kind") == "GAP_PRESSURE":
        gap = verdict.get("pressure_distance_psi") or 0
        gap_unit, gap_axis = "psi", "pressure"
    return {"material": material, "label": label_for(material),
            "className": material_class(data, material),
            "kind": verdict.get("kind"), "overall": verdict.get("overall"),
            "gap": gap, "gapUnit": gap_unit, "gapAxis": gap_axis,
            "verdict": verdict}


def get_ranking(data, atmosphere_key):
    """Ranking for one atmosphere: cabin materials first, gases separate.
    Gap: O2 distance (pts) for O2 gaps, pressure distance (psi) for
    pressure gaps, 0 for TESTED/PARTIAL."""
    cabin = sorted(
        (_rank_entry(data, m["key"], get_verdict(data, m["key"], atmosphere_key))
         for m in HEADLINE_MATERIALS),
        key=lambda e: -e["gap"])
    gases = sorted(
        (_rank_entry(data, m, get_verdict(data, m, atmosphere_key))
         for m in gas_materials(data)),
        key=lambda e: -e["gap"])
    solids = sorted(
        (_rank_entry(data, m, get_verdict(data, m, atmosphere_key))
         for m in other_solid_materials(data)),
        key=lambda e: -e["gap"])
    return {"cabin": cabin, "gases": gases, "solids": solids}


def get_ranking_live(data, o2_pct, pressure_psi):
    cabin = sorted(
        (_rank_entry(data, m["key"], get_live_verdict(data, m["key"], o2_pct, pressure_psi))
         for m in HEADLINE_MATERIALS),
        key=lambda e: -e["gap"])
    gases = sorted(
        (_rank_entry(data, m, get_live_verdict(data, m, o2_pct, pressure_psi))
         for m in gas_materials(data)),
        key=lambda e: -e["gap"])
    solids = sorted(
        (_rank_entry(data, m, get_live_verdict(data, m, o2_pct, pressure_psi))
         for m in other_solid_materials(data)),
        key=lambda e: -e["gap"])
    return {"cabin": cabin, "gases": gases, "solids": solids}


def get_scatter_points(data, material="all"):
    """One point per cleaned row with BOTH O2 and pressure (997).
    Flow is recorded for only 8 rows; every other row sits at
    flow=null and is drawn on the labelled 'flow not recorded' plane,
    never at an invented value."""
    out = []
    for r in data.rows:
        o2 = mid(r.get("o2_pct_min"), r.get("o2_pct_max"))
        p = mid(r.get("pressure_psi_min"), r.get("pressure_psi_max"))
        if o2 is None or p is None:
            continue
        if material != "all" and r["material_canonical"] != material:
            continue
        out.append({
            "o2": o2, "pressure": p, "flow": r.get("flow_cm_s"),
            "material": r["material_canonical"],
            "className": r.get("material_class") or "other",
            "accession": r["accession"], "doi": r["doi"],
            "rowRef": r["row_ref"], "investigation": r["investigation"],
            "outcome": r.get("outcome"),
        })
    return out


def scatter_counts(data):
    rows = data.rows
    has_o2 = sum(1 for r in rows if r.get("o2_pct_min") is not None)
    has_p = sum(1 for r in rows if r.get("pressure_psi_min") is not None)
    both = sum(1 for r in rows
               if r.get("o2_pct_min") is not None and r.get("pressure_psi_min") is not None)
    return {"total": len(rows), "hasO2": has_o2, "hasP": has_p, "both": both,
            "o2NoP": has_o2 - both, "pNoO2": has_p - both}


# ---------------------------------------------------------------- materials / evidence / brief

def list_materials(data):
    out = []
    for name, v in data.verdicts.items():
        inv = v.get("o2_by_investigation") or {}
        out.append({
            "material": name,
            "label": label_for(name),
            "className": material_class(data, name),
            "is_headline": any(m["key"] == name for m in HEADLINE_MATERIALS),
            "n_o2_rows": v.get("n_o2_rows"),
            "n_p_rows": v.get("n_p_rows"),
            "o2": v.get("o2"),
            "pressure": v.get("pressure"),
            "investigations": [
                {"accession": acc, "title": e.get("title"), "doi": e.get("doi"),
                 "n": e.get("n"), "min": e.get("min"), "max": e.get("max")}
                for acc, e in inv.items()
            ],
        })
    return out


def evidence_pack(data, material, atmosphere_key=None, o2_pct=None, pressure_psi=None):
    """The evidence behind a verdict: the verdict itself, the exact PSI
    rows behind it (full row records — never a summary), the DOI per
    investigation, and the citations. If the nearest test is a
    design-range row it is never returned (find_row excludes them)."""
    if atmosphere_key:
        verdict = get_verdict(data, material, atmosphere_key)
    else:
        verdict = get_live_verdict(data, material, o2_pct, pressure_psi)

    def full_row(ref):
        if not ref:
            return None
        row = find_row(data, ref[0], ref[1])
        if not row:
            return None
        return {k: row.get(k) for k in (
            "investigation", "accession", "doi", "table_file", "row_ref",
            "row_kind", "material_canonical", "material_raw", "material_class",
            "o2_pct_min", "o2_pct_max", "o2_approx",
            "pressure_psi_min", "pressure_psi_max", "flow_cm_s",
            "outcome", "burn_time_s", "notes")}

    inv = verdict.get("doiByInvestigation") or {}
    citations = [
        {"accession": acc, "title": e.get("title"), "doi": e.get("doi"),
         "url": f"https://doi.org/{e['doi']}" if e.get("doi") else None}
        for acc, e in inv.items()
    ]
    return {
        "verdict": verdict,
        "line": verdict_line(verdict),
        "nearest_o2_row": full_row(verdict.get("o2_nearest_row")),
        "nearest_pressure_row": full_row(verdict.get("pressure_nearest_row")),
        "investigations": inv,
        "citations": citations,
        "reports": CITATIONS,
        "disclaimer": DISCLAIMER,
        "snapshot": data.snapshot(),
    }


def mission_brief(data, atmosphere_key):
    """Mission brief for one atmosphere: materials ranked by coverage,
    each with its verdict, gap and nearest real test + DOI, plus the
    citations a mission planner needs. Built only from the data."""
    atm = ATMOSPHERES[atmosphere_key]
    ranking = get_ranking(data, atmosphere_key)

    def entry(e):
        v = e["verdict"]
        o2_row = v.get("o2_nearest_row")
        p_row = v.get("pressure_nearest_row")
        return {
            "material": e["material"], "label": e["label"],
            "className": e["className"], "kind": e["kind"],
            "overall": e["overall"], "gap": e["gap"],
            "gapUnit": e["gapUnit"], "gapAxis": e["gapAxis"],
            "line": verdict_line(v),
            "nearest_o2_test": f"{o2_row[0]} \u00b7 {o2_row[1]}" if o2_row else None,
            "nearest_o2_value": v.get("o2_nearest"),
            "nearest_o2_doi": doi_for(v, o2_row[0]) if o2_row else None,
            "nearest_pressure_test": f"{p_row[0]} \u00b7 {p_row[1]}" if p_row else None,
            "nearest_pressure_value": v.get("pressure_nearest_psi"),
            "nearest_pressure_doi": doi_for(v, p_row[0]) if p_row else None,
        }

    all_dois = {}
    for group in (ranking["cabin"], ranking["solids"], ranking["gases"]):
        for e in group:
            for acc, inv in ((e["verdict"].get("doiByInvestigation") or {}).items()):
                all_dois[acc] = {"accession": acc, "title": inv.get("title"),
                                 "doi": inv.get("doi"),
                                 "url": f"https://doi.org/{inv['doi']}" if inv.get("doi") else None}
    # Recommended next test — same rule as the frontend (see buildBrief):
    # largest O2-axis gap among cabin/solid materials with >= 10 O2 rows.
    next_test = None
    for e in list(ranking["cabin"]) + list(ranking["solids"]):
        if e["kind"] not in ("GAP_O2", "PARTIAL"):
            continue
        if (e["gap"] or 0) <= 0:
            continue
        if (e["verdict"].get("nO2Rows") or 0) < 10:
            continue
        if next_test is None or (e["gap"] or 0) > (next_test["gap"] or 0):
            next_test = e
    next_test_out = None
    if next_test:
        next_test_out = {
            "material": next_test["material"], "label": next_test["label"],
            "gap": next_test["gap"], "gapUnit": next_test["gapUnit"],
            "n_o2_rows": next_test["verdict"].get("nO2Rows") or 0,
            "o2_pct": atm["o2"], "pressure_psi": atm["pressure"],
            "line": (f"Run {next_test['label']} at {fmt(atm['o2'], 1)}% O\u2082, "
                     f"{fmt(atm['pressure'], 1)} psi \u2014 the {atm['name']} point where "
                     f"its gap is {fmt(next_test['gap'])} {next_test['gapUnit']}."),
        }
    return {
        "atmosphere": atmosphere_key,
        "nextTest": next_test_out,
        "conditions": {"o2_pct": atm["o2"], "o2_max_pct": atm["o2Max"],
                       "pressure_psi": atm["pressure"], "blurb": atm["blurb"]},
        "cabin": [entry(e) for e in ranking["cabin"]],
        "solids": [entry(e) for e in ranking["solids"]],
        "gases": [entry(e) for e in ranking["gases"]],
        "citations": list(all_dois.values()),
        "reports": CITATIONS,
        "disclaimer": DISCLAIMER,
        "snapshot": data.snapshot(),
    }


# ---------------------------------------------------------------- coverage / plan

CONFIDENCE_METHOD = (
    "confidence = 1 \u2212 nearest-test distance \u00f7 target value "
    "(O2 pts \u00f7 atmosphere O2%, or psi \u00f7 atmosphere psi); "
    "TESTED = 1.00; PARTIAL capped at 0.50 because pressure was never "
    "recorded; NO DATA has no confidence. A heuristic, not a probability "
    "\u2014 the distance itself is the evidence.")


def verdict_confidence(v):
    """Verdict confidence — how close the nearest real test is to the
    condition, as a 0..1 score. NOT a probability and NOT an
    interpolation: the nearest-test distance itself is the evidence.
    TESTED 1.00 (condition actually run); PARTIAL capped at 0.50 (O2
    covered, pressure never recorded); GAP (O2) 1 - o2_distance_pts /
    target O2%; GAP (pressure) 1 - pressure_distance_psi / target psi;
    NO DATA null. Rounded to 2 decimals (same r2 as the frontend)."""
    if not v:
        return {"score": None, "note": "No verdict."}
    kind = v.get("kind")
    if kind == "TESTED":
        return {"score": 1, "note": "The condition was actually run in microgravity."}
    if kind == "PARTIAL":
        return {"score": 0.5, "note": "O2 covered, but pressure was never recorded "
                                      "\u2014 half the axes verified."}
    if kind == "GAP_O2":
        target = v.get("o2Target") if v.get("custom") else \
            ATMOSPHERES.get(v.get("atmosphere") or {}).get("o2")
        dist = v.get("o2_distance_pts")
        if dist is None or target is None or target <= 0:
            return {"score": None, "note": "Nearest-test distance not recorded."}
        return {"score": r2(max(0, 1 - dist / target)),
                "note": f"Nearest test is {fmt(dist, 1)} O2 pts from the "
                        f"{fmt(target, 1)}% target."}
    if kind == "GAP_PRESSURE":
        target = v.get("pressureTarget") if v.get("custom") else \
            ATMOSPHERES.get(v.get("atmosphere") or {}).get("pressure")
        dist = v.get("pressure_distance_psi")
        if dist is None or target is None or target <= 0:
            return {"score": None, "note": "Nearest-test distance not recorded."}
        return {"score": r2(max(0, 1 - dist / target)),
                "note": f"Nearest tested pressure is {fmt(dist, 2)} psi from the "
                        f"{fmt(target, 1)} psi target."}
    return {"score": None, "note": "No O2 data for this material in PSI "
                                   "\u2014 it cannot be judged."}


def _coverage_entry(data, material, verdict):
    gap = gap_number(verdict)
    conf = verdict_confidence(verdict)
    o2_row = verdict.get("o2_nearest_row")
    p_row = verdict.get("pressure_nearest_row")
    return {
        "kind": verdict.get("kind"), "overall": verdict.get("overall"),
        "gap": gap["value"] if gap["value"] is not None else 0,
        "gapUnit": gap["unit"] or "O\u2082 pts",
        "gapAxis": gap["axis"] or "o2",
        "o2_distance_pts": verdict.get("o2_distance_pts"),
        "pressure_distance_psi": verdict.get("pressure_distance_psi"),
        "o2_nearest": verdict.get("o2_nearest"),
        "o2_nearest_row": o2_row,
        "o2_nearest_doi": doi_for(verdict, o2_row[0]) if o2_row else None,
        "pressure_nearest_psi": verdict.get("pressure_nearest_psi"),
        "pressure_nearest_row": p_row,
        "pressure_nearest_doi": doi_for(verdict, p_row[0]) if p_row else None,
        "confidence": conf["score"], "confidence_note": conf["note"],
        "line": verdict_line(verdict),
    }


def get_coverage(data, material, atmosphere_key=None, o2_pct=None, pressure_psi=None):
    """Coverage pack for one material — tested ranges, test counts, and
    per-atmosphere confidence. Same shape and same math as the frontend
    (buildCoverage in app/src/lib/data.js). With an atmosphere key it
    returns that atmosphere only; without one it returns all three;
    with o2/pressure it returns the custom-cabin entry."""
    v = data.verdicts.get(material)
    rows_total = sum(1 for r in data.rows if r["material_canonical"] == material)
    inv = (v or {}).get("o2_by_investigation") or {}
    investigations = [
        {"accession": acc, "title": e.get("title"), "doi": e.get("doi"),
         "n": e.get("n"), "min": e.get("min"), "max": e.get("max")}
        for acc, e in inv.items()
    ]
    if v and v.get("o2"):
        o2 = {"min": v["o2"]["min"], "max": v["o2"]["max"],
              "levels": v["o2"]["levels"], "n_levels": len(v["o2"]["levels"]),
              "n_rows": v.get("n_o2_rows")}
    else:
        o2 = None
    if v and v.get("pressure") and v["pressure"].get("min") is not None:
        pressure = {"recorded": True, "min": r2(v["pressure"]["min"]),
                    "max": r2(v["pressure"]["max"]), "n_rows": v.get("n_p_rows")}
    else:
        pressure = {"recorded": False, "min": None, "max": None,
                    "n_rows": v.get("n_p_rows", 0) if v else 0}
    atmospheres = {}
    if atmosphere_key:
        atmospheres[atmosphere_key] = _coverage_entry(
            data, material, get_verdict(data, material, atmosphere_key))
    elif o2_pct is not None and pressure_psi is not None:
        atmospheres["custom"] = dict(_coverage_entry(
            data, material, get_live_verdict(data, material, o2_pct, pressure_psi)),
            o2_target=o2_pct, pressure_target=pressure_psi)
    else:
        for key in ATMOSPHERE_KEYS:
            atmospheres[key] = _coverage_entry(
                data, material, get_verdict(data, material, key))
    return {
        "material": material, "label": label_for(material),
        "className": material_class(data, material),
        "o2": o2, "pressure": pressure, "rows_total": rows_total,
        "investigations": investigations, "atmospheres": atmospheres,
        "snapshot": data.snapshot(), "disclaimer": DISCLAIMER,
        "confidence_method": CONFIDENCE_METHOD,
    }


def _plan_entry(data, material, verdict):
    gap = gap_number(verdict)
    conf = verdict_confidence(verdict)
    o2_row = verdict.get("o2_nearest_row")
    p_row = verdict.get("pressure_nearest_row")
    return {
        "material": material, "label": label_for(material),
        "className": material_class(data, material),
        "kind": verdict.get("kind"), "overall": verdict.get("overall"),
        "gap": gap["value"] if gap["value"] is not None else 0,
        "gapUnit": gap["unit"] or "O\u2082 pts",
        "gapAxis": gap["axis"] or "o2",
        "line": verdict_line(verdict),
        "confidence": conf["score"], "confidence_note": conf["note"],
        "nearest_o2_test": f"{o2_row[0]} \u00b7 {o2_row[1]}" if o2_row else None,
        "nearest_o2_doi": doi_for(verdict, o2_row[0]) if o2_row else None,
        "nearest_pressure_test": f"{p_row[0]} \u00b7 {p_row[1]}" if p_row else None,
        "nearest_pressure_doi": doi_for(verdict, p_row[0]) if p_row else None,
    }


def _plan_line(entries, conditions_label):
    """The plan's one-line verdict — counts plus the worst gap, built
    only from the entries. Worst = lowest confidence among the gaps."""
    total = len(entries)
    tested = sum(1 for e in entries if e["kind"] == "TESTED")
    gaps = [e for e in entries if e["kind"] in ("GAP_O2", "GAP_PRESSURE")]
    partials = [e for e in entries if e["kind"] == "PARTIAL"]
    no_data = [e for e in entries if e["kind"] == "NO_DATA"]
    worst = None
    if gaps:
        worst = sorted(gaps, key=lambda e: e["confidence"]
                       if e["confidence"] is not None else 1)[0]
    line = (f"{tested} of {total} material{'s' if total != 1 else ''} "
            f"TESTED at {conditions_label}")
    parts = []
    if gaps:
        w = (f" \u2014 worst: {worst['label']}, "
             f"{fmt(worst['gap'], 2 if worst['gapUnit'] == 'psi' else 1)} "
             f"{worst['gapUnit']} beyond the tested range") if worst else ""
        parts.append(f"{len(gaps)} gap{'s' if len(gaps) != 1 else ''}{w}")
    if partials:
        parts.append(f"{len(partials)} partial \u2014 "
                     f"{', '.join(p['label'] for p in partials)}, O2 covered, "
                     f"pressure never recorded")
    if no_data:
        parts.append(f"{len(no_data)} without PSI data \u2014 "
                     f"{', '.join(p['label'] for p in no_data)}")
    if parts:
        line += "; " + "; ".join(parts)
    else:
        line += " \u2014 every condition was actually run."
    return line


def _assemble_plan(data, entries, materials, atmosphere, conditions, conditions_label):
    summary = {
        "total": len(entries),
        "tested": sum(1 for e in entries if e["kind"] == "TESTED"),
        "gap": sum(1 for e in entries if e["kind"] in ("GAP_O2", "GAP_PRESSURE")),
        "partial": sum(1 for e in entries if e["kind"] == "PARTIAL"),
        "no_data": sum(1 for e in entries if e["kind"] == "NO_DATA"),
    }
    all_dois = {}
    for m in materials:
        v = data.verdicts.get(m)
        for acc, inv in ((v or {}).get("o2_by_investigation") or {}).items():
            all_dois[acc] = {"accession": acc, "title": inv.get("title"),
                             "doi": inv.get("doi"),
                             "url": f"https://doi.org/{inv['doi']}" if inv.get("doi") else None}
    return {
        "atmosphere": atmosphere, "conditions": conditions,
        "materials": entries, "summary": summary,
        "plan_line": _plan_line(entries, conditions_label),
        "citations": list(all_dois.values()),
        "reports": CITATIONS, "disclaimer": DISCLAIMER,
        "snapshot": data.snapshot(),
    }


def mission_plan(data, materials, atmosphere_key=None, o2_pct=None, pressure_psi=None):
    """Mission plan for a chosen material list at one atmosphere — the
    per-material verdicts, the counts, and the one-line verdict. Same
    shape and same math as the frontend (buildPlan in
    app/src/lib/data.js). Unknown materials are NO_DATA entries, never
    assumed covered."""
    if atmosphere_key:
        atm = ATMOSPHERES[atmosphere_key]
        entries = [_plan_entry(data, m, get_verdict(data, m, atmosphere_key))
                   for m in materials]
        return _assemble_plan(
            data, entries, materials, atmosphere_key,
            {"o2_pct": atm["o2"], "o2_max_pct": atm["o2Max"],
             "pressure_psi": atm["pressure"], "blurb": atm["blurb"]},
            f"{atm['name']} {fmt(atm['o2'], 1)}% O\u2082 @ {fmt(atm['pressure'], 1)} psi")
    entries = [_plan_entry(data, m, get_live_verdict(data, m, o2_pct, pressure_psi))
               for m in materials]
    return _assemble_plan(
        data, entries, materials, "custom",
        {"o2_pct": o2_pct, "pressure_psi": pressure_psi, "custom": True},
        f"{fmt(o2_pct, 1)}% O\u2082 @ {fmt(pressure_psi, 1)} psi (custom cabin)")


# ---------------------------------------------------------------- freshness

PSI_API_ROOT = "https://psi.nasa.gov/geode-py/ws/"


def check_psi_live(timeout=5):
    """Is the live PSI service reachable from this host? Any HTTP
    response counts as reachable; a network error or timeout counts as
    not. Never fakes freshness — when unreachable, callers report the
    snapshot date instead."""
    req = urllib.request.Request(PSI_API_ROOT, method="GET",
                                 headers={"User-Agent": "SPICA-firelab/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"live": True, "http_status": resp.status, "url": PSI_API_ROOT}
    except Exception as exc:  # network error, timeout, DNS — all the same answer
        return {"live": False, "http_status": None, "url": PSI_API_ROOT,
                "error": type(exc).__name__}
