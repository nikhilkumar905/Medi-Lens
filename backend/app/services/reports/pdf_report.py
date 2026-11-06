"""Professional PDF report (ReportLab) with the 13 required sections."""
import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NA = "Not available in source"


def _p(text, style):
    return Paragraph(escape(str(text)) if text not in (None, "") else f"<i>{NA}</i>", style)


def build_pdf(analysis, document, patient, doctor: str, version: int) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm, title="MedLens AI Medical Report")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, textColor=colors.HexColor("#0f4c5c"))
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=colors.HexColor("#0f4c5c"), spaceBefore=8)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("s", parent=body, fontSize=8, textColor=colors.HexColor("#555555"))
    s = analysis.structured
    interp = analysis.interpretation or {}
    pt = s.get("patient", {})
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    el = [Paragraph("MedLens AI — Medical Analysis Report", h1),
          Paragraph(f"Review status: <b>{analysis.review_status.upper()}</b> &nbsp;|&nbsp; Report version {version} &nbsp;|&nbsp; Generated {now}", small),
          Spacer(1, 6)]

    def kv(rows):
        t = Table([[Paragraph(f"<b>{escape(k)}</b>", body), _p(v, body)] for k, v in rows], colWidths=[45 * mm, None])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
                               ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef6f7")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t

    def bullets(items):
        items = [i for i in (items or []) if i]
        return [Paragraph("• " + escape(str(i)), body) for i in items] or [Paragraph(f"<i>None recorded</i>", body)]

    el += [Paragraph("1. Patient Information", h2), kv([
        ("Name", (patient.name if patient else None) or pt.get("patient_name")),
        ("Age", (patient.age if patient else None) or pt.get("age")),
        ("Gender", (patient.gender if patient else None) or pt.get("gender")),
        ("MRN", patient.mrn if patient else None)])]
    el += [Paragraph("2. Examination Information", h2), kv([("Report date", pt.get("report_date")),
                                                              ("Laboratory", pt.get("laboratory_name"))])]
    el += [Paragraph("3. Document Type", h2), _p(s.get("report_type"), body)]
    pages = (document.extraction or {}).get("pages", [])
    el += [Paragraph("4. Source Information", h2), kv([
        ("Source document", document.filename), ("SHA-256", document.sha256[:32] + "…"),
        ("Extraction method", ", ".join(sorted({p["method"] for p in pages})) or None),
        ("Structuring", s.get("structuring_method")), ("Processing date", analysis.created_at.strftime("%Y-%m-%d %H:%M"))])]

    rows = s.get("rows", [])
    el.append(Paragraph("5. Extracted Findings", h2))
    if rows:
        data = [["Test", "Result", "Unit", "Reference", "Status", "Page"]]
        for r in rows:
            st = r["evaluation"]["status"]
            data.append([Paragraph(escape(r["test_name"]), small), r["result"] + (" *" if r["verification"] != "source-matched" else ""),
                         r.get("unit") or "", r.get("reference_interval") or "—", st.replace("_", " "), str(r["page"])])
        t = Table(data, repeatRows=1, colWidths=[55 * mm, 22 * mm, 22 * mm, 35 * mm, 25 * mm, 12 * mm])
        style = [("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
                 ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f4c5c")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                 ("FONTSIZE", (0, 0), (-1, -1), 8)]
        for i, r in enumerate(rows, 1):
            if r["evaluation"]["status"] in ("high", "low"):
                style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fdecea")))
        t.setStyle(TableStyle(style))
        el += [t, Paragraph("* Requires manual verification (value could not be matched to source with certainty).", small)]
    else:
        el.append(Paragraph("<i>No structured laboratory values were extracted.</i>", body))

    abn = [r for r in rows if r["evaluation"]["status"] in ("high", "low")]
    el += [Paragraph("6. Abnormal Observations", h2)] + bullets(
        [f"{r['test_name']}: {r['result']} {r.get('unit') or ''} — {r['evaluation']['note']}" for r in abn] + s.get("observations", []))
    el += [Paragraph("7. Model-Generated Findings", h2)] + bullets(
        [f"{f.get('test')}: {f.get('explanation')}" for f in interp.get("abnormal_findings", [])] or [interp.get("summary")])
    el += [Paragraph("8. Clinical Interpretation", h2), _p(interp.get("interpretation"), body)]
    el += [Paragraph("9. Differential Considerations", h2)] + bullets(
        [f"{d.get('condition')} — {d.get('rationale')}" for d in interp.get("differential_considerations", [])])
    refs = []
    for e in interp.get("evidence", []):
        m = e.get("meta") or {}
        if e["source_type"] == "pubmed":
            au = ", ".join((m.get("authors") or [])[:3]) + (" et al." if len(m.get("authors") or []) > 3 else "")
            refs.append(f"[{e['id']}] {au}. {e.get('title')}. {m.get('journal') or ''} {m.get('year') or ''}. PMID {e['source_id']}"
                        + (f". doi:{m['doi']}" if m.get("doi") else ""))
        else:
            refs.append(f"[{e['id']}] Patient document #{e['source_id']} ({e.get('title')}), page {e.get('page')}")
    el += [Paragraph("10. Supporting Medical Evidence", h2)] + bullets(refs)
    el += [Paragraph("11. Suggested Further Evaluation", h2)] + bullets(interp.get("suggested_further_evaluation"))
    el += [Paragraph("12. Limitations", h2)] + bullets(
        (interp.get("limitations") or []) + s.get("warnings", []) +
        ["This report is decision support only and does not establish a diagnosis or prescribe treatment."])
    el += [Paragraph("13. Doctor Review and Approval", h2), kv([
        ("Status", analysis.review_status), ("Reviewed by", doctor),
        ("Doctor notes", analysis.doctor_notes), ("AI model", interp.get("model") or s.get("model")),
        ("Approval date", analysis.updated_at.strftime("%Y-%m-%d %H:%M") if analysis.updated_at else None)])]
    doc.build(el)
    return buf.getvalue()
