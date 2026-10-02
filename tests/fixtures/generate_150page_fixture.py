import io
import sys
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import cm

W, H = A4

def generate_150_page_pdf(output_path):
    c = canvas.Canvas(output_path, pagesize=A4)

    for p in range(1, 151):
        c.setFont("Helvetica-Bold", 12)
        c.drawString(2 * cm, H - 2 * cm, f"Standard Enterprise Master Agreement — Page {p}")

        c.setFont("Helvetica", 10)
        y = H - 3.2 * cm

        lines = [
            f"Section {p}.1 Obligations and Scope of Engagement.",
            f"The Service Provider covenants to perform the specified services for Period {p} in strict compliance",
            "with all professional standards, industry certifications, and applicable federal and local regulations.",
            "",
            f"Section {p}.2 Operational Standards and Governance.",
            "All deliverables, work products, source materials, and interim progress reports must be submitted",
            "through the approved corporate communications channel subject to dual-key verification.",
            "",
            f"Section {p}.3 Financial Covenants and Audit Protocols.",
            f"The Service Provider shall maintain complete and accurate financial records pertaining to Transaction {p}.",
            "All billable expenses, travel costs, and ancillary overhead allocations must be documented and retained.",
            "",
            f"Section {p}.4 Confidentiality and Data Safeguards.",
            "Each recipient party agrees to hold all proprietary technical designs, trade secrets, and financial models",
            "in strict confidence and shall not disclose such materials to any unauthorized third party without prior consent.",
        ]

        # On page 115, insert the known termination clause split cleanly across lines so it fits A4 width
        if p == 115:
            lines.extend([
                "",
                "Section 115.5 Special Termination Provisions.",
                "Either party may terminate this Agreement immediately by written notice",
                "if the other party breaches any material term and fails to remedy such breach",
                "within thirty days of receiving written notice thereof.",
            ])

        for line in lines:
            c.drawString(2 * cm, y, line)
            y -= 14

        # Footer
        c.setFont("Helvetica", 8)
        c.drawCentredString(W / 2, 1.5 * cm, f"Enterprise Master Agreement - Confidential - Page {p} of 150")

        c.showPage()

    c.save()
    print(f"Successfully generated {output_path} (150 pages)")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "large_150p.pdf")
    generate_150_page_pdf(out)
