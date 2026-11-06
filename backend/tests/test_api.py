from app.services.rag.retriever import chunk_text
from app.services.router.model_router import route
from app.services.voice.assistant import validate_call


def test_requires_auth(client):
    assert client.get("/api/patients").status_code == 401
    assert client.post("/api/auth/login", json={"username": "doctor", "password": "nope"}).status_code == 401


def test_health_reports_llm_missing(client):
    h = client.get("/api/health").json()
    assert h["llm_configured"] is False


def test_rejects_fake_pdf(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 400


def test_rejects_unsupported_extension(client, auth):
    r = client.post("/api/documents/upload", headers=auth, files={"file": ("x.exe", b"MZ....", "application/octet-stream")})
    assert r.status_code == 400


def test_full_document_flow(client, auth, lab_pdf):
    p = client.post("/api/patients", headers=auth, json={"name": "Synthetic Patient", "consent_ai_processing": True}).json()
    r = client.post("/api/documents/upload", headers=auth, data={"category": "report", "patient_id": str(p["id"])},
                    files={"file": ("cbc.pdf", lab_pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["extraction"]["pages"][0]["method"] == "native"

    img = client.get(f"/api/documents/{doc['id']}/page/1", headers=auth)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"

    a = client.post(f"/api/documents/{doc['id']}/analyze", headers=auth).json()
    assert a["structured"]["structuring_method"] == "deterministic-parser"
    assert any(w.startswith("GROQ_API_KEY") for w in a["structured"]["warnings"])
    assert a["structured"]["patient"]["age"].startswith("45")

    # interpretation needs LLM -> clear 503, never a fake answer
    assert client.post(f"/api/analyses/{a['id']}/interpret", headers=auth, json={}).status_code == 503

    # PDF only after approval
    assert client.post(f"/api/analyses/{a['id']}/report", headers=auth).status_code == 409
    rows = a["structured"]["rows"]
    rows[0]["result"] = "11.4"
    up = client.patch(f"/api/analyses/{a['id']}", headers=auth, json={
        "rows": [{k: r.get(k) for k in ("test_name", "result", "unit", "reference_interval", "flag", "page", "line_index")} for r in rows],
        "doctor_notes": "Checked against original.", "review_status": "approved"}).json()
    assert up["review_status"] == "approved" and up["structured"]["rows"][0]["verification"] == "doctor-edited"
    rep = client.post(f"/api/analyses/{a['id']}/report", headers=auth)
    assert rep.status_code == 200
    pdf = client.get(f"/api/reports/{rep.json()['id']}/download", headers=auth)
    assert pdf.content[:4] == b"%PDF"

    # second report for comparison
    doc2 = client.post("/api/documents/upload", headers=auth, data={"category": "previous", "patient_id": str(p["id"])},
                       files={"file": ("cbc2.pdf", lab_pdf, "application/pdf")}).json()
    a2 = client.post(f"/api/documents/{doc2['id']}/analyze", headers=auth).json()
    cmp = client.get(f"/api/analyses/{a2['id']}/compare", headers=auth).json()
    assert cmp["available"] and cmp["comparisons"]


def test_voice_tool_validation():
    assert validate_call("select_body_part", {"body_part": "Lungs"}) == (True, {"body_part": "lungs"})
    assert validate_call("select_body_part", {"body_part": "toaster"})[0] is False
    assert validate_call("run_shell", {"cmd": "rm -rf /"})[0] is False
    assert validate_call("select_body_part", {})[0] is False


def test_router_rejects_unconfigured_models():
    r = route("ct", "lungs")
    assert r["supported"] is False and "No validated" in r["reason"]
    assert route("report")["supported"] is True


def test_chunking():
    chunks = chunk_text("Sentence one. " * 200, size=300, overlap=50)
    assert len(chunks) > 3 and all(len(c) <= 300 for c in chunks)
