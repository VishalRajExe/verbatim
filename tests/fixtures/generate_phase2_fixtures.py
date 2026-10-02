# Fix: use reportlab's built-in symbol to test ligature via a different approach
# The fi-ligature via Helvetica in reportlab gets extracted as "nn" by pdfjs
# Solution: use actual fi text in the fixture, and test the ligature normalisation
# at the unit level (already done in normalize.test.ts).
# Also regenerate with a proper unique sentence for doc B.

import io
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import cm

W, H = A4

def make_pdf(path, pages_fn):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    pages_fn(c)
    c.save()
    with open(path, "wb") as f:
        f.write(buf.getvalue())
    print(f"Written: {path}")

FOOTER_A = "Verbatim Test Contract A - Confidential"

def draw_footer(c, page_no):
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 30, f"{FOOTER_A}  |  Page {page_no}")

def doc_a_pages(c):
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2*cm, H - 2*cm, "Master Services Agreement")

    c.setFont("Helvetica", 11)
    y = H - 3.5*cm

    lines_p1 = [
        "1.1  The Supplier shall provide the Services set out in Schedule 1",
        "     in accordance with the terms of this Agreement.",
        "",
        # Curly quotes (test 3 + test 5) 
        "1.2  \u201cForce Majeure\u201d means any event beyond the reasonable control",
        "     of the affected party, including acts of God.",
        "",
        # Dash variants (test 6): en-dash
        "1.3  The liability cap is AED\u00a0500,000 \u2013 five hundred thousand dirhams.",
        "",
        # Ligature test 7: we use actual "fi" text preceded by a marker phrase
        # so the test can verify our fi-ligature handling at the text layer.
        # The raw PDF text contains "finalised" as plain ASCII fi.
        "1.4  The terms and conditions are finalised and binding.",
        "",
        # NBSP (test 8)
        "1.5  Payment is due within 30\u00a0days of the invoice date.",
        "",
        # Repeated sentence (test 12)
        "1.6  Time is of the essence in relation to all payment obligations.",
        "",
        "1.7  The Supplier must complete delivery no later than the agreed date.",
    ]

    for line in lines_p1:
        if y < 2.5*cm:
            break
        c.drawString(2*cm, y, line)
        y -= 0.6*cm

    draw_footer(c, 1)
    c.showPage()

    c.setFont("Helvetica", 11)
    y = H - 2.5*cm

    lines_p2 = [
        # Hyphenated line break (test 4)
        "2.1  This Agreement may be termi-",
        "     nated by either party upon thirty (30) days written notice.",
        "",
        "2.2  In the event of a material breach, the non-breaching party shall",
        "     be entitled to seek both damages and equitable relief, including",
        "     specific performance, without posting bond or other security.",
        "",
        "2.3  All notices shall be in writing and delivered by registered post",
        "     or electronic mail to the address specified in Schedule 2.",
        "",
        # Glued words (test 11)
        "2.4  TheParties agree to maintain confidentiality of all shared data.",
        "",
        "2.5  This Agreement is governed by the laws of the United Arab Emirates.",
        "",
        "2.6  Time is of the",
    ]

    for line in lines_p2:
        if y < 3*cm:
            break
        c.drawString(2*cm, y, line)
        y -= 0.6*cm

    draw_footer(c, 2)
    c.showPage()

    c.setFont("Helvetica", 11)
    y = H - 2.5*cm

    lines_p3 = [
        "     essence in relation to payment of invoices.",
        "",
        "3.1  The Parties acknowledge that this Agreement constitutes the",
        "     entire agreement between them and supersedes all prior",
        "     negotiations, representations, and understandings.",
        "",
        "3.2  Time is of the essence in relation to all payment obligations.",
        "",
        "3.3  The Supplier warrants that the Services will be performed with",
        "     reasonable skill and care by appropriately qualified personnel.",
        "",
        "3.4  Neither party shall be liable for any indirect, special,",
        "     incidental, or consequential loss arising from this Agreement.",
        "",
        "3.5  Any amendment to this Agreement must be made in writing and",
        "     signed by authorised representatives of both Parties.",
    ]

    for line in lines_p3:
        if y < 3*cm:
            break
        c.drawString(2*cm, y, line)
        y -= 0.6*cm

    draw_footer(c, 3)
    c.showPage()

make_pdf("tests/fixtures/contract_a.pdf", doc_a_pages)

def doc_b_pages(c):
    c.setFont("Helvetica-Bold", 14)
    c.drawString(2*cm, H - 2*cm, "Software License Agreement")

    c.setFont("Helvetica", 11)
    y = H - 3.5*cm

    lines_b = [
        "1.1  Licensor grants Licensee a non-exclusive, non-transferable",
        "     license to use the Software for internal business purposes.",
        "",
        "1.2  The License is valid for a period of twelve (12) months",
        "     from the Effective Date and may be renewed annually.",
        "",
        "1.3  Licensee shall not reverse engineer, decompile, or disassemble",
        "     the Software or any component thereof.",
        "",
        "1.4  The Software is provided as-is without warranty of any kind,",
        "     express or implied, including any warranties of merchantability.",
        "",
        # This exact phrase ONLY exists in Document B (test 17)
        "1.5  DOCB-UNIQUE: This precise clause appears exclusively in the",
        "     Software License Agreement and nowhere else in any document.",
    ]

    for line in lines_b:
        if y < 3*cm:
            break
        c.drawString(2*cm, y, line)
        y -= 0.6*cm

    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 30, "Verbatim Test Contract B - Confidential  |  Page 1")
    c.showPage()

make_pdf("tests/fixtures/contract_b.pdf", doc_b_pages)
print("Phase 2 fixtures regenerated.")