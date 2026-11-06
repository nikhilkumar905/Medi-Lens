import io
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="medlens_test_")
os.environ["STORAGE_DIR"] = _tmp
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["GROQ_API_KEY"] = ""  # tests never call the real LLM
os.environ["DOCTOR_USERNAME"] = "doctor"
os.environ["DOCTOR_PASSWORD"] = "testpass"


def make_lab_pdf() -> bytes:
    """Synthetic CBC report (no real patient data)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 800, "Sunrise Diagnostics Laboratory")
    c.setFont("Helvetica", 10)
    c.drawString(50, 780, "Patient Name: Test Person")
    c.drawString(300, 780, "Age: 45 Years")
    c.drawString(50, 765, "Gender: Male")
    c.drawString(300, 765, "Report Date: 12/03/2025")
    c.setFont("Helvetica-Bold", 10)
    y = 730
    for x, h in ((50, "Test Name"), (230, "Result"), (310, "Unit"), (400, "Reference Interval")):
        c.drawString(x, y, h)
    c.setFont("Helvetica", 10)
    rows = [("Haemoglobin", "11.2", "g/dL", "13.0 - 17.0"),
            ("Total WBC Count", "7800", "cells/cumm", "4000 - 11000"),
            ("Platelet Count", "4.8", "lakhs/cumm", "1.5 - 4.5"),
            ("MCV", "82.5", "fL", "83 - 101")]
    for name, res, unit, ref in rows:
        y -= 18
        c.drawString(50, y, name)
        c.drawString(230, y, res)
        c.drawString(310, y, unit)
        c.drawString(400, y, ref)
    c.drawString(50, y - 40, "Remarks: Mild microcytic picture. Clinical correlation advised.")
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/api/auth/login", json={"username": "doctor", "password": "testpass"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
def lab_pdf() -> bytes:
    return make_lab_pdf()
