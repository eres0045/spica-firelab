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
    # At the 37% max atmosphere the gap grows to 14.9.
    assert v["o2_max_atmos_distance_pts"] == 14.9


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
