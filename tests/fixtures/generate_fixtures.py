import os
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
import docx

fixtures_dir = os.path.dirname(os.path.abspath(__file__))
os.makedirs(fixtures_dir, exist_ok=True)

# 1. Generate synthetic PDF for Spike A
pdf_path = os.path.join(fixtures_dir, "synthetic_spike_a.pdf")
doc = SimpleDocTemplate(pdf_path, pagesize=letter)
styles = getSampleStyleSheet()

story = []
story.append(Paragraph("<b>MASTER SERVICES AGREEMENT</b>", styles["Title"]))
story.append(Spacer(1, 12))
story.append(Paragraph("This Master Services Agreement is entered into between Client and Supplier.", styles["Normal"]))
story.append(Spacer(1, 12))
story.append(Paragraph("<b>Section 1. Scope of Work</b>", styles["Heading2"]))
story.append(Paragraph("1. Supplier shall provide software development and consulting services.", styles["Normal"]))
story.append(Paragraph("2. Deliverables shall be provided in accordance with the project schedule.", styles["Normal"]))
story.append(Spacer(1, 12))
story.append(Paragraph("<b>Section 2. Limitation of Liability</b>", styles["Heading2"]))
story.append(Paragraph("Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.", styles["Normal"]))
story.append(Spacer(1, 12))
story.append(Paragraph("<b>Section 3. Payment Schedule</b>", styles["Heading2"]))

table_data = [
    ["Milestone", "Deliverable", "Amount (AED)"],
    ["1", "Initial Architecture & Spike", "25,000"],
    ["2", "Core Ingestion Engine", "35,000"],
    ["3", "Final Acceptance & Deployment", "40,000"],
]
table = Table(table_data, colWidths=[80, 260, 100])
table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
    ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
    ('ALIGN', (0,0), (-1,-1), 'LEFT'),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('BOTTOMPADDING', (0,0), (-1,0), 6),
    ('GRID', (0,0), (-1,-1), 1, colors.grey),
]))
story.append(table)

doc.build(story)
print(f"Generated PDF: {pdf_path}")

# 2. Generate synthetic DOCX for Spike B
docx_path = os.path.join(fixtures_dir, "synthetic_spike_b.docx")
doc_docx = docx.Document()

doc_docx.add_heading("MASTER SERVICES AGREEMENT", level=0)
p1 = doc_docx.add_paragraph("This Master Services Agreement is entered into between Client and Supplier.")

h1 = doc_docx.add_heading("Section 1. Scope of Work", level=1)
doc_docx.add_paragraph("1. Supplier shall provide software development and consulting services.")
doc_docx.add_paragraph("2. Deliverables shall be provided in accordance with the project schedule.")

h2 = doc_docx.add_heading("Section 2. Limitation of Liability", level=1)
p_liability = doc_docx.add_paragraph("Supplier's aggregate liability under this Agreement shall not exceed AED 100,000.")

h3 = doc_docx.add_heading("Section 3. Payment Schedule", level=1)
t = doc_docx.add_table(rows=1, cols=3)
hdr_cells = t.rows[0].cells
hdr_cells[0].text = "Milestone"
hdr_cells[1].text = "Deliverable"
hdr_cells[2].text = "Amount (AED)"

milestones = [
    ("1", "Initial Architecture & Spike", "25,000"),
    ("2", "Core Ingestion Engine", "35,000"),
    ("3", "Final Acceptance & Deployment", "40,000"),
]
for m, d, a in milestones:
    row_cells = t.add_row().cells
    row_cells[0].text = m
    row_cells[1].text = d
    row_cells[2].text = a

doc_docx.save(docx_path)
print(f"Generated DOCX: {docx_path}")
