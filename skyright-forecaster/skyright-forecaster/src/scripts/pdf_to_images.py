#!/usr/bin/env python3
"""Convert PDF pages to base64-encoded PNG images for Claude vision analysis."""
import sys
import json
import base64

def convert_pdf(pdf_path: str, max_pages: int = 20, scale: float = 1.5) -> list[dict]:
    try:
        import fitz
    except ImportError:
        return {"error": "PyMuPDF not installed. Run: pip3 install PyMuPDF"}

    doc = fitz.open(pdf_path)
    pages = []
    mat = fitz.Matrix(scale, scale)

    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        pages.append({
            "page": i + 1,
            "width": pix.width,
            "height": pix.height,
            "data": b64
        })

    doc.close()
    return pages


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pdf_to_images.py <pdf_path> [max_pages] [scale]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5

    result = convert_pdf(pdf_path, max_pages, scale)
    print(json.dumps(result))
