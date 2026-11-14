"""
Backend tests — the verdict math, checked against the known values.

These are the numbers the frontend already shows from the same data;
the API must reproduce them exactly, or the app and the API disagree
in front of a judge.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                ".."))

import verdicts  # noqa: E402


@pytest.fixture(scope="module")
def data():
    return verdicts.get_data()


# ---------------------------------------------------------------- known verdicts

def test_sibal_exploration_gap_11_9(data):
    v = verdicts.get_verdict(data, "SIBAL fabric", "Exploration")
    assert v["kind"] == "GAP_O2"
    assert v["overall"] == "GAP (O2)"
    assert v["o2_distance_pts"] == 11.9
    assert v["o2_nearest"] == 22.1
    assert v["o2_nearest_row"] == ["PSI-99", "Sample 2-5"]
    assert verdicts.doi_for(v, "PSI-99") == "10.60555/2chp-m469"
    # At the 36% max atmosphere (HLS 34±2%) the gap grows to 13.9.
    assert v["o2_max_atmos_distance_pts"] == 13.9


def test_methanol_exploration_pressure_gap_1_98(data):
    v = verdicts.get_verdict(data, "Methanol", "Exploration")
    assert v["kind"] == "GAP_PRESSURE"
    assert v["overall"] == "GAP (pressure)"
    assert v["o2_verdict"] == "COVERED"
    assert v["pressure_nearest_psi"] == 10.18
    assert v["pressure_distance_psi"] == 1.98
    assert v["pressure_nearest_row"] == ["PSI-69", "FLEX test 121 (C12M101)"]
    row = verdicts.find_row(data, "PSI-69", "FLEX test 121 (C12M101)")
    assert row is not None
    assert row["outcome"] == "Extinction"
    assert verdicts.doi_for(v, "PSI-69") == "10.60555/mbq8-0451"


def test_sibal_iss_partial(data):
    v = verdicts.get_verdict(data, "SIBAL fabric", "ISS")
    assert v["kind"] == "PARTIAL"
    assert v["o2_verdict"] == "COVERED"
    assert v["o2_nearest"] == 20.8
    assert v["o2_nearest_row"] == ["PSI-25", "Test T25"]
    assert verdicts.doi_for(v, "PSI-25") == "10.60555/4qc4-de67"
    assert v["pressure_verdict"] == "NOT RECORDED"


def test_unknown_material_is_no_data(data):
    v = verdicts.get_verdict(data, "Unobtainium", "ISS")
    assert v["kind"] == "NO_DATA"
    assert v["overall"] == "NO DATA"


# ---------------------------------------------------------------- live verdicts

def test_live_verdict_matches_preset_atmospheres(data):
    # Sliders parked exactly on a preset must give the preset's numbers.
    v = verdicts.get_live_verdict(data, "SIBAL fabric", 34.0, 8.2)
    assert v["kind"] == "GAP_O2"
    assert v["o2_distance_pts"] == 11.9
    assert v["o2_nearest_row"] == ["PSI-99", "Sample 2-5"]
    v = verdicts.get_live_verdict(data, "Methanol", 34.0, 8.2)
    assert v["kind"] == "GAP_PRESSURE"
    assert v["pressure_distance_psi"] == 1.98
    assert v["pressure_nearest_psi"] == 10.18
    v = verdicts.get_live_verdict(data, "Methanol", 26.5, 10.2)
    assert v["kind"] == "TESTED"
    v = verdicts.get_live_verdict(data, "SIBAL fabric", 21.0, 14.7)
    assert v["kind"] == "PARTIAL"


def test_live_verdict_o2_below_range_is_gap(data):
    v = verdicts.get_live_verdict(data, "SIBAL fabric", 10.0, 14.7)
    assert v["kind"] == "GAP_O2"
    assert v["o2_distance_pts"] == 6.4  # 16.4 - 10.0


def test_live_verdict_no_o2_data_is_no_data(data):
    v = verdicts.get_live_verdict(data, "Unobtainium", 21.0, 14.7)
    assert v["kind"] == "NO_DATA"


# ---------------------------------------------------------------- scatter / ranking

def test_scatter_counts(data):
    counts = verdicts.scatter_counts(data)
    assert counts["total"] == 2012
    assert counts["both"] == 997  # rows with BOTH O2 and pressure
    assert counts["pNoO2"] == 11  # PSI-10 rows: pressure, no O2
    points = verdicts.get_scatter_points(data, "all")
    assert len(points) == 997
    assert all(p["o2"] is not None and p["pressure"] is not None for p in points)
    # Methanol droplets have both axes; SIBAL has no pressure rows at all,
    # so it correctly has zero scatter points (same as the frontend).
    methanol = verdicts.get_scatter_points(data, "Methanol")
    assert methanol and all(p["material"] == "Methanol" for p in methanol)
    assert verdicts.get_scatter_points(data, "SIBAL fabric") == []


def test_ranking_exploration_puts_sibal_first(data):
    r = verdicts.get_ranking(data, "Exploration")
    assert r["cabin"][0]["material"] == "SIBAL fabric"
    assert r["cabin"][0]["gap"] == 11.9
    assert r["cabin"][0]["kind"] == "GAP_O2"
    assert all(e["gap"] >= r["cabin"][i + 1]["gap"]
               for i, e in enumerate(r["cabin"][:-1]))
    # Gases are a separate group, never mixed with cabin materials.
    assert r["gases"]
    assert all(e["className"] == "gas" for e in r["gases"])


def test_ranking_covers_all_34_materials(data):
    # Regression: the brief used to rank 31 of 34 — Silicone, Wax candle
    # and PMMA + Nomex (mixed sample) were in neither the cabin nor the
    # gases group. They now form the solids group.
    r = verdicts.get_ranking(data, "Exploration")
    all_mats = [e["material"] for e in r["cabin"] + r["gases"] + r["solids"]]
    assert len(all_mats) == 34
    assert len(set(all_mats)) == 34
    assert {e["material"] for e in r["solids"]} == {
        "Silicone", "Wax candle", "PMMA + Nomex (mixed sample)"}
    # Wax candle has the largest gap in the dataset (one O2 row, 17.4%).
    assert r["solids"][0]["material"] == "Wax candle"
    assert r["solids"][0]["gap"] == 16.6
    assert r["solids"][0]["kind"] == "GAP_O2"
    # The live ranking covers all 34 too.
    live = verdicts.get_ranking_live(data, 34.0, 8.2)
    assert len(live["cabin"] + live["gases"] + live["solids"]) == 34


def test_mission_brief_includes_solids(data):
    brief = verdicts.mission_brief(data, "Exploration")
    assert len(brief["solids"]) == 3
    assert brief["solids"][0]["material"] == "Wax candle"
    assert brief["solids"][0]["gap"] == 16.6
    assert brief["solids"][0]["nearest_o2_doi"] == "10.60555/4qc4-de67"


def test_materials_list(data):
    mats = verdicts.list_materials(data)
    assert len(mats) == 34
    sibal = next(m for m in mats if m["material"] == "SIBAL fabric")
    assert sibal["is_headline"] is True
    assert sibal["n_o2_rows"] == 30
    assert sibal["o2"]["max"] == 22.1
    assert {i["accession"] for i in sibal["investigations"]} == {"PSI-25", "PSI-98", "PSI-99"}


# ---------------------------------------------------------------- evidence / brief

def test_evidence_pack_cites_real_rows(data):
    pack = verdicts.evidence_pack(data, "SIBAL fabric", "Exploration")
    assert pack["verdict"]["o2_distance_pts"] == 11.9
    row = pack["nearest_o2_row"]
    assert row is not None
    assert row["accession"] == "PSI-99"
    assert row["row_ref"] == "Sample 2-5"
    assert row["doi"] == "10.60555/2chp-m469"
    assert row["o2_pct_min"] == 22.1
    assert any(c["doi"] == "10.60555/2chp-m469" for c in pack["citations"])
    # No invented numbers: the evidence row IS a cleaned PSI row.
    assert pack["nearest_pressure_row"] is None  # SIBAL has no pressure rows


def test_evidence_pack_methanol_has_pressure_row(data):
    pack = verdicts.evidence_pack(data, "Methanol", "Exploration")
    row = pack["nearest_pressure_row"]
    assert row["accession"] == "PSI-69"
    assert row["row_ref"] == "FLEX test 121 (C12M101)"
    assert row["outcome"] == "Extinction"


def test_mission_brief_exploration(data):
    brief = verdicts.mission_brief(data, "Exploration")
    assert brief["conditions"]["o2_pct"] == 34.0
    assert brief["conditions"]["pressure_psi"] == 8.2
    assert brief["cabin"][0]["material"] == "SIBAL fabric"
    assert brief["cabin"][0]["gap"] == 11.9
    assert brief["cabin"][0]["nearest_o2_test"] == "PSI-99 \u00b7 Sample 2-5"
    assert brief["cabin"][0]["nearest_o2_doi"] == "10.60555/2chp-m469"
    assert brief["cabin"][0]["kind"] == "GAP_O2"
    assert "11.9" in brief["cabin"][0]["line"]
    assert brief["citations"]
    assert brief["snapshot"]["rows"] == 2012
    assert "not a" in brief["disclaimer"].lower() or "Coverage" in brief["disclaimer"]


# ---------------------------------------------------------------- lines / rounding

def test_verdict_lines_are_plain_language(data):
    v = verdicts.get_verdict(data, "SIBAL fabric", "Exploration")
    line = verdicts.verdict_line(v)
    assert "11.9" in line and "34%" in line
    v = verdicts.get_verdict(data, "Methanol", "Exploration")
    assert "1.98" in verdicts.verdict_line(v)


def test_r2_matches_js_rounding():
    assert verdicts.r2(1.97695093677064) == 1.98
    assert verdicts.r2(11.899999999999999) == 11.9
    assert verdicts.r2(10.17695093677064) == 10.18


# ---------------------------------------------------------------- Flask routes

@pytest.fixture(scope="module")
def client():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    import app as flask_app  # noqa: E402
    flask_app.app.config["TESTING"] = True
    return flask_app.app.test_client()


def test_api_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["rows"] == 2012


def test_api_verdict_preset_matches_known_values(client):
    r = client.get("/api/verdict?material=SIBAL%20fabric&atmosphere=Exploration")
    assert r.status_code == 200
    body = r.get_json()
    assert body["kind"] == "GAP_O2"
    assert body["o2_distance_pts"] == 11.9
    assert "11.9" in body["line"]


def test_api_verdict_live_params(client):
    r = client.get("/api/verdict?material=Methanol&o2=34&pressure=8.2&flow=5")
    assert r.status_code == 200
    body = r.get_json()
    assert body["kind"] == "GAP_PRESSURE"
    assert body["pressure_distance_psi"] == 1.98
    assert body["flow_cm_s"] == 5.0


def test_api_verdict_errors(client):
    assert client.get("/api/verdict").status_code == 400
    assert client.get("/api/verdict?material=Nope&atmosphere=ISS").status_code == 404
    assert client.get("/api/verdict?material=Methanol&atmosphere=Mars").status_code == 400
    assert client.get("/api/verdict?material=Methanol&o2=34").status_code == 400


def test_api_scatter_ranking_materials_brief(client):
    assert client.get("/api/scatter?material=all").get_json()["count"] == 997
    r = client.get("/api/ranking?atmosphere=Exploration")
    assert r.get_json()["cabin"][0]["material"] == "SIBAL fabric"
    assert len(client.get("/api/materials").get_json()["materials"]) == 34
    brief = client.get("/api/brief?atmosphere=Exploration").get_json()
    assert brief["cabin"][0]["gap"] == 11.9
    assert client.get("/api/brief").status_code == 400


def test_api_evidence(client):
    pack = client.get("/api/evidence?material=Methanol&atmosphere=Exploration").get_json()
    assert pack["nearest_pressure_row"]["outcome"] == "Extinction"
    assert pack["verdict"]["pressure_distance_psi"] == 1.98


def test_api_freshness_shape(client, monkeypatch):
    # Never fake freshness: with PSI unreachable the endpoint must say so.
    monkeypatch.setattr(verdicts, "check_psi_live",
                        lambda timeout=5: {"live": False, "http_status": None,
                                           "url": verdicts.PSI_API_ROOT,
                                           "error": "URLError"})
    body = client.get("/api/freshness").get_json()
    assert body["psi"]["live"] is False
    assert body["snapshot"]["rows"] == 2012


# ---------------------------------------------------------------- confidence

def test_confidence_pinned_values(data):
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "Methanol", "ISS"))["score"] == 1
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "SIBAL fabric", "ISS"))["score"] == 0.5
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "SIBAL fabric", "Exploration"))["score"] == 0.65
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "Methanol", "Exploration"))["score"] == 0.76
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "Heptane", "Exploration"))["score"] == 0.75
    assert verdicts.verdict_confidence(
        verdicts.get_verdict(data, "Unobtainium", "ISS"))["score"] is None


# ---------------------------------------------------------------- coverage

def test_coverage_sibal(data):
    c = verdicts.get_coverage(data, "SIBAL fabric")
    assert c["o2"]["min"] == 16.4 and c["o2"]["max"] == 22.1
    assert c["o2"]["n_levels"] == 17 and c["o2"]["n_rows"] == 30
    assert c["pressure"]["recorded"] is False
    assert c["rows_total"] == 44
    assert c["atmospheres"]["Exploration"]["gap"] == 11.9
    assert c["atmospheres"]["Exploration"]["confidence"] == 0.65
    assert c["atmospheres"]["ISS"]["confidence"] == 0.5
    assert c["atmospheres"]["Exploration"]["o2_nearest_doi"] == "10.60555/2chp-m469"


def test_coverage_methanol(data):
    c = verdicts.get_coverage(data, "Methanol")
    assert c["pressure"]["recorded"] is True
    assert c["pressure"]["min"] == 10.18 and c["pressure"]["max"] == 44.86
    assert c["pressure"]["n_rows"] == 156
    assert c["rows_total"] == 157
    assert c["atmospheres"]["ISS"]["confidence"] == 1
    assert c["atmospheres"]["Exploration"]["gap"] == 1.98


def test_coverage_single_atmosphere_and_live(data):
    c = verdicts.get_coverage(data, "Methanol", atmosphere_key="Orion")
    assert list(c["atmospheres"]) == ["Orion"]
    assert c["atmospheres"]["Orion"]["kind"] == "TESTED"
    live = verdicts.get_coverage(data, "SIBAL fabric", o2_pct=34, pressure_psi=8.2)
    assert list(live["atmospheres"]) == ["custom"]
    assert live["atmospheres"]["custom"]["confidence"] == 0.65


def test_coverage_unknown_material(data):
    c = verdicts.get_coverage(data, "Unobtainium")
    assert c["o2"] is None and c["rows_total"] == 0
    assert c["atmospheres"]["ISS"]["kind"] == "NO_DATA"
    assert c["atmospheres"]["ISS"]["confidence"] is None


# ---------------------------------------------------------------- plan

def test_plan_sibal_methanol_exploration(data):
    p = verdicts.mission_plan(data, ["SIBAL fabric", "Methanol"],
                              atmosphere_key="Exploration")
    assert p["summary"] == {"total": 2, "tested": 0, "gap": 2,
                            "partial": 0, "no_data": 0}
    assert "0 of 2 materials TESTED at Exploration 34% O\u2082 @ 8.2 psi" in p["plan_line"]
    assert "worst: SIBAL fabric, 11.9 O\u2082 pts beyond the tested range" in p["plan_line"]
    assert p["materials"][0]["nearest_o2_doi"] == "10.60555/2chp-m469"


def test_plan_iss_two_tested_one_partial(data):
    p = verdicts.mission_plan(data, ["Methanol", "Heptane", "SIBAL fabric"],
                              atmosphere_key="ISS")
    assert p["summary"] == {"total": 3, "tested": 2, "gap": 0,
                            "partial": 1, "no_data": 0}
    assert "1 partial \u2014 SIBAL fabric" in p["plan_line"]


def test_plan_unknown_material_is_no_data(data):
    p = verdicts.mission_plan(data, ["Unobtainium", "Methanol"], atmosphere_key="ISS")
    assert p["summary"]["no_data"] == 1 and p["summary"]["tested"] == 1
    assert "1 without PSI data \u2014 Unobtainium" in p["plan_line"]


def test_plan_live_custom_cabin(data):
    p = verdicts.mission_plan(data, ["Methanol"], o2_pct=26.5, pressure_psi=10.2)
    assert p["atmosphere"] == "custom"
    assert p["materials"][0]["kind"] == "TESTED"
    assert "custom cabin" in p["plan_line"]


# ---------------------------------------------------------------- API routes

def test_api_coverage(client):
    body = client.get("/api/coverage?material=SIBAL%20fabric").get_json()
    assert body["rows_total"] == 44
    assert body["atmospheres"]["Exploration"]["confidence"] == 0.65
    assert client.get("/api/coverage?material=SIBAL%20fabric&atmosphere=ISS").get_json()[
        "atmospheres"]["ISS"]["kind"] == "PARTIAL"
    assert client.get("/api/coverage?material=SIBAL%20fabric&o2=34&pressure=8.2").get_json()[
        "atmospheres"]["custom"]["confidence"] == 0.65
    assert client.get("/api/coverage").status_code == 400
    assert client.get("/api/coverage?material=Nope").status_code == 404
    assert client.get("/api/coverage?material=Methanol&atmosphere=Mars").status_code == 400
    assert client.get("/api/coverage?material=Methanol&o2=34").status_code == 400


def test_api_plan(client):
    body = client.get(
        "/api/plan?materials=SIBAL%20fabric,Methanol&atmosphere=Exploration").get_json()
    assert body["summary"] == {"total": 2, "tested": 0, "gap": 2,
                               "partial": 0, "no_data": 0}
    assert "worst: SIBAL fabric" in body["plan_line"]
    assert client.get("/api/plan").status_code == 400
    assert client.get("/api/plan?materials=").status_code == 400
    assert client.get("/api/plan?materials=Nope&atmosphere=ISS").status_code == 404
    assert client.get("/api/plan?materials=Methanol&atmosphere=Mars").status_code == 400
    assert client.get("/api/plan?materials=Methanol&o2=34").status_code == 400


# ---------------------------------------------------------------- Nov 14 audit fixes

def test_bass_ii_citation_is_the_real_report_number():
    refs = [c for c in verdicts.CITATIONS if c["ref"].startswith("BASS-II")]
    assert len(refs) == 1
    assert refs[0]["ref"] == "BASS-II \u2014 NASA-TM-202110011385"
    # The NTRS link itself is the record ID \u2014 that part was always right.
    assert refs[0]["url"] == "https://ntrs.nasa.gov/citations/20210011385"


def test_exploration_max_is_the_verified_hls_bound():
    assert verdicts.ATMOSPHERES["Exploration"]["o2Max"] == 36.0


def test_verdict_lines_scope_the_untested_claim_to_psi(data):
    v = verdicts.get_verdict(data, "SIBAL fabric", "Exploration")
    assert "in PSI" in verdicts.verdict_line(v)
    live = verdicts.get_live_verdict(data, "SIBAL fabric", 24.5, 8.2)
    assert "in PSI" in verdicts.verdict_line(live)


def test_mission_brief_names_the_next_test(data):
    b = verdicts.mission_brief(data, "Exploration")
    nt = b["nextTest"]
    assert nt["material"] == "SIBAL fabric"
    assert nt["o2_pct"] == 34.0
    assert nt["pressure_psi"] == 8.2
    assert nt["gap"] == 11.9
    assert nt["n_o2_rows"] == 30
    assert nt["line"].startswith("Run SIBAL fabric at 34%")


def _project_root():
    from pathlib import Path
    p = Path(__file__).resolve()
    for parent in [p, *p.parents]:
        if ((parent / "app" / "backend" / "verdicts.py").exists()
                and (parent / "backend" / "verdicts.py").exists()):
            return parent
    raise AssertionError("project root not found")


def test_backend_copies_stay_identical():
    root = _project_root()
    a = (root / "app" / "backend" / "verdicts.py").read_text(encoding="utf-8")
    b = (root / "backend" / "verdicts.py").read_text(encoding="utf-8")
    assert a == b
