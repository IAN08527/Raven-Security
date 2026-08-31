"""Generate authentic sample FIR PDF documents for testing Raven's OCR & NLP extraction UI."""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY


def create_fir_124(output_path: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40,
    )
    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "GovTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0f172a"),
    )
    sub_title_style = ParagraphStyle(
        "GovSubTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#334155"),
    )
    badge_style = ParagraphStyle(
        "BadgeText",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#b91c1c"),
    )
    section_heading = ParagraphStyle(
        "SecHead",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#1e293b"),
    )
    body_text = ParagraphStyle(
        "BodyTextCustom",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        alignment=TA_JUSTIFY,
        textColor=colors.HexColor("#0f172a"),
    )
    mono_text = ParagraphStyle(
        "MonoText",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
    )

    story = []

    # Header
    story.append(Paragraph("GOVERNMENT OF MAHARASHTRA — POLICE DEPARTMENT", title_style))
    story.append(Paragraph("FIRST INFORMATION REPORT (Under Section 154 Cr.P.C.)", sub_title_style))
    story.append(Paragraph("CRIME BRANCH & CYBER CRIME INVESTIGATION CELL", sub_title_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0f172a"), spaceAfter=10))

    # Top metadata table
    meta_data = [
        [
            Paragraph("<b>District:</b> Mumbai City", body_text),
            Paragraph("<b>Police Station:</b> Cyber-Crime PS", body_text),
            Paragraph("<b>Year:</b> 2026", body_text),
        ],
        [
            Paragraph("<b>FIR No:</b> 124/2026", section_heading),
            Paragraph("<b>Date & Time of FIR:</b> 14-08-2026 11:30 hrs", body_text),
            Paragraph("<b>General Diary Ref:</b> GD-441/2026", body_text),
        ],
    ]
    meta_table = Table(meta_data, colWidths=[175, 185, 172])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10))

    # Acts & Sections
    story.append(Paragraph("1. ACTS AND SECTIONS CHARGED", section_heading))
    acts_data = [
        [
            Paragraph("<b>Act Name</b>", body_text),
            Paragraph("<b>Sections Charged</b>", body_text),
        ],
        [
            Paragraph("Indian Penal Code (IPC)", body_text),
            Paragraph("<b>Section 420, Section 406, Section 34</b> (Cheating & Criminal Breach of Trust)", body_text),
        ],
        [
            Paragraph("Information Technology Act 2000", body_text),
            Paragraph("<b>Section 66C, Section 66D</b> (Identity Theft & Cheating by Personation)", body_text),
        ],
    ]
    acts_table = Table(acts_data, colWidths=[200, 332])
    acts_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(acts_table)
    story.append(Spacer(1, 10))

    # Complainant Details
    story.append(Paragraph("2. DETAILS OF COMPLAINANT / INFORMANT", section_heading))
    comp_data = [
        [
            Paragraph("<b>Full Name:</b> Amit Sharma", body_text),
            Paragraph("<b>Age / Gender:</b> 34 Yrs / Male", body_text),
        ],
        [
            Paragraph("<b>Contact Phone:</b> 9820012345", body_text),
            Paragraph("<b>Address:</b> 12 Nehru Nagar, Kurla West, Mumbai - 400070", body_text),
        ],
    ]
    comp_table = Table(comp_data, colWidths=[240, 292])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 10))

    # Suspects / Accused Details
    story.append(Paragraph("3. DETAILS OF KNOWN / SUSPECTED / ACCUSED PERSONS", section_heading))
    acc_text = (
        "<b>Accused:</b> (1) Rakesh Singh (Mastermind / Phone Operator), "
        "(2) M/s QuickPay Solutions Pvt Ltd (Shell Entity), "
        "(3) Priya Nair (Account Holder & Facilitator)"
    )
    story.append(Paragraph(acc_text, body_text))
    story.append(Spacer(1, 6))

    # Identifiers & Evidence Items Table
    ident_data = [
        [
            Paragraph("<b>Type</b>", body_text),
            Paragraph("<b>Identifier / Value</b>", body_text),
            Paragraph("<b>Linked Person / Entity</b>", body_text),
        ],
        [
            Paragraph("Phone Number", body_text),
            Paragraph("<font color='#0369a1'><b>9820012345</b></font>", mono_text),
            Paragraph("Amit Sharma (Complainant)", body_text),
        ],
        [
            Paragraph("Phone Number", body_text),
            Paragraph("<font color='#b91c1c'><b>9900098765</b></font>", mono_text),
            Paragraph("Rakesh Singh (Accused)", body_text),
        ],
        [
            Paragraph("Bank Account", body_text),
            Paragraph("<b>HDFC Account No. 501001234567</b>", mono_text),
            Paragraph("Priya Nair (Accused)", body_text),
        ],
        [
            Paragraph("UPI ID", body_text),
            Paragraph("<b>quickpay@oksbi</b>", mono_text),
            Paragraph("QuickPay Solutions Pvt Ltd", body_text),
        ],
        [
            Paragraph("Vehicle Plate", body_text),
            Paragraph("<b>MH01AB1234</b> (White Sedan)", mono_text),
            Paragraph("Rakesh Singh (Accused)", body_text),
        ],
    ]
    ident_table = Table(ident_data, colWidths=[120, 230, 182])
    ident_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(ident_table)
    story.append(Spacer(1, 10))

    # Statement & Narrative
    story.append(Paragraph("4. BRIEF FACTS OF THE INCIDENT / STATEMENT OF COMPLAINANT", section_heading))
    narrative = (
        "On 14-08-2026, the complainant Amit Sharma reported that on 13-08-2026 evening he received multiple "
        "solicitation calls from mobile number <b>9900098765</b> operated by accused <b>Rakesh Singh</b>. "
        "The caller impersonated an authorized investment broker from <b>QuickPay Solutions Pvt Ltd</b> and induced "
        "the complainant to transfer a sum of <b>INR 2,40,000/-</b> via UPI handle <b>quickpay@oksbi</b> to "
        "beneficiary bank <b>HDFC Account 501001234567</b> under the name of <b>Priya Nair</b>. "
        "Upon realization of deception, complainant attempted contact but accused switched off all terminals. "
        "CCTV footage and CDR triangulation confirm accused vehicle <b>MH01AB1234</b> at the staging location. "
        "Immediate freeze request sent to nodal bank officer."
    )
    story.append(Paragraph(narrative, body_text))
    story.append(Spacer(1, 15))

    # Signature Block
    sig_data = [
        [
            Paragraph("<b>Signature / Thumb Impression of Informant:</b><br/><br/><i>Amit Sharma</i>", body_text),
            Paragraph("<b>Investigating Officer (IO):</b><br/><br/><b>Insp. V. K. Jadhav</b><br/>Cyber-Crime Police Station, Mumbai", body_text),
        ]
    ]
    sig_table = Table(sig_data, colWidths=[260, 272])
    sig_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#fafafa")),
    ]))
    story.append(sig_table)

    doc.build(story)
    print(f"Generated: {output_path}")


def create_fir_102(output_path: str):
    """Generate FIR-102/2024 matching the Dharavi case for deep graph/profile alignment."""
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40,
    )
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "GovTitle2", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=13, leading=16, alignment=TA_CENTER, textColor=colors.HexColor("#0f172a"),
    )
    sub_title_style = ParagraphStyle(
        "GovSubTitle2", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10, leading=13, alignment=TA_CENTER, textColor=colors.HexColor("#334155"),
    )
    section_heading = ParagraphStyle(
        "SecHead2", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=10, leading=13, textColor=colors.HexColor("#1e293b"),
    )
    body_text = ParagraphStyle(
        "BodyTextCustom2", parent=styles["Normal"], fontName="Helvetica",
        fontSize=9, leading=13, alignment=TA_JUSTIFY, textColor=colors.HexColor("#0f172a"),
    )
    mono_text = ParagraphStyle(
        "MonoText2", parent=styles["Normal"], fontName="Courier",
        fontSize=8.5, leading=11, textColor=colors.HexColor("#0f172a"),
    )

    story = []

    # Header
    story.append(Paragraph("GOVERNMENT OF MAHARASHTRA — POLICE DEPARTMENT", title_style))
    story.append(Paragraph("FIRST INFORMATION REPORT (Under Sec 154 Cr.P.C.)", sub_title_style))
    story.append(Paragraph("DHARAVI POLICE STATION, CENTRAL ZONE, MUMBAI", sub_title_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0f172a"), spaceAfter=10))

    meta_data = [
        [
            Paragraph("<b>District:</b> Mumbai Central", body_text),
            Paragraph("<b>Police Station:</b> Dharavi Police Station", body_text),
            Paragraph("<b>Year:</b> 2024", body_text),
        ],
        [
            Paragraph("<b>FIR No:</b> 102/2024", section_heading),
            Paragraph("<b>Date & Time:</b> 2024-03-12 21:45 IST", body_text),
            Paragraph("<b>Case Reference:</b> OP-RAVEN-01", body_text),
        ],
    ]
    meta_table = Table(meta_data, colWidths=[175, 185, 172])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 10))

    # Acts & Sections
    story.append(Paragraph("1. ACTS AND SECTIONS CHARGED", section_heading))
    acts_data = [
        [
            Paragraph("<b>Statutory Act</b>", body_text),
            Paragraph("<b>Sections Applied</b>", body_text),
        ],
        [
            Paragraph("Indian Penal Code (IPC)", body_text),
            Paragraph("<b>Section 302, Section 384, Section 120B</b> (Murder, Extortion, Criminal Conspiracy)", body_text),
        ],
        [
            Paragraph("Indian Arms Act", body_text),
            Paragraph("<b>Section 25</b> (Unlawful Possession of Prohibited Firearms)", body_text),
        ],
    ]
    acts_table = Table(acts_data, colWidths=[200, 332])
    acts_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(acts_table)
    story.append(Spacer(1, 10))

    # Accused List
    story.append(Paragraph("2. DETAILS OF ACCUSED & SYNDICATE MEMBERS", section_heading))
    acc_text = (
        "<b>Accused:</b> (1) Rakesh Sawant (Alias Ricky - Syndicate Leader), "
        "(2) Vikram Patel (Alias Vicky - Hawala Facilitator), "
        "(3) Mohd. Khan (Alias Bhai - Logistics & Weapon Handler)"
    )
    story.append(Paragraph(acc_text, body_text))
    story.append(Spacer(1, 6))

    ident_data = [
        [
            Paragraph("<b>Role / Designation</b>", body_text),
            Paragraph("<b>Accused Full Name</b>", body_text),
            Paragraph("<b>Identified Assets / Phone / Vehicle</b>", body_text),
        ],
        [
            Paragraph("Main Accused", body_text),
            Paragraph("<b>Rakesh Sawant</b> (Ricky)", body_text),
            Paragraph("Phone: <b>9821098765</b> | Vehicle: <b>MH02AB1234</b>", mono_text),
        ],
        [
            Paragraph("Hawala Facilitator", body_text),
            Paragraph("<b>Vikram Patel</b> (Vicky)", body_text),
            Paragraph("Phone: <b>9833112233</b> | Bank A/C: <b>909201004455</b>", mono_text),
        ],
        [
            Paragraph("Logistics Provider", body_text),
            Paragraph("<b>Mohd. Khan</b> (Bhai)", body_text),
            Paragraph("Phone: <b>9769001122</b> | Location: Dharavi 90-ft Rd", mono_text),
        ],
    ]
    ident_table = Table(ident_data, colWidths=[130, 170, 232])
    ident_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story.append(ident_table)
    story.append(Spacer(1, 10))

    # Narrative
    story.append(Paragraph("3. INCIDENT SUMMARY & INTELLIGENCE BRIEF", section_heading))
    narrative = (
        "On the evening of 12th March 2024 at approx 21:45 hrs, a secret intelligence report confirmed that "
        "members of the organized extortion syndicate led by accused <b>Rakesh Vijay Sawant (Alias Ricky)</b> "
        "convened an armed conspiracy meeting at a commercial warehouse in Dharavi Cross Lane. "
        "Co-conspirators <b>Vikram Patel</b> and <b>Mohd. Khan</b> were documented co-located at the scene via cell "
        "tower triangulation and intercepted communication. Physical surveillance confirmed vehicle <b>MH02AB1234</b> "
        "arriving at the location. During the encounter, illegal 9mm firearms and hawala cash receipts amounting to "
        "INR 24,00,000/- were recovered. Primary suspect detained on spot under Arms Act."
    )
    story.append(Paragraph(narrative, body_text))
    story.append(Spacer(1, 15))

    # IO Endorsement
    sig_data = [
        [
            Paragraph("<b>Station Diary Entry:</b> SD-8842/2024<br/><b>Magistrate Court:</b> Esplanade Court, Mumbai", body_text),
            Paragraph("<b>Investigating Officer (IO):</b><br/><b>Inspector A. Kumar</b><br/>Crime Branch Unit 3, Mumbai", body_text),
        ]
    ]
    sig_table = Table(sig_data, colWidths=[260, 272])
    sig_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#fafafa")),
    ]))
    story.append(sig_table)

    doc.build(story)
    print(f"Generated: {output_path}")


if __name__ == "__main__":
    tools_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.join(os.path.dirname(tools_dir), "assets")
    os.makedirs(assets_dir, exist_ok=True)

    create_fir_124(os.path.join(tools_dir, "sample_fir.pdf"))
    create_fir_124(os.path.join(assets_dir, "sample_fir_124.pdf"))
    create_fir_102(os.path.join(assets_dir, "sample_fir_102.pdf"))
