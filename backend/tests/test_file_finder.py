from pathlib import Path

from app.core.config import get_settings
from app.services.documents import file_finder as ff


def _setup(tmp_path, monkeypatch):
    root = tmp_path / "medi"
    (root / "reports").mkdir(parents=True)
    (root / "reports" / "Ramesh CBC report 2025.pdf").write_bytes(b"%PDF-1.4")
    (root / "reports" / "lipid_profile_sita.pdf").write_bytes(b"%PDF-1.4")
    (root / "reports" / "notes.exe").write_bytes(b"MZ")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "cbc_hidden.pdf").write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(get_settings(), "file_search_roots", str(root))
    return root


def test_fuzzy_match_and_token(tmp_path, monkeypatch):
    root = _setup(tmp_path, monkeypatch)
    r = ff.find_files(str(root), "ramesh cbc")
    assert r["candidates"][0]["name"] == "Ramesh CBC report 2025.pdf" and r["confident"]
    p = ff.path_for_token(r["candidates"][0]["token"])
    assert p is not None and p.name.startswith("Ramesh")
    names = [c["name"] for c in ff.find_files(str(root), "cbc")["candidates"]]
    assert "cbc_hidden.pdf" not in names  # dependency folders skipped


def test_disallowed_types_and_folders(tmp_path, monkeypatch):
    root = _setup(tmp_path, monkeypatch)
    names = [c["name"] for c in ff.find_files(str(root), "")["candidates"]]
    assert "notes.exe" not in names
    other = tmp_path / "secret"
    other.mkdir()
    (other / "x.pdf").write_bytes(b"%PDF")
    # outside allowed roots (tmp_path itself is not a root) -> refused
    assert ff.find_files(str(other), "x")["candidates"] == []


def test_bad_token():
    assert ff.path_for_token("nope") is None


def test_location_synonyms():
    dirs, _ = ff.resolve_location("downloads")
    assert all(d.name == "Downloads" for d in dirs)
    dirs, _ = ff.resolve_location("d drive medi")
    assert dirs == [] or str(dirs[0]).lower().startswith("d:\\medi")
