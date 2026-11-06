"""PubMed retrieval via NCBI E-utilities (esearch + efetch).

Only metadata actually returned by PubMed is stored — titles, authors, journal,
year, PMID, DOI and abstract are never generated.
"""
import xml.etree.ElementTree as ET

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import KnowledgeChunk
from app.services.rag.retriever import chunk_text

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def _params(extra: dict) -> dict:
    s = get_settings()
    p = {"db": "pubmed", "tool": "medlens-ai", **extra}
    if s.pubmed_api_key:
        p["api_key"] = s.pubmed_api_key
    if s.pubmed_email:
        p["email"] = s.pubmed_email
    return p


def search_pubmed(query: str, max_results: int = 5) -> list[dict]:
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{EUTILS}/esearch.fcgi", params=_params(
            {"term": query, "retmode": "json", "retmax": max_results, "sort": "relevance"}))
        r.raise_for_status()
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return []
        r = client.get(f"{EUTILS}/efetch.fcgi", params=_params({"id": ",".join(ids), "retmode": "xml"}))
        r.raise_for_status()
    return parse_pubmed_xml(r.text)


def parse_pubmed_xml(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for art in root.findall(".//PubmedArticle"):
        pmid = art.findtext(".//MedlineCitation/PMID")
        a = art.find(".//Article")
        if a is None or not pmid:
            continue
        title = "".join(a.find("ArticleTitle").itertext()).strip() if a.find("ArticleTitle") is not None else ""
        abstract = " ".join("".join(t.itertext()).strip() for t in a.findall(".//Abstract/AbstractText"))
        authors = []
        for au in a.findall(".//AuthorList/Author"):
            last, ini = au.findtext("LastName"), au.findtext("Initials")
            if last:
                authors.append(f"{last} {ini or ''}".strip())
            elif au.findtext("CollectiveName"):
                authors.append(au.findtext("CollectiveName"))
        journal = a.findtext(".//Journal/Title") or a.findtext(".//Journal/ISOAbbreviation")
        year = a.findtext(".//JournalIssue/PubDate/Year") or (a.findtext(".//JournalIssue/PubDate/MedlineDate") or "")[:4] or None
        doi = None
        for aid in art.findall(".//ArticleIdList/ArticleId"):
            if aid.get("IdType") == "doi":
                doi = aid.text
        out.append({"pmid": pmid, "title": title, "authors": authors, "journal": journal, "year": year,
                    "doi": doi, "abstract": abstract, "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"})
    return out


def ingest_articles(db: Session, articles: list[dict]) -> int:
    n = 0
    for art in articles:
        if not art.get("abstract"):
            continue
        db.query(KnowledgeChunk).filter_by(source_type="pubmed", source_id=art["pmid"]).delete()
        meta = {k: art[k] for k in ("pmid", "authors", "journal", "year", "doi", "url")}
        for c in chunk_text(art["abstract"], size=900):
            db.add(KnowledgeChunk(source_type="pubmed", source_id=art["pmid"], title=art["title"], meta=meta, text=c))
            n += 1
    db.commit()
    return n
