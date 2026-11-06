"""Professional, patient-friendly PDF report (ReportLab).

Layout: branded header + footer with page numbers on every page, a patient/report summary card, an
"at a glance" box, a clearly labelled results table, plain-language advice, and the 13 required sections.
"""
import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

NA = "Not available in source"

# ---------- palette ----------
BRAND = colors.HexColor("#0f4c5c")
BRAND_LIGHT = colors.HexColor("#e6f2f4")
INK = colors.HexColor("#1e293b")
MUTED = colors.HexColor("#64748b")
RULE = colors.HexColor("#d5dde5")
ZEBRA = colors.HexColor("#f6f8fa")
HIGH_BG, HIGH_FG = colors.HexColor("#fdecea"), colors.HexColor("#b42318")
LOW_BG, LOW_FG = colors.HexColor("#e8f1fd"), colors.HexColor("#1d4ed8")
OK_FG = colors.HexColor("#15803d")
SEVERITY = {"normal": ("Normal", OK_FG), "mild": ("Mild", colors.HexColor("#65a30d")),
            "moderate": ("Moderate", colors.HexColor("#d97706")), "serious": ("Serious", HIGH_FG)}

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_H = 20 * mm
FOOTER_H = 14 * mm


# ---------- styles ----------
_ss = getSampleStyleSheet()
TITLE = ParagraphStyle("title", parent=_ss["Title"], fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK, alignment=0, spaceAfter=2)
SUB = ParagraphStyle("sub", parent=_ss["BodyText"], fontSize=8.5, leading=11, textColor=MUTED)
H2 = ParagraphStyle("h2", parent=_ss["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=BRAND, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("body", parent=_ss["BodyText"], fontSize=9.5, leading=13.5, textColor=INK)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8, leading=10.5, textColor=MUTED)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.5, leading=11)
CELL_B = ParagraphStyle("cellb", parent=CELL, fontName="Helvetica-Bold")
CELL_R = ParagraphStyle("cellr", parent=CELL, alignment=TA_RIGHT)
CELL_C = ParagraphStyle("cellc", parent=CELL, alignment=TA_CENTER)
TH = ParagraphStyle("th", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
TH_R = ParagraphStyle("thr", parent=TH, alignment=TA_RIGHT)
TH_C = ParagraphStyle("thc", parent=TH, alignment=TA_CENTER)
LABEL = ParagraphStyle("label", parent=CELL, fontSize=7.5, leading=9.5, textColor=MUTED)
VALUE = ParagraphStyle("value", parent=CELL, fontName="Helvetica-Bold", fontSize=9.5, leading=12)
BIG = ParagraphStyle("big", parent=BODY, fontName="Helvetica-Bold", fontSize=18, leading=21, alignment=TA_CENTER)
BIG_LABEL = ParagraphStyle("biglabel", parent=SMALL, alignment=TA_CENTER)
BUL = ParagraphStyle("bul", parent=BODY, leftIndent=11, bulletIndent=2, spaceAfter=1.5)
BUL_CELL = ParagraphStyle("bulcell", parent=CELL, leftIndent=10, bulletIndent=1, spaceAfter=1)
BUL_SMALL = ParagraphStyle("bulsmall", parent=SMALL, leftIndent=10, bulletIndent=1, spaceAfter=1)


def _t(v) -> str:
    """Escape for Paragraph markup; empty values become an italic 'not available'."""
    return escape(str(v)) if v not in (None, "") else f"<i>{NA}</i>"


def _p(v, style=BODY):
    return Paragraph(_t(v), style)


def _fmt_dt(v) -> str | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v.strftime("%d %b %Y, %H:%M")
    return str(v)


class _NumberedCanvas(rl_canvas.Canvas):
    """Draws 'Page X of Y' once the total page count is known."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 7.5)
            self.setFillColor(MUTED)
            self.drawRightString(PAGE_W - MARGIN, 8 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


def _decorate(meta: dict):
    def draw(c: rl_canvas.Canvas, _doc):
        c.saveState()
        # header band
        c.setFillColor(BRAND)
        c.rect(0, PAGE_H - HEADER_H + 4 * mm, PAGE_W, HEADER_H - 4 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN, PAGE_H - 11 * mm, "MedLens")
        c.setFont("Helvetica", 8.5)
        c.drawString(MARGIN + 27 * mm, PAGE_H - 11 * mm, "Medical Report Analysis")
        c.drawRightString(PAGE_W - MARGIN, PAGE_H - 9.5 * mm, meta["patient_line"])
        c.setFont("Helvetica", 7.5)
        c.drawRightString(PAGE_W - MARGIN, PAGE_H - 13 * mm, meta["report_line"])
        # footer
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        c.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
        c.setFont("Helvetica", 7.5)
        c.setFillColor(MUTED)
        c.drawString(MARGIN, 8 * mm, "Decision support only. Not a diagnosis. Must be reviewed by a qualified doctor.")
        c.drawCentredString(PAGE_W / 2, 4.5 * mm, f"Generated {meta['generated']} · Status: {meta['status']}")
        c.restoreState()
    return draw


def _section(n: int, title: str):
    return Paragraph(f'<font color="#94a3b8">{n:02d}</font>&nbsp;&nbsp;{escape(title)}', H2)


def _bullets(items, empty="None recorded"):
    items = [str(i).strip() for i in (items or []) if str(i).strip()]
    if not items:
        return [Paragraph(f"<i>{empty}</i>", SMALL)]
    return [Paragraph(escape(i), BUL, bulletText="•") for i in items]


def _kv_grid(pairs, cols=3):
    """Label-over-value cards in a grid (used for the patient/report summary)."""
    cells = [[Paragraph(escape(k).upper(), LABEL), Paragraph(_t(v), VALUE)] for k, v in pairs]
    rows, row = [], []
    for c in cells:
        row.append(c)
        if len(row) == cols:
            rows.append(row)
            row = []
    if row:
        rows.append(row + [""] * (cols - len(row)))
    t = Table(rows, colWidths=[CONTENT_W / cols] * cols)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND_LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.6, BRAND),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _kv_table(pairs):
    t = Table([[Paragraph(escape(k), CELL_B), _p(v, CELL)] for k, v in pairs], colWidths=[48 * mm, CONTENT_W - 48 * mm])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("BACKGROUND", (0, 0), (0, -1), ZEBRA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _glance(total: int, abnormal: int, needs_check: int, severity: str | None):
    sev_label, sev_color = SEVERITY.get(severity or "", ("Not assessed", MUTED))
    def stat(value, label, color=INK):
        return [Paragraph(f'<font color="{color.hexval().replace("0x", "#")}">{escape(str(value))}</font>', BIG), Paragraph(label, BIG_LABEL)]
    data = [[stat(total, "Tests extracted"), stat(abnormal, "Outside reference range", HIGH_FG if abnormal else OK_FG),
             stat(needs_check, "Need manual check", colors.HexColor("#d97706") if needs_check else INK),
             stat(sev_label, "Overall picture", sev_color)]]
    t = Table(data, colWidths=[CONTENT_W / 4] * 4)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, RULE), ("INNERGRID", (0, 0), (-1, -1), 0.6, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def _results_table(rows):
    # Test | Result | Unit | Reference range | Status | Page  — widths sum to CONTENT_W
    widths = [62 * mm, 24 * mm, 22 * mm, 36 * mm, 21 * mm, CONTENT_W - 165 * mm]
    head = [Paragraph("Test", TH), Paragraph("Result", TH_R), Paragraph("Unit", TH), Paragraph("Reference range", TH),
            Paragraph("Status", TH_C), Paragraph("Page", TH_C)]
    data = [head]
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    for i, r in enumerate(rows, 1):
        st = r["evaluation"]["status"]
        flag = r.get("verification") != "source-matched"
        if st == "high":
            status, fg, bg = "HIGH", HIGH_FG, HIGH_BG
        elif st == "low":
            status, fg, bg = "LOW", LOW_FG, LOW_BG
        elif st == "abnormal":
            status, fg, bg = "ABNORMAL", HIGH_FG, HIGH_BG
        elif st == "normal":
            status, fg, bg = "Normal", OK_FG, None
        else:
            status, fg, bg = st.replace("_", " ").capitalize(), MUTED, None
        result = escape(str(r["result"])) + (' <font color="#d97706">*</font>' if flag else "")
        bold = st in ("high", "low", "abnormal")
        data.append([
            Paragraph(escape(r["test_name"]), CELL_B if bold else CELL),
            Paragraph(f"<b>{result}</b>" if bold else result, CELL_R),
            Paragraph(escape(r.get("unit") or "—"), CELL),
            Paragraph(escape(r.get("reference_interval") or "—"), CELL),
            Paragraph(f'<font color="{fg.hexval().replace("0x", "#")}"><b>{escape(status)}</b></font>', CELL_C),
            Paragraph(escape(str(r.get("page") or "—")), CELL_C),
        ])
        if bg is not None:
            style.append(("BACKGROUND", (0, i), (-1, i), bg))
        elif i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ZEBRA))
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


def _advice_grid(interp: dict):
    blocks = [("Precautions to take", interp.get("precautions"), OK_FG),
              ("Things to avoid", interp.get("avoid"), HIGH_FG),
              ("Healthy habits", interp.get("lifestyle"), BRAND),
              ("See a doctor quickly if", interp.get("see_doctor_if"), colors.HexColor("#d97706"))]
    blocks = [b for b in blocks if b[1]]
    if not blocks:
        return None
    half = (CONTENT_W - 4 * mm) / 2

    def box(title, items, color):
        inner = [Paragraph(f'<font color="{color.hexval().replace("0x", "#")}"><b>{escape(title)}</b></font>', BODY)]
        inner += [Paragraph(escape(str(x)), BUL_CELL, bulletText="•") for x in items]
        t = Table([[x] for x in inner], colWidths=[half])
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, RULE), ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                               ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 2),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, 0), 6),
                               ("BOTTOMPADDING", (0, -1), (-1, -1), 6)]))
        return t

    cells = [box(*b) for b in blocks]
    rows = [cells[i:i + 2] + ([""] if len(cells[i:i + 2]) == 1 else []) for i in range(0, len(cells), 2)]
    grid = Table(rows, colWidths=[half + 2 * mm, half + 2 * mm])
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm)]))
    return grid


def _signature(doctor: str, approved_at):
    line = "_" * 28
    data = [[Paragraph("<b>Reviewed and approved by</b>", CELL), Paragraph("<b>Signature</b>", CELL), Paragraph("<b>Date</b>", CELL)],
            [Paragraph(escape(doctor or "—"), BODY), Paragraph(line, BODY), Paragraph(escape(approved_at or "—"), BODY)]]
    t = Table(data, colWidths=[CONTENT_W * 0.4, CONTENT_W * 0.35, CONTENT_W * 0.25])
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, RULE), ("BACKGROUND", (0, 0), (-1, 0), ZEBRA),
                           ("TOPPADDING", (0, 1), (-1, 1), 14), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def build_pdf(analysis, document, patient, doctor: str, version: int) -> bytes:
    s = analysis.structured or {}
    interp = analysis.interpretation or {}
    pt = s.get("patient", {}) or {}
    rows = s.get("rows", []) or []
    abn = [r for r in rows if r["evaluation"]["status"] in ("high", "low", "abnormal")]
    needs_check = sum(1 for r in rows if r.get("verification") != "source-matched")
    now = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")

    name = (patient.name if patient else None) or pt.get("patient_name")
    age = (patient.age if patient else None) or pt.get("age")
    gender = (patient.gender if patient else None) or pt.get("gender")
    age_sex = " / ".join(x for x in [str(age) if age else "", str(gender) if gender else ""] if x) or None

    meta = {
        "patient_line": f"Patient: {name or 'Unlinked'}" + (f"  ·  {age_sex}" if age_sex else ""),
        "report_line": f"{s.get('report_type') or 'Medical report'}  ·  Version {version}",
        "generated": now,
        "status": (analysis.review_status or "pending").upper(),
    }

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=HEADER_H + 4 * mm,
                          bottomMargin=FOOTER_H + 2 * mm, title=f"MedLens report – {name or 'patient'}",
                          author="MedLens", subject=s.get("report_type") or "Medical report analysis")
    frame = Frame(MARGIN, FOOTER_H + 2 * mm, CONTENT_W, PAGE_H - HEADER_H - FOOTER_H - 6 * mm, id="body",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=_decorate(meta))])

    el = [Paragraph(escape(s.get("report_type") or "Medical Report Analysis"), TITLE),
          Paragraph(f"Source: {escape(document.filename)} &nbsp;·&nbsp; Report version {version} &nbsp;·&nbsp; "
                    f"Review status: <b>{escape(meta['status'])}</b>", SUB),
          Spacer(1, 8)]

    # ---- summary card ----
    el.append(_kv_grid([
        ("Patient name", name), ("Age / Sex", age_sex), ("Patient ID (MRN)", patient.mrn if patient else None),
        ("Report date", pt.get("report_date")), ("Laboratory", pt.get("laboratory_name")), ("Report type", s.get("report_type")),
    ]))
    el.append(Spacer(1, 8))
    el.append(_glance(len(rows), len(abn), needs_check, interp.get("severity")))

    summary = interp.get("summary") or interp.get("spoken_summary")
    if summary or interp.get("key_points"):
        box = [Paragraph("<b>Summary in plain language</b>", BODY)]
        if summary:
            box.append(Paragraph(escape(summary), BODY))
        box += [Paragraph(escape(str(k)), BUL_CELL, bulletText="•") for k in interp.get("key_points") or []]
        t = Table([[x] for x in box], colWidths=[CONTENT_W])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND_LIGHT), ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND),
                               ("LEFTPADDING", (0, 0), (-1, -1), 9), ("TOPPADDING", (0, 0), (-1, -1), 2),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, 0), 7),
                               ("BOTTOMPADDING", (0, -1), (-1, -1), 7)]))
        el += [Spacer(1, 8), t]

    # ---- 13 required sections ----
    el += [_section(1, "Patient Information"), _kv_table([("Name", name), ("Age", age), ("Sex", gender),
                                                          ("Patient ID (MRN)", patient.mrn if patient else None)])]
    el += [_section(2, "Examination Information"), _kv_table([("Report date", pt.get("report_date")),
                                                              ("Laboratory", pt.get("laboratory_name"))])]
    el += [_section(3, "Document Type"), _p(s.get("report_type"))]
    pages = (document.extraction or {}).get("pages", [])
    el += [_section(4, "Source Information"), _kv_table([
        ("Source document", document.filename),
        ("File fingerprint (SHA-256)", (document.sha256 or "")[:32] + "…" if document.sha256 else None),
        ("Text extraction", ", ".join(sorted({p["method"].replace("_", " ") for p in pages})) or None),
        ("Value structuring", s.get("structuring_method")),
        ("Processed on", _fmt_dt(analysis.created_at))])]

    el += [CondPageBreak(60 * mm), _section(5, "Test Results")]
    if rows:
        el.append(_results_table(rows))
        legend = ('<font color="#b42318"><b>HIGH</b></font> above the report\'s reference range &nbsp;·&nbsp; '
                  '<font color="#1d4ed8"><b>LOW</b></font> below it &nbsp;·&nbsp; '
                  '<font color="#d97706"><b>*</b></font> value could not be matched to the source with certainty: please verify. '
                  'Ranges are taken only from the original report.')
        el += [Spacer(1, 3), Paragraph(legend, SMALL)]
    else:
        el.append(Paragraph("<i>No structured laboratory values were extracted.</i>", BODY))

    el += [_section(6, "Values Outside the Reference Range")] + _bullets(
        [f"{r['test_name']}: {r['result']} {r.get('unit') or ''} ({r['evaluation']['note']})" for r in abn] + (s.get("observations") or []),
        empty="All extracted values are within the reference ranges printed on the report.")
    plain = interp.get("plain_findings") or []
    el += [_section(7, "What the Findings Mean")] + _bullets(
        [f"{f.get('test')}: {f.get('meaning')}" for f in plain]
        or [f"{f.get('test')}: {f.get('explanation')}" for f in interp.get("abnormal_findings", [])]
        or ([interp.get("summary")] if interp.get("summary") else []))
    el += [_section(8, "Clinical Interpretation"), _p(interp.get("interpretation"))]
    if interp.get("severity_reason"):
        el.append(Paragraph(f"<b>Overall picture:</b> {escape(interp['severity_reason'])}", BODY))
    el += [_section(9, "Possible Conditions to Consider")] + _bullets(
        [f"{d.get('condition')}" + (f" ({d['likelihood']})" if d.get("likelihood") else "") + f": {d.get('rationale')}"
         for d in interp.get("differential_considerations", [])])

    advice = _advice_grid(interp)
    if advice is not None:
        el += [CondPageBreak(50 * mm), Paragraph("Advice for the Patient", H2), advice]

    refs = []
    for e in interp.get("evidence", []) or []:
        m = e.get("meta") or {}
        if e.get("source_type") == "pubmed":
            au = ", ".join((m.get("authors") or [])[:3]) + (" et al." if len(m.get("authors") or []) > 3 else "")
            refs.append(f"[{e['id']}] {au}. {e.get('title')}. {m.get('journal') or ''} {m.get('year') or ''}. PMID {e['source_id']}"
                        + (f". doi:{m['doi']}" if m.get("doi") else ""))
        else:
            refs.append(f"[{e['id']}] Patient document #{e.get('source_id')} ({e.get('title')}), page {e.get('page')}")
    el += [_section(10, "Supporting Medical Evidence")]
    el += [Paragraph(escape(r), BUL_SMALL, bulletText="•") for r in refs] if refs else [Paragraph("<i>None recorded</i>", SMALL)]
    el += [_section(11, "Suggested Further Evaluation")] + _bullets(interp.get("suggested_further_evaluation"))
    el += [_section(12, "Limitations")] + _bullets(
        (interp.get("limitations") or []) + [w for w in (s.get("warnings") or []) if not str(w).startswith("GROQ")] +
        ["This report is decision support only and does not establish a diagnosis or prescribe treatment."])

    approved = _fmt_dt(analysis.updated_at) if analysis.review_status == "approved" else None
    el.append(KeepTogether([
        _section(13, "Doctor Review and Approval"),
        _kv_table([("Review status", (analysis.review_status or "pending").capitalize()), ("Doctor notes", analysis.doctor_notes),
                   ]),
        Spacer(1, 8),
        _signature(doctor, approved),
    ]))

    doc.build(el, canvasmaker=_NumberedCanvas)
    return buf.getvalue()
