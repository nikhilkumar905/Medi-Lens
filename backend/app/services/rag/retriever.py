"""Retrieval layer for RAG.

Passages (patient-document chunks and PubMed abstracts) are stored in the
`knowledge_chunks` table and ranked with Okapi BM25. BM25 needs no model download,
runs comfortably on a laptop, and is strong for medical terminology where exact
term overlap (e.g. "HbA1c", "TSH") matters.
"""
import math
import re
from collections import Counter

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.entities import KnowledgeChunk

_TOKEN = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")
_STOP = set("""a an the of and or to in on for with by is are was were be been this that these those as at
from it its into than then there their which who whom whose what when where why how not no yes can may
might will would should could also such per via""".split())


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


def chunk_text(text: str, size: int = 700, overlap: int = 120) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= size:
        return [text] if text else []
    chunks, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            cut = text.rfind("\n", start + size // 2, end)
            if cut == -1:
                cut = text.rfind(". ", start + size // 2, end)
            if cut != -1:
                end = cut + 1
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


def index_document(db: Session, document_id: int, patient_id: int | None, title: str, pages: list[dict]) -> int:
    db.query(KnowledgeChunk).filter_by(source_type="document", source_id=str(document_id)).delete()
    n = 0
    for p in pages:
        for c in chunk_text(p.get("text", "")):
            db.add(KnowledgeChunk(source_type="document", source_id=str(document_id), patient_id=patient_id,
                                  title=title, page=p["page"], text=c))
            n += 1
    db.commit()
    return n


def bm25_search(db: Session, query: str, k: int = 6, patient_id: int | None = None,
                source_types: tuple[str, ...] = ("document", "pubmed"), k1: float = 1.5, b: float = 0.75) -> list[dict]:
    q = db.query(KnowledgeChunk).filter(KnowledgeChunk.source_type.in_(source_types))
    if patient_id is not None:
        # patient documents only for this patient; literature is shared
        q = q.filter(or_(KnowledgeChunk.patient_id == patient_id, KnowledgeChunk.source_type == "pubmed"))
    else:
        # unlinked uploads may belong to different people: never cross-retrieve them
        q = q.filter(KnowledgeChunk.source_type == "pubmed")
    corpus = q.all()
    q_terms = tokenize(query)
    if not corpus or not q_terms:
        return []
    docs = [tokenize(c.text + " " + (c.title or "")) for c in corpus]
    avgdl = sum(len(d) for d in docs) / len(docs)
    df = Counter()
    for d in docs:
        df.update(set(d))
    N = len(docs)
    scored = []
    for chunk, toks in zip(corpus, docs):
        tf = Counter(toks)
        score = 0.0
        for t in q_terms:
            if t not in tf:
                continue
            idf = math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(toks) / avgdl))
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda x: -x[0])
    return [{"score": round(s, 3), "source_type": c.source_type, "source_id": c.source_id, "title": c.title,
             "page": c.page, "meta": c.meta, "text": c.text} for s, c in scored[:k]]
