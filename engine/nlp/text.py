"""Text extraction for the ingest pipeline (architecture §5.1).

Digital PDFs with an embedded text layer are extracted directly (no OCR, ~40x
faster). Scanned PDFs and images go through EasyOCR. Plain text is read as-is.
All heavy libraries (``pypdf``, ``easyocr``) are imported lazily so this module
can be loaded in environments where the ML stack is not installed.
"""
import os
from typing import Tuple


def _extract_pdf_text_layer(path: str) -> Tuple[str, list[dict]]:
    """Return (text, page_map) from a digital PDF's text layer, or ('', []) if
    the PDF has no usable text layer (caller then falls back to OCR)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            return "", []
    try:
        reader = PdfReader(path)
    except Exception:
        return "", []
    parts: list[str] = []
    page_map: list[dict] = []
    offset = 0
    for i, page in enumerate(reader.pages, start=1):
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if not t.strip():
            continue
        page_map.append({"page": i, "char_start": offset, "char_end": offset + len(t)})
        parts.append(t)
        offset += len(t)
    text = "\n".join(parts)
    return (text, page_map) if text.strip() else ("", [])


def _ocr(path: str, dpi: int) -> Tuple[str, list[dict]]:
    import easyocr

    reader = easyocr.Reader(["en"], gpu=False)
    result = reader.readtext(path, detail=1)
    text = "\n".join(line[1] for line in result)
    return text, [{"page": 1, "char_start": 0, "char_end": max(len(text), 1)}]


def extract_text(path: str, mime: str, dpi: int = 300) -> Tuple[str, list[dict]]:
    """Return ``(text, page_map)`` for a file given its magic-byte MIME type.

    ``page_map`` lets the UI map a character offset back to a source page.
    """
    if mime == "application/pdf":
        text, page_map = _extract_pdf_text_layer(path)
        if text.strip():
            return text, page_map
        # No text layer -> OCR the rendered pages.
        try:
            return _ocr(path, dpi)
        except Exception as e:
            return "", [{"error": str(e)}]
    if mime.startswith("image/"):
        try:
            return _ocr(path, dpi)
        except Exception as e:
            return "", [{"error": str(e)}]
    # Plain-text or unknown: read as UTF-8 (errors replaced).
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception:
        text = ""
    return text, [{"page": 1, "char_start": 0, "char_end": max(len(text), 1)}]
