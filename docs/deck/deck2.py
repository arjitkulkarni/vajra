# -*- coding: utf-8 -*-
"""VAJRA deck - slides 4, 5, 6 and the build entry point."""
from pptx import Presentation
from pptx.util import Inches as In, Pt
from pptx.enum.shapes import MSO_SHAPE
from kit import *
from deck import new_slide, panel, slide1, slide2, slide3, OUT

# ============================== slide 4 ==============================
FEAS = [(ic_code, "Technical",
         "Mature Next.js / Fabric / ONNX stack. Already built end to end — not a plan."),
        (ic_cloud, "Operational",
         "API-first over HR, IAM, ERP and PLM. Removes the credential store instead of adding one."),
        (ic_lock_ok, "Economic",
         "Zero gas, free-tier database and pinning. Under ₹5,000 / month at pilot scale.")]

COSTS = [("Ledger (Fabric)", "₹0"), ("Database (Neon free tier)", "₹0"),
         ("Storage (IPFS / Pinata)", "₹0"), ("Compute + bandwidth", "< ₹5,000")]

CHAL = [("Deepfake & spoofing", "Six physics signals + an independent AI anti-spoof gate"),
        ("Latency at scale", "Pure decision under 300 ms · anchoring is asynchronous"),
        ("Privacy & DPDP", "Match runs on device — only a 0–100 score crosses the wire"),
        ("Legacy adoption", "API-first over the systems already running. Days, not months"),
        ("Ledger outage", "Fails closed with a named reason; safe reads keep working")]

LIMITS = ["lite ledger runs identical chaincode, but is not consensus",
          "key-encryption key in an env var today — KMS / HSM next",
          "on-device match trusts the client — WebAuthn co-sign is the fix",
          "liveness beats print and replay; deepfake video is roadmap"]

METRICS = [("35,109", "lines of code"), ("117", "unit tests"), ("87", "e2e assertions"),
           ("59", "API endpoints"), ("27", "database tables"), ("5", "smart contracts"),
           ("3", "languages"), ("<300 ms", "decision latency")]


def slide4(prs):
    sl = new_slide(prs, "Feasibility and Viability", 4,
                   "₹0 gas fees  ·  Fails closed, never open  ·  Days, not months to integrate")

    # ---- col 1 : feasibility + cost
    x, w = M, 3.30
    eyebrow(sl, x, CY, w, "Feasibility")
    for i, (fn, name, det) in enumerate(FEAS):
        y = 1.76 + i * 0.86
        panel(sl, x, y, w, 0.78, PAPER2, RULE, 0.75, 0.05)
        circle(sl, x + 0.30, y + 0.26, 0.185, WHITE, BLUEL, 0.9)
        fn(sl, x + 0.30, y + 0.26, 0.115, BLUED)
        tb(sl, x + 0.58, y + 0.14, w - 0.70, 0.22,
           [P(name, SANS, 8.8, True, c=INK, ls=1.0)])
        tb(sl, x + 0.16, y + 0.42, w - 0.32, 0.34,
           [P(det, SANS, 7.3, c=INK3, ls=1.16)])

    cy0 = 1.76 + 3 * 0.86 + 0.12
    panel(sl, x, cy0, w, 1.46, WHITE, BLUEL, 1.0, 0.04)
    tb(sl, x + 0.16, cy0 + 0.12, w - 0.32, 0.2,
       [P("Q1 pilot — monthly infrastructure", SANS, 7.4, True, c=BLUED,
          spc=0.8, caps=True, ls=1.0)])
    for i, (k, v) in enumerate(COSTS):
        ry = cy0 + 0.38 + i * 0.21
        tb(sl, x + 0.16, ry, w - 1.10, 0.18, [P(k, SANS, 7.4, c=INK3, ls=1.0)])
        tb(sl, x + w - 0.94, ry, 0.78, 0.18,
           [P(v, SANS, 8.0, True, c=INK if i == 3 else BLUE, al='r', ls=1.0)])
    hr(sl, x + 0.16, cy0 + 1.20, w - 0.32, RULE2, 0.9)
    tb(sl, x + 0.16, cy0 + 1.25, w - 1.10, 0.18,
       [P("Total", SANS, 7.6, True, c=INK, ls=1.0)])
    tb(sl, x + w - 0.94, cy0 + 1.25, 0.78, 0.18,
       [P("< ₹5,000", SANS, 8.4, True, c=BLUE, al='r', ls=1.0)])

    # ---- col 2 : challenge -> solution
    cx0, cwid = 3.98, 4.86
    eyebrow(sl, cx0, CY, cwid, "Challenges → how we solve them")
    lw_, rw_ = 1.86, 2.56
    for i, (a, b) in enumerate(CHAL):
        y = 1.76 + i * 0.735
        rect(sl, cx0, y, lw_, 0.60, PAPER3, None, 0, 0.06)
        tb(sl, cx0 + 0.12, y + 0.06, lw_ - 0.24, 0.50,
           [P(a, SANS, 8.0, True, c=INK, al='c', ls=1.14)], anchor='m')
        arrow_r(sl, cx0 + lw_ + 0.06, y + 0.30, 0.32, BLUE, 1.3)
        rect(sl, cx0 + cwid - rw_, y, rw_, 0.60, BLUEXL, BLUEL, 0.9, 0.06)
        tb(sl, cx0 + cwid - rw_ + 0.12, y + 0.06, rw_ - 0.24, 0.50,
           [P(b, SANS, 7.6, c=BLUED, ls=1.16)], anchor='m')

    # ---- col 3 : scalability diagram + limits
    rx, rww = 9.14, SW - M - 9.14
    eyebrow(sl, rx, CY, rww, "Scales horizontally")
    mid = rx + rww / 2
    ic_users(sl, mid, 1.90, 0.145, INK2)
    tb(sl, rx, 2.06, rww, 0.2, [P("Concurrent users", SANS, 7.2, True, c=INK2, al='c', ls=1.0)])
    arrow_d(sl, mid, 2.26, 0.20, BLUE, 1.2)
    chip(sl, mid - 1.16, 2.50, 2.32, 0.28, "Load balancer", BLUEXL, BLUEL, BLUED, 7.4)
    arrow_d(sl, mid, 2.80, 0.18, BLUE, 1.2)
    gw = (rww - 0.16) / 3
    for i in range(3):
        gx = rx + i * (gw + 0.08)
        rect(sl, gx, 3.00, gw, 0.34, BLUE, None, 0, 0.10)
        tb(sl, gx, 3.08, gw, 0.2, [P("Gateway", SANS, 7.0, True, c=WHITE, al='c', ls=1.0)])
    arrow_d(sl, mid, 3.36, 0.18, BLUE, 1.2)
    for i, t in enumerate(["Postgres", "Risk workers", "Fabric", "IPFS"]):
        sx = rx + (i % 2) * (rww / 2 + 0.04)
        sy = 3.58 + (i // 2) * 0.34
        chip(sl, sx, sy, rww / 2 - 0.04, 0.28, t, WHITE, RULE2, INK2, 7.0)
    tb(sl, rx, 4.30, rww, 0.34,
       [P("Only hashes, proofs and decisions go on chain — assets stay off-chain.",
          SANS, 7.2, i=True, c=INK3, al='c', ls=1.16)])

    ly = 4.60
    eyebrow(sl, rx, ly, rww, "Limits we state plainly")
    for i, t in enumerate(LIMITS):
        yy = ly + 0.34 + i * 0.265
        rect(sl, rx, yy + 0.055, 0.055, 0.055, DENY, None)
        tb(sl, rx + 0.16, yy - 0.01, rww - 0.16, 0.28,
           [P(t, SANS, 7.2, c=INK3, ls=1.14)])

    # ---- bottom band : proof it is built
    by = 5.98
    rect(sl, 0, by, SW, FOOT_Y - by, DEEP, None)
    tb(sl, M, by + 0.09, CW, 0.2,
       [P("Not slideware — what already runs, today, on a laptop with nothing installed",
          SANS, 7.4, True, c=BLUEM, spc=1.2, caps=True, ls=1.0)])
    tw = CW / 8.0
    for i, (v, l) in enumerate(METRICS):
        mx = M + i * tw
        if i:
            vr(sl, mx - 0.02, by + 0.32, 0.46, DEEP3, 0.8)
        tb(sl, mx + 0.08, by + 0.32, tw - 0.14, 0.28,
           [P(v, SANS, 16.0, True, c=WHITE, ls=1.0)])
        tb(sl, mx + 0.08, by + 0.62, tw - 0.14, 0.2,
           [P(l, SANS, 6.8, True, c="8FA1B1", spc=0.8, caps=True, ls=1.0)])
    return sl


# ============================== slide 5 ==============================
TRUST_T = ["08:00", "08:30", "09:15", "09:17", "09:18", "10:00", "11:00", "12:00"]
TRUST_V = [96, 82, 61, 42, 42, 47, 50, 60]
TRUST_W = ["baseline", "new location", "new device", "failed liveness",
           "DENIED", "device trusted", "clean activity", "manager approval"]

KPI = [("1", "5", "conditions checked\nper request"),
       ("~0%", "100%", "sensitive actions\nwith live proof"),
       ("120 hrs", "seconds", "forensic reconstruction\nof one incident"),
       ("gas", "₹0", "per-transaction\nblockchain fee")]

CARDS = [("Verify identity", "5 GATES",
          [("Employee ID", 1), ("ID document", 1), ("Face match  96", 1),
           ("Liveness  0.94", 1), ("DID signature", 1)],
          "DID issued · admin approval"),
         ("Asset passport", "CAD · HIGH",
          [("Owner verified", 1), ("4 versions anchored", 1), ("SHA-256 matched", 1),
           ("Trust  94 / 100", 2)],
          "Encrypted off-chain"),
         ("Risk & decision", "RISK 91",
          [("new_device", 0), ("impossible_travel", 0), ("trust  96 → 42", 0),
           ("DENIED · locked", 0)],
          "Incident INC-2042 opened")]

BEN_COLS = ["Enterprises", "Auditors", "Employees"]
BENEFITS = [("Security & trust", "No password breach surface", "Non-repudiable evidence",
             "Only you can authorise"),
            ("Compliance & audit", "Audit prep collapses", "Answers in seconds",
             "See who accessed what"),
            ("Cost efficiency", "No gas, serverless storage", "Cheaper to verify",
             "No new hardware or app"),
            ("Privacy by design", "No biometric honeypot", "Verify without raw data",
             "Face is never uploaded")]

ROADMAP = [("Q1", "Pilot in one DSU department — 500+ students onboarded"),
           ("Q2–Q3", "Multi-tenant SaaS · WebAuthn co-sign · OIDC + SCIM"),
           ("Q4", "Cross-chain verifier · ZK-audit · open-source verifier")]


def slide5(prs):
    sl = new_slide(prs, "Impact and Benefits", 5,
                   "Potential impact on the target audience  ·  Social, economic and operational benefits")

    # ---- hero chart : trust through an incident
    LX, LW = M, 6.08
    eyebrow(sl, LX, CY, LW, "Continuous trust, measured — an insider-threat incident")
    line_chart(sl, LX - 0.16, 1.66, LW + 0.30, 2.30, TRUST_T,
               [("Identity trust", TRUST_V), ("Step-up gate (65)", [65] * 8)],
               [BLUE, DENY], ymin=0, ymax=100, label_series=0, dash_idx=(1,), fsize=7.0)
    for i, wtxt in enumerate(TRUST_W):
        wx = LX + 0.30 + i * ((LW - 0.46) / 8.0)
        tb(sl, wx - 0.22, 3.98, (LW - 0.46) / 8.0 + 0.44, 0.30,
           [P(wtxt, SANS, 5.9, True, c=DENY if wtxt == "DENIED" else MUTED, al='c', ls=1.10)])
    tb(sl, LX, 4.30, LW, 0.2,
       [P("Every point writes a trust event with its reason. Below the gate, sensitive actions stop.",
          SANS, 7.4, i=True, c=INK3, al='c', ls=1.0)])

    # ---- KPI tiles
    eyebrow(sl, LX, 4.64, LW, "Impact (projected, Q1 pilot)")
    kw = (LW - 3 * 0.10) / 4
    for i, (a, b, lab) in enumerate(KPI):
        kx = LX + i * (kw + 0.10)
        panel(sl, kx, 5.02, kw, 1.14, PAPER2, RULE, 0.75, 0.05)
        tb(sl, kx, 5.12, kw, 0.24, [P(a, SANS, 10.5, True, c=MUTED, al='c', ls=1.0)])
        arrow_d(sl, kx + kw / 2, 5.36, 0.16, BLUEM, 1.2)
        tb(sl, kx, 5.54, kw, 0.28, [P(b, SANS, 15.5, True, c=BLUE, al='c', ls=1.0)])
        tb(sl, kx + 0.06, 5.84, kw - 0.12, 0.28,
           [P(lab, SANS, 6.6, True, c=INK2, al='c', ls=1.12)])

    # ---- right : UI cards
    RX, RW = 6.86, SW - M - 6.86
    eyebrow(sl, RX, CY, RW, "What the operator sees")
    cw = (RW - 2 * 0.11) / 3
    for ci, (title, tag, rows, foot) in enumerate(CARDS):
        cx = RX + ci * (cw + 0.11)
        panel(sl, cx, 1.70, cw, 2.32, WHITE, RULE2, 1.0, 0.03)
        rect(sl, cx, 1.70, cw, 0.30, DEEP if ci == 2 else BLUE, None)
        tb(sl, cx + 0.10, 1.775, cw - 0.20, 0.2,
           [P(title, SANS, 7.6, True, c=WHITE, ls=1.0)])
        tb(sl, cx + 0.10, 2.06, cw - 0.20, 0.18,
           [P(tag, SANS, 6.4, True, c=BLUEM if ci == 2 else BLUE, spc=0.8, caps=True, ls=1.0)])
        ry = 2.32
        for lab, mark in rows:
            if mark == 1:
                tick(sl, cx + 0.20, ry + 0.055, 0.055, BLUE, 1.3)
            elif mark == 0:
                circle(sl, cx + 0.195, ry + 0.055, 0.035, DENY, None)
            else:
                shape(sl, MSO_SHAPE.HEXAGON, cx + 0.145, ry + 0.005, 0.10, 0.10, None, BLUE, 1.0)
            tb(sl, cx + 0.34, ry - 0.005, cw - 0.44, 0.20,
               [P(lab, SANS, 7.0, c=INK2, ls=1.0)])
            ry += 0.235
        if ci == 1:
            bw = cw - 0.34
            rect(sl, cx + 0.17, ry + 0.02, bw, 0.085, PAPER3, None)
            rect(sl, cx + 0.17, ry + 0.02, bw * 0.94, 0.085, BLUE, None)
            for k in range(1, 7):
                vr(sl, cx + 0.17 + bw * k / 7.0, ry + 0.02, 0.085, WHITE, 0.8)
        hr(sl, cx + 0.10, 3.74, cw - 0.20, RULE, 0.75)
        tb(sl, cx + 0.10, 3.80, cw - 0.20, 0.20,
           [P(foot, SANS, 6.4, i=True, c=MUTED, ls=1.0)])

    # ---- right : benefits grid
    eyebrow(sl, RX, 4.18, RW, "Benefits")
    cols = [1.42, (RW - 1.42) / 3, (RW - 1.42) / 3, (RW - 1.42) / 3]
    xs, acc = [], RX
    for c in cols:
        xs.append(acc)
        acc += c
    hy = 4.52
    rect(sl, RX, hy, RW, 0.24, DEEP, None)
    for k, t in enumerate([""] + BEN_COLS):
        tb(sl, xs[k] + 0.08, hy + 0.055, cols[k] - 0.14, 0.18,
           [P(t, SANS, 6.8, True, c=WHITE, spc=0.8, caps=True, ls=1.0)])
    ry = hy + 0.24
    for i, row in enumerate(BENEFITS):
        rh = 0.36
        if i % 2 == 0:
            rect(sl, RX, ry, RW, rh, PAPER2, None)
        tb(sl, xs[0] + 0.08, ry + 0.10, cols[0] - 0.14, 0.20,
           [P(row[0], SANS, 7.2, True, c=INK, ls=1.0)])
        for k in range(3):
            tb(sl, xs[k + 1] + 0.08, ry + 0.10, cols[k + 1] - 0.14, 0.20,
               [P(row[k + 1], SANS, 6.9, c=INK3, ls=1.0)])
        ry += rh
        hr(sl, RX, ry, RW, RULE, 0.75)

    # ---- roadmap timeline band
    by = 6.28
    rect(sl, 0, by, SW, FOOT_Y - by, DEEP, None)
    tb(sl, M, by + 0.13, 1.85, 0.2,
       [P("12-month roadmap", SANS, 7.2, True, c=BLUEM, spc=1.1, caps=True, ls=1.0)])
    tx0, txw = M + 1.98, (SW - M - (M + 1.98))
    hr(sl, tx0, by + 0.21, txw - 0.10, DEEP3, 1.2)
    for i, (q, t) in enumerate(ROADMAP):
        px = tx0 + i * (txw / 3.0)
        circle(sl, px + 0.06, by + 0.21, 0.055, BLUEM, None)
        tb(sl, px + 0.16, by + 0.12, 0.72, 0.2, [P(q, SANS, 8.0, True, c=WHITE, ls=1.0)])
        tb(sl, px + 0.16, by + 0.34, txw / 3.0 - 0.28, 0.24,
           [P(t, SANS, 7.0, c="9FB0BF", ls=1.0)])
    return sl


# ============================== slide 6 ==============================
REFS = [("S. W. Rose et al.", "“Zero Trust Architecture,” NIST SP 800-207, 2020.",
         "nist.gov/publications/zero-trust-architecture"),
        ("W3C", "“Decentralized Identifiers (DIDs) v1.0,” Recommendation, 2022.",
         "w3.org/TR/did-core/"),
        ("W3C", "“Verifiable Credentials Data Model v2.0,” Recommendation, 2025.",
         "w3.org/TR/vc-data-model/"),
        ("ISO/IEC", "“Biometric Presentation Attack Detection — Part 3,” 30107-3:2023.",
         "iso.org/standard/79520.html"),
        ("L. Sun et al.", "“BPDAC: Blockchain-Based, Provenance-Enabled Dynamic Access Control,” IEEE Access, 2023.",
         "doi.org/10.1109/ACCESS.2023.3340887"),
        ("Hyperledger Foundation", "“Hyperledger Fabric Documentation,” v2.5 LTS.",
         "hyperledger-fabric.readthedocs.io/"),
        ("M. Kim, A. K. Jain, X. Liu", "“AdaFace: Quality Adaptive Margin for Face Recognition,” CVPR 2022.",
         "github.com/mk-minchul/AdaFace"),
        ("MiniVision AI", "“Silent-Face-Anti-Spoofing (MiniFASNetV2),” Apache-2.0.",
         "github.com/minivision-ai/Silent-Face-Anti-Spoofing")]

STANDARDS = [(ic_shield, "NIST SP 800-207", "Continuous evaluation, and fail closed."),
             (ic_identity, "W3C DID 1.0 + VC 2.0", "did:key in the browser, EdDSA credentials."),
             (ic_face_alert, "ISO/IEC 30107-3", "Attack detection measured, never assumed."),
             (ic_lock_ok, "DPDP Act, 2023", "Matching on device; evidence encrypted.")]

ARTEFACTS = [("ARCHITECTURE.md", "engines, flows, data model, threat model"),
             ("docs/HOW-IT-IS-BUILT.md", "how the code is put together, and its limits"),
             ("docs/demo-script.md", "five-minute run-of-show with failure drills"),
             ("pnpm test · pnpm e2e", "117 unit tests · 87 end-to-end assertions")]


def slide6(prs):
    sl = new_slide(prs, "Research and References", 6,
                   "Details and links of the reference and research work")

    LX, LW = M, 8.02
    eyebrow(sl, LX, CY, LW, "References")
    cw = (LW - 0.16) / 2
    for i, (au, ti, url) in enumerate(REFS):
        cx = LX + (i % 2) * (cw + 0.16)
        cy = 1.74 + (i // 2) * 1.02
        tb(sl, cx, cy, 0.32, 0.2, [P("[%d]" % (i + 1), SANS, 8.0, True, c=BLUE, ls=1.0)])
        tb(sl, cx + 0.36, cy - 0.015, cw - 0.36, 0.86,
           [P(au, SANS, 8.0, True, c=INK, ls=1.14),
            P(ti, SANS, 7.6, c=INK3, ls=1.18),
            P(url, MONO, 6.8, c=BLUE, ls=1.16)])
        if i < 6:
            hr(sl, cx, cy + 0.88, cw - 0.06, RULE, 0.75)

    ay = 5.82
    eyebrow(sl, LX, ay, LW, "Artefacts a judge can open in this repository")
    for i, (n, d) in enumerate(ARTEFACTS):
        px = LX + (i % 2) * (cw + 0.16)
        py = ay + 0.38 + (i // 2) * 0.30
        tb(sl, px, py, 1.90, 0.2, [P(n, MONO, 7.4, True, c=INK, ls=1.0)])
        tb(sl, px + 1.96, py + 0.005, cw - 1.96, 0.24,
           [P(d, SANS, 7.2, c=INK3, ls=1.0)])

    RX, RW = 8.72, SW - M - 8.72
    eyebrow(sl, RX, CY, RW, "Standards we build to")
    for i, (fn, n, d) in enumerate(STANDARDS):
        y = 1.74 + i * 1.00
        panel(sl, RX, y, RW, 0.86, PAPER2, RULE, 0.75, 0.05)
        circle(sl, RX + 0.32, y + 0.28, 0.20, WHITE, BLUEL, 0.9)
        fn(sl, RX + 0.32, y + 0.28, 0.125, BLUED)
        tb(sl, RX + 0.62, y + 0.15, RW - 0.72, 0.24,
           [P(n, SANS, 8.4, True, c=INK, ls=1.0)])
        tb(sl, RX + 0.16, y + 0.46, RW - 0.32, 0.32,
           [P(d, SANS, 7.2, c=INK3, ls=1.14)])

    qy = 1.74 + 4 * 1.00 + 0.10
    panel(sl, RX, qy, RW, 6.86 - qy, BLUEXL, BLUEL, 0.9, 0.04)
    tb(sl, RX + 0.18, qy + 0.12, RW - 0.36, 0.72,
       [P("“VAJRA doesn’t just control who can access an asset — it proves who accessed it, why they were allowed, and whether the asset can still be trusted.”",
          SERIF, 9.8, i=True, c=INK2, ls=1.24)])
    tb(sl, RX + 0.18, qy + 0.74, RW - 0.36, 0.2,
       [P("The CodePool  ·  Dayananda Sagar University", SANS, 7.2, True, c=BLUED,
          spc=1.0, caps=True, ls=1.0)])
    return sl


# ============================== build ==============================
def build():
    prs = Presentation()
    prs.slide_width, prs.slide_height = In(SW), In(SH)
    for fn in (slide1, slide2, slide3, slide4, slide5, slide6):
        fn(prs)
    cp = prs.core_properties
    cp.title = "VAJRA — Verifiable Authority & Zero-Trust Resource Architecture"
    cp.author = "The CodePool — Dayananda Sagar University"
    cp.subject = "Smart India Hackathon 2026 · PS SIH26125 · Idea Submission"
    prs.save(OUT)
    print("saved:", OUT)


if __name__ == "__main__":
    build()
