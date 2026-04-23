"""
Build the branded Skitza Contributor Onboarding PDF.

Usage:
    python3 scripts/build-onboarding-pdf.py

Output:
    ./skitza-onboarding-guide.pdf

Design:
    - Cover page with brand colors (cream + amber)
    - Clickable table of contents (jumps to each section)
    - 15 sections of content matching docs/contributor-onboarding.md
    - Monospace code blocks with subtle background
    - Page header + footer with page numbers on body pages
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

# ─── Brand constants ──────────────────────────────────────────────────────

CREAM = colors.HexColor("#FBF7F0")
AMBER = colors.HexColor("#A25A28")
AMBER_SOFT = colors.HexColor("#C47A4A")
INK = colors.HexColor("#1A1714")
MUTED = colors.HexColor("#6B6158")
BORDER = colors.HexColor("#E6DFD2")
CODE_BG = colors.HexColor("#F5EFE3")

PAGE_W, PAGE_H = A4
MARGIN = 22 * mm

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "skitza-onboarding-guide.pdf"

# ─── Style sheet ──────────────────────────────────────────────────────────

styles = getSampleStyleSheet()

STYLES = {
    "cover_title": ParagraphStyle(
        name="CoverTitle",
        parent=styles["Title"],
        fontName="Times-Bold",
        fontSize=42,
        leading=48,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=8,
    ),
    "cover_subtitle": ParagraphStyle(
        name="CoverSubtitle",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=18,
        leading=24,
        textColor=AMBER,
        spaceAfter=24,
    ),
    "cover_tagline": ParagraphStyle(
        name="CoverTagline",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=11,
        leading=16,
        textColor=MUTED,
    ),
    "cover_meta": ParagraphStyle(
        name="CoverMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=MUTED,
    ),
    "h1": ParagraphStyle(
        name="H1",
        parent=styles["Heading1"],
        fontName="Times-Bold",
        fontSize=22,
        leading=28,
        textColor=INK,
        spaceBefore=12,
        spaceAfter=10,
        keepWithNext=True,
    ),
    "h2": ParagraphStyle(
        name="H2",
        parent=styles["Heading2"],
        fontName="Times-Bold",
        fontSize=14,
        leading=20,
        textColor=AMBER,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True,
    ),
    "h3": ParagraphStyle(
        name="H3",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=16,
        textColor=INK,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
    ),
    "body": ParagraphStyle(
        name="Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=15,
        textColor=INK,
        spaceAfter=8,
        alignment=TA_LEFT,
    ),
    "body_muted": ParagraphStyle(
        name="BodyMuted",
        parent=styles["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=9.5,
        leading=14,
        textColor=MUTED,
        spaceAfter=8,
    ),
    "bullet": ParagraphStyle(
        name="Bullet",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=15,
        leftIndent=14,
        firstLineIndent=-10,
        bulletIndent=0,
        textColor=INK,
        spaceAfter=3,
    ),
    "toc_entry": ParagraphStyle(
        name="TOCEntry",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=12,
        leading=22,
        textColor=INK,
        leftIndent=0,
    ),
    "code": ParagraphStyle(
        name="Code",
        parent=styles["Code"],
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        textColor=INK,
        backColor=CODE_BG,
        borderPadding=8,
        leftIndent=0,
        rightIndent=0,
        spaceBefore=6,
        spaceAfter=10,
    ),
    "quote": ParagraphStyle(
        name="Quote",
        parent=styles["BodyText"],
        fontName="Times-Italic",
        fontSize=11,
        leading=17,
        textColor=INK,
        leftIndent=16,
        rightIndent=16,
        spaceBefore=8,
        spaceAfter=10,
        borderColor=AMBER,
        borderPadding=10,
        borderWidth=0,
    ),
}


# ─── Page decorations ─────────────────────────────────────────────────────

def _cover_page(canvas, _doc):
    """Cover page has a full cream background and a hairline amber bar at top."""
    canvas.saveState()
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Thin amber accent bar at the top edge
    canvas.setFillColor(AMBER)
    canvas.rect(0, PAGE_H - 6 * mm, PAGE_W, 6 * mm, fill=1, stroke=0)
    # Footer meta line
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(
        MARGIN,
        18 * mm,
        "Skitza · Contributor onboarding · v1 · 2026-04-23 · Contact: Gili Asraf",
    )
    canvas.restoreState()


def _body_page(canvas, doc):
    """Regular body page: hairline top rule, footer with page number."""
    canvas.saveState()
    # Top rule
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, PAGE_H - MARGIN + 8 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 8 * mm)
    # Running header left
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(MARGIN, PAGE_H - MARGIN + 12 * mm, "Skitza · Contributor onboarding")
    # Running header right — amber accent dot
    canvas.setFillColor(AMBER)
    canvas.circle(PAGE_W - MARGIN, PAGE_H - MARGIN + 13 * mm, 1.5, fill=1, stroke=0)
    # Footer page number
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(PAGE_W / 2, 14 * mm, f"— {doc.page} —")
    canvas.restoreState()


# ─── Flowable helpers ─────────────────────────────────────────────────────

def h1(text, anchor=None):
    """Level-1 section heading. `anchor` creates a named destination for TOC links."""
    markup = f'<a name="{anchor}"/>{text}' if anchor else text
    return Paragraph(markup, STYLES["h1"])


def h2(text):
    return Paragraph(text, STYLES["h2"])


def h3(text):
    return Paragraph(text, STYLES["h3"])


def p(text):
    return Paragraph(text, STYLES["body"])


def muted(text):
    return Paragraph(text, STYLES["body_muted"])


def quote(text):
    return Paragraph(text, STYLES["quote"])


def bullet(text):
    return Paragraph(f"• {text}", STYLES["bullet"])


def code(text):
    return Preformatted(text, STYLES["code"])


def toc_entry(num, title, anchor):
    """Clickable TOC entry with section number, title, and a dotted leader."""
    dots = "." * max(3, 70 - len(f"{num}. {title}"))
    markup = (
        f'<link href="#{anchor}" color="#1A1714">'
        f'<b>{num}.</b>&nbsp;&nbsp;{title}'
        f'&nbsp;&nbsp;<font color="#C4B89F">{dots}</font>'
        f'&nbsp;&nbsp;<font color="#A25A28">→</font>'
        f'</link>'
    )
    return Paragraph(markup, STYLES["toc_entry"])


def spacer(h=8):
    return Spacer(1, h)


def divider():
    """Horizontal hairline."""
    t = Table([[""]], colWidths=[PAGE_W - 2 * MARGIN], rowHeights=[0.5])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER)]))
    return t


def table_2col(rows, col_widths=None, header=True):
    """Simple 2-column table with branded borders."""
    if col_widths is None:
        col_widths = [(PAGE_W - 2 * MARGIN) * 0.3, (PAGE_W - 2 * MARGIN) * 0.7]
    style_cmds = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER),
    ]
    if header:
        style_cmds.extend([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("TEXTCOLOR", (0, 0), (-1, 0), AMBER),
            ("LINEBELOW", (0, 0), (-1, 0), 1.2, AMBER),
        ])
    t = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
    t.setStyle(TableStyle(style_cmds))
    return t


def table_3col(rows, col_widths=None, header=True):
    if col_widths is None:
        total = PAGE_W - 2 * MARGIN
        col_widths = [total * 0.22, total * 0.28, total * 0.5]
    style_cmds = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER),
    ]
    if header:
        style_cmds.extend([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("TEXTCOLOR", (0, 0), (-1, 0), AMBER),
            ("LINEBELOW", (0, 0), (-1, 0), 1.2, AMBER),
        ])
    t = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
    t.setStyle(TableStyle(style_cmds))
    return t


def cell(text, style=None):
    return Paragraph(text, style or ParagraphStyle(
        name="Cell",
        fontName="Helvetica",
        fontSize=9,
        leading=13,
        textColor=INK,
    ))


# ─── Content ──────────────────────────────────────────────────────────────

SECTIONS = [
    ("What Skitza is", "sec1"),
    ("Tech stack", "sec2"),
    ("Repo layout", "sec3"),
    ("Running locally", "sec4"),
    ("How we work (non-negotiable)", "sec5"),
    ("Architecture at a glance", "sec6"),
    ("Crucial flows", "sec7"),
    ("Conventions", "sec8"),
    ("Testing discipline", "sec9"),
    ("Database + migrations", "sec10"),
    ("Deployment + environments", "sec11"),
    ("Observability", "sec12"),
    ("Current state", "sec13"),
    ("Tribal knowledge / gotchas", "sec14"),
    ("Where to ask for help", "sec15"),
]


def build_cover():
    return [
        Spacer(1, 60 * mm),
        Paragraph("Skitza", STYLES["cover_title"]),
        Paragraph("Contributor Onboarding Guide", STYLES["cover_subtitle"]),
        Spacer(1, 10 * mm),
        Paragraph(
            '<i>"The one app a solo music producer opens in the morning."</i>',
            STYLES["cover_tagline"],
        ),
        Spacer(1, 4 * mm),
        Paragraph(
            "Everything a new developer needs to know before writing a line of code.",
            STYLES["cover_tagline"],
        ),
        Spacer(1, 80 * mm),
        Paragraph("v1 · 2026-04-23", STYLES["cover_meta"]),
        Paragraph("Prepared for: our first human collaborator", STYLES["cover_meta"]),
        Paragraph("By: Gili Asraf + Claude", STYLES["cover_meta"]),
    ]


def build_intro():
    return [
        h1("Before you start"),
        p(
            "Welcome. You're walking into a project built in a slightly unusual way: "
            "the founder (Gili) is non-technical, the codebase is AI-maintained "
            "(Claude as the day-to-day engineer), and Gili is the product owner. "
            "You're being brought in as a human collaborator, which means two things "
            "matter from day one."
        ),
        spacer(),
        bullet(
            "<b>How we work is more important than what you already know.</b> "
            "The stack is pretty standard (Next.js, tRPC, Drizzle, Tailwind). "
            "The process around it — BMAD, TDD, observability-first debugging — "
            "is what keeps bugs low and Gili sane."
        ),
        bullet(
            "<b>Gili's time is the bottleneck.</b> Please route product decisions "
            "through Gili, not around them. If something feels like a judgement "
            "call, it probably is. Ask."
        ),
        spacer(10),
        p(
            "This guide is designed as a single front-to-back read for your first "
            "focused afternoon. Section 5 is the part you must not skip. After "
            "that, it becomes a reference — skim it, use the table of contents."
        ),
        p(
            'The same content lives in the repo at <font face="Courier">'
            "docs/contributor-onboarding.md</font> so it stays evergreen. Keep "
            "that as your source of truth after you clone."
        ),
        PageBreak(),
    ]


def build_toc():
    items = [Paragraph("Contents", STYLES["h1"])]
    items.append(Spacer(1, 12))
    items.append(muted("Click any entry to jump to that section."))
    items.append(Spacer(1, 16))
    for i, (title, anchor) in enumerate(SECTIONS, start=1):
        items.append(toc_entry(i, title, anchor))
    items.append(PageBreak())
    return items


def build_section_1():
    return [
        h1("1. What Skitza is", anchor="sec1"),
        p('<b>One line:</b> "The one app a solo music producer opens in the morning."'),
        p(
            "<b>The pitch.</b> Skitza replaces the Calendly + Samply + Notion + "
            "DocuSign + Stripe + WhatsApp stack with one product. A producer drops "
            "one permanent link (<font face=\"Courier\">skitza.app/p/&lt;slug&gt;</font>) "
            "in their Instagram bio. Artists click, listen to past work, sign up, "
            "and book a session. The contract, invoice, and project room materialize "
            "automatically. Zero manual client entry on the producer's side."
        ),
        h3("Two audiences, one codebase"),
        bullet(
            "<b>Producers</b> — authenticated app at "
            '<font face="Courier">/dashboard</font>. Four screens: Today, '
            "Projects, Music, Setup."
        ),
        bullet(
            "<b>Artists</b> — authenticated app at "
            '<font face="Courier">/artist</font>. Four tabs: Home, Music, Book, '
            "Store. Plus public surfaces at "
            '<font face="Courier">/p/&lt;slug&gt;</font> and '
            '<font face="Courier">/p/&lt;slug&gt;/book</font>.'
        ),
        spacer(8),
        p(
            "<b>Status:</b> Pre-launch. Soft launch targeted for late April / "
            "early May 2026 with the first 5 producers. Runway: about 3 months. "
            "Revenue by July 2026 is non-negotiable."
        ),
        p(
            '<b>Full product vision</b> lives in <font face="Courier">'
            "docs/product/PRD.md</font> — 27 sections, 70+ locked decisions. "
            'Treat the PRD as normative. The reasoning behind each decision is '
            'in <font face="Courier">docs/decisions/360-prd-answers.md</font> '
            "(a Socratic Q&amp;A trace)."
        ),
    ]


def build_section_2():
    rows = [
        [cell("<b>Layer</b>"), cell("<b>Choice</b>"), cell("<b>Why</b>")],
        [cell("Framework"), cell("Next.js 15 App Router"),
         cell("Server Components + server actions + route handlers are core to the architecture")],
        [cell("Language"), cell("TypeScript (strict)"),
         cell("<code>exactOptionalPropertyTypes: true</code> across the monorepo")],
        [cell("Monorepo"), cell("pnpm workspaces"),
         cell("apps/web + apps/desktop + packages/db")],
        [cell("Styling"), cell("Tailwind v4"),
         cell("All colors/radii/shadows via CSS custom properties — <b>no hex codes</b> (see §8)")],
        [cell("API"), cell("tRPC v11"),
         cell("Three procedure bases: <code>publicProcedure</code>, <code>producerProcedure</code>, <code>artistProcedure</code>")],
        [cell("Database"), cell("Drizzle ORM + Neon Postgres"),
         cell("Source of truth: <code>packages/db/src/schema.ts</code>")],
        [cell("Auth"), cell("Clerk v7"),
         cell("Plus <code>unsafeMetadata</code> as the signup-origin channel")],
        [cell("Storage"), cell("Cloudflare R2 (S3-compatible)"),
         cell("Direct browser-to-R2 multipart uploads via presigned URLs")],
        [cell("Payments"), cell("Stripe Connect Express + Subscription Schedules"),
         cell("Producers onboard to their own Stripe account")],
        [cell("Email"), cell("Resend via React Email"),
         cell("Templates in <code>apps/web/src/server/email/templates/</code>")],
        [cell("Audio"), cell("wavesurfer.js"),
         cell("Waveform rendering + scrubbing")],
        [cell("Tests"), cell("Vitest"),
         cell("Plus a mock-DB pattern using table markers (§9)")],
        [cell("Desktop"), cell("Tauri 2"),
         cell("Thin shell loading the web app — rare touch")],
        [cell("Observability"), cell("Sentry + PostHog"),
         cell("Installed 2026-04-23. Sentry catches errors; PostHog tracks usage.")],
        [cell("Hosting"), cell("Vercel (Hobby tier, pre-launch)"),
         cell("Fluid Compute by default, Node.js 24")],
        [cell("i18n"), cell("next-intl"),
         cell("<b>Scope = authenticated app only.</b> Landing + public routes are English-only LTR.")],
    ]
    return [
        h1("2. Tech stack", anchor="sec2"),
        muted('Canonical list in PRD §27. "Why" columns are short.'),
        spacer(6),
        table_3col(rows),
    ]


def build_section_3():
    tree = """.
├── apps/
│   ├── web/                      Next.js app — you'll live here
│   │   ├── src/app/              App Router: (app) / (artist) / (public) / api / ...
│   │   ├── src/components/       shell / dashboard / artist / project / audio / ui
│   │   ├── src/server/           trpc / payments / storage / email
│   │   ├── src/lib/              projects, time, magic-links, keyboard
│   │   ├── messages/             en.json + he.json + ar.json (authed app only)
│   │   └── scripts/              One-shot ops scripts
│   └── desktop/                  Tauri 2 shell (rare touch)
├── packages/
│   └── db/
│       ├── src/schema.ts         Drizzle schema — single source of truth
│       ├── drizzle/              SQL migrations (0000–0033)
│       └── apply-migrations.mjs  Direct neon-http runner (use this)
├── docs/
│   ├── INDEX.md                  Master map — read first every session
│   ├── session_recap.md          Live handoff snapshot
│   ├── audit-report.md           Paper trail of every known bug + its fix
│   ├── product/PRD.md            Product vision — normative
│   ├── plans/active/             Current implementation plans
│   ├── qa/                       Phase + pre-merge review artifacts
│   └── bmad-workflow.md          How to collaborate with Claude
├── .claude/                      Project-scoped Claude config
├── CLAUDE.md                     How we work
└── README.md                     Public pitch
"""
    return [
        h1("3. Repo layout", anchor="sec3"),
        muted("Key directories only — see the full tree in the docs on disk."),
        spacer(6),
        code(tree),
    ]


def build_section_4():
    return [
        h1("4. Running locally", anchor="sec4"),
        h3("Prerequisites"),
        bullet("Node.js 24 (latest LTS — matches Vercel default)"),
        bullet("pnpm"),
        bullet(
            "Access to: Neon dev DB connection string · Clerk dev keys · "
            "Cloudflare R2 creds (only if touching audio) · Stripe test keys "
            "(only if touching payments). Gili shares all of these through a "
            "password manager."
        ),
        spacer(8),
        h3("Clone + install"),
        code(
            "git clone https://github.com/giasraf/skitza-v2.git\n"
            "cd skitza-v2\n"
            "pnpm install"
        ),
        h3("Environment variables"),
        code(
            "cp apps/web/.env.local.example apps/web/.env.local\n"
            "# Edit apps/web/.env.local with the real values Gili shares"
        ),
        p("Minimum required to boot the app:"),
        code(
            "DATABASE_URL=<neon dev connection string>\n"
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...\n"
            "CLERK_SECRET_KEY=sk_test_...\n"
            "CLERK_WEBHOOK_SECRET=whsec_...\n"
            "MAGIC_LINK_SECRET=<any 32+ char random string>\n"
            "SITE_URL=http://localhost:3000"
        ),
        p(
            "Optional, per feature: R2 credentials for audio upload; Stripe keys "
            "for payments; Resend API key for email; CRON_SECRET for cron auth; "
            "Sentry DSN + PostHog key for observability."
        ),
        h3("Dev server"),
        code("pnpm -F web dev             # http://localhost:3000"),
        h3("Verify pipeline — run before every commit"),
        code(
            "pnpm -F web typecheck       # tsc --noEmit\n"
            "pnpm -F web lint            # eslint\n"
            "pnpm -F web test            # vitest run\n"
            "# shortcut: /skitza-verify"
        ),
        h3("Database workflow"),
        code(
            "pnpm -F @skitza/db db:studio       # GUI\n"
            "pnpm -F @skitza/db db:generate     # new migration from schema\n"
            "# DO NOT use db:migrate — it's broken. See §10."
        ),
    ]


def build_section_5():
    return [
        h1("5. How we work — non-negotiable", anchor="sec5"),
        muted("This is the most important section. Read it twice."),
        spacer(8),

        h2("5.1 BMAD is mandatory for product-change requests"),
        p(
            "Gili is non-technical. When Gili asks for a feature or fix, the work "
            "goes through BMAD (Breakthrough Method for Agile AI-Driven "
            "Development) — a structured 5-role pipeline:"
        ),
        bullet("<b>Analyst</b> — 3 clarifying questions, 1-page brief to docs/plans/"),
        bullet("<b>PM</b> — commits a PRD delta <b>before any code</b>"),
        bullet("<b>Architect</b> — technical design: file paths, tRPC signatures, migrations"),
        bullet("<b>Scrum Master</b> (Large track only) — self-contained story files"),
        bullet("<b>Dev + QA</b> — TDD in a fresh subagent per story; QA = spec + UX critique"),
        spacer(6),
        p("<b>Three tracks — pick by scope:</b>"),
        bullet("<b>Quick</b> — typo, copy tweak, one-liner → skip to Dev"),
        bullet("<b>Standard</b> (default, 80% of requests) — 2-10 files → full flow, lite"),
        bullet("<b>Large</b> — new surface, schema change, payments → full 5-phase pipeline"),
        spacer(6),
        p(
            "<b>Why this matters for you:</b> if Gili pings you in Telegram with "
            '"can you add X," the BMAD process still applies. Don\'t open an editor '
            'yet. Run it through the Analyst phase first. The full playbook lives '
            "in docs/bmad-workflow.md."
        ),
        p("<b>Magic phrases Gili uses:</b>"),
        bullet('<i>Quick BMAD: &lt;thing&gt;</i>'),
        bullet('<i>Standard BMAD: &lt;thing&gt;</i>'),
        bullet('<i>Large BMAD: &lt;thing&gt;</i>'),
        bullet('<i>BMAD me: &lt;thing&gt;</i> — you pick the track'),
        bullet('<i>skip BMAD</i> — explicit override, note the risk'),

        spacer(8),
        h2("5.2 TDD is mandatory for production code"),
        p(
            "<b>The rule:</b> failing test first, RED-verified (you must actually "
            "see the failure message), then GREEN. Applies to new features, bug "
            "fixes that add code branches/error handlers/defensive wrappers, and "
            "any behavior that could regress silently."
        ),
        p("<b>Legitimate TDD skips:</b>"),
        bullet("Pure infrastructure (applying a migration, adding env vars, setup scripts)"),
        bullet("Config-only changes (tsconfig, eslint, etc.)"),
        quote(
            "Real example from this project, April 22: Claude shipped a try/catch "
            "wrapper without a failing test first. Gili called it out. Remediation: "
            "wrote the test after, temporarily reverted the fix to prove RED, "
            "restored the fix, confirmed GREEN. Without the RED phase, a test can "
            "pass vacuously and pin nothing."
        ),

        spacer(8),
        h2("5.3 Commit discipline"),
        bullet('Prefix: <code>feat(scope):</code> · <code>fix(scope):</code> · <code>refactor(scope):</code> · <code>docs(scope):</code>'),
        bullet('Imperative mood — "add" not "added"'),
        bullet("Co-Authored-By line for Claude-generated work"),
        bullet("<b>Never</b> <code>git commit --amend</code> — always new commits"),
        bullet("<b>Never</b> <code>git push --force</code> to shared branches"),
        bullet("Don't skip hooks (no <code>--no-verify</code>)"),
        bullet("Frequent, small, revertable commits"),

        spacer(8),
        h2("5.4 Branch flow"),
        bullet("<code>main</code> is push-protected. All changes go through PRs."),
        bullet("Feature branches: <code>feat/&lt;scope&gt;-&lt;desc&gt;</code> or <code>fix/...</code>"),
        bullet("PR titles follow the same prefix convention"),
        bullet("Squash-merge is default; branch auto-deletes on merge; Vercel redeploys"),

        spacer(8),
        h2("5.5 Docs discipline"),
        p(
            "Every PR that fixes an audit task must update docs/audit-report.md:"
        ),
        bullet("Flip the Status tracker row from ⏳ Pending → ✅ Fixed with today's date + PR ref"),
        bullet("Append a dated entry to that task's Fix Log (never delete history — only append)"),
        p(
            "When multiple PRs touch audit-report.md, expect cascading conflicts. "
            "Resolution pattern is in §14."
        ),
    ]


def build_section_6():
    return [
        h1("6. Architecture at a glance", anchor="sec6"),
        h2("Two apps, one codebase"),
        bullet(
            "<b>Producer dashboard</b> at <code>/dashboard</code> — authed via "
            "<code>producerProcedure</code>; requires a <code>producers</code> row"
        ),
        bullet(
            "<b>Artist app</b> at <code>/artist</code> — authed via "
            "<code>artistProcedure</code>; does <b>not</b> require a "
            "<code>producers</code> row"
        ),
        bullet(
            "<b>Public surfaces</b> at <code>/</code>, <code>/p/&lt;slug&gt;</code>, "
            "<code>/p/&lt;slug&gt;/book</code>, <code>/m/&lt;token&gt;</code> — no auth or magic-link"
        ),
        bullet(
            "<b>Dual-role users</b> (producer + artist of another producer) are supported — "
            'UserButton shows a "Producer dashboard" link for them'
        ),

        h2("Role isolation"),
        p(
            "Helper in <code>apps/web/src/server/auth/role.ts</code> resolves Clerk user "
            "→ role (producer / artist / both) and redirects to the right surface. "
            "<b>Respect the helper — don't reinvent role checks.</b>"
        ),

        h2("tRPC pattern"),
        code(
            "publicProcedure    // no auth, rate-limited\n"
            "producerProcedure  // ctx.producerId + ctx.db injected\n"
            "artistProcedure    // ctx.userId + ctx.emailHash injected"
        ),
        p(
            "<b>Aggregation pattern:</b> single-round-trip payloads "
            "(<code>producer.today</code>, <code>artist.home</code>) use "
            "<code>Promise.all</code> across fan-out queries. Each leg scopes by "
            "tenant in its own WHERE."
        ),
        p("<b>Error codes to throw:</b>"),
        bullet("<code>UNAUTHORIZED</code> — not signed in"),
        bullet("<code>FORBIDDEN</code> — signed in but not authorized"),
        bullet(
            "<code>NOT_FOUND</code> — resource missing (<i>also</i> used for all "
            "auth-failed paths on magic links to prevent enumeration)"
        ),
        bullet("<code>CONFLICT</code> — uniqueness violation (e.g. slug taken)"),
        bullet("<code>TOO_MANY_REQUESTS</code> — rate limit"),

        h2("The RSC boundary (learned the hard way, April 23)"),
        p(
            "<b>Rule:</b> Never export non-component (lowercase) functions or "
            'consts from a <code>"use client"</code> file if any server component '
            "might import them."
        ),
        p(
            "<b>Why:</b> React Server Components forbids invoking a function "
            "defined in a client module from server code. Runtime error: "
            "<i>Attempted to call X() from the server but X is on the client.</i>"
        ),
        p(
            "<b>Pattern:</b> Extract pure types + predicates into a plain "
            '<code>.ts</code> module with no <code>"use client"</code> directive '
            "and no browser APIs. The client component can still import from it. "
            "Example: <code>project-sub-tab-shared.ts</code> + "
            "<code>project-sub-tabs.tsx</code>."
        ),
    ]


def build_section_7():
    return [
        h1("7. Crucial flows", anchor="sec7"),
        muted("Understand these before touching the files they live in."),
        spacer(6),

        h2("7.1 Producer signup → onboarding → dashboard"),
        bullet('Visitor lands on <code>/</code> (English only, LTR always)'),
        bullet("Clicks Sign Up → Clerk hosted auth → creates Clerk user"),
        bullet(
            "Clerk webhook at <code>/api/webhooks/clerk</code> fires, branches on "
            "<code>unsafeMetadata</code> to detect signup origin"
        ),
        bullet("Producer path: creates a <code>producers</code> row with default slug"),
        bullet("User lands on <code>/onboarding</code> (5-step wizard per PRD §4.5)"),
        bullet("Wizard completes → dashboard"),
        muted(
            "⚠ <b>Quarantined</b> — do NOT touch without Sentry data: sign-in "
            "forceRedirectUrl bug, artist-welcome race, webhook race. See §13."
        ),

        h2("7.2 /join/&lt;slug&gt; signup routes to artist (not producer)"),
        p(
            "When someone hits <code>skitza.app/join/&lt;slug&gt;</code> and signs "
            "up, they are registered as an <b>artist</b> of that producer — not as "
            "a new producer. The catch-all route at "
            "<code>/sign-up/join/[slug]/[[...rest]]</code> sets "
            "<code>unsafeMetadata: { signupOrigin: 'artist', producerSlug }</code> "
            "→ webhook branches on that → creates a <code>client_contacts</code> "
            "row. Layout redirects authed artists away from producer routes."
        ),

        h2("7.3 Audio upload (browser → R2, multipart)"),
        bullet("Client calls <code>initAudioUpload</code> → R2 <code>CreateMultipartUploadCommand</code> → returns <code>{ uploadId, key }</code>"),
        bullet("Client splits file into 5MB parts"),
        bullet("For each part: <code>signAudioPart</code> → presigned PUT URL"),
        bullet("Client does <code>fetch(url, { method: 'PUT', body: blob })</code> <b>directly to R2</b>"),
        bullet("ETags from response headers → passed to <code>completeAudioUpload</code> → assembles manifest"),
        bullet("Track version row in DB gets the final key + public URL"),
        muted(
            "⚠ R2 bucket <b>must</b> have a CORS policy allowing PUT from skitza.app, "
            "*.vercel.app, localhost:3000 with ExposeHeaders ETag. Policy at "
            "apps/web/src/server/storage/r2-cors.ts, applied via "
            "apps/web/scripts/apply-r2-cors.mjs. See §14.2."
        ),

        h2("7.4 Magic links (share tokens, signup invites)"),
        p(
            "JWT-signed short-lived tokens. An artist clicks a share link in email "
            "→ lands on <code>/share/&lt;token&gt;</code> → auto-sign-in if email matches. "
            "A producer shares a project → <code>/p/&lt;slug&gt;/book/&lt;token&gt;</code> "
            "prefills the booking form. Sign/verify in "
            "<code>apps/web/src/lib/magic-links/token.ts</code>."
        ),

        h2("7.5 Payments (Stripe Connect + Subscription Schedules)"),
        p(
            "Producers onboard to their own Stripe account via Connect Express. "
            "Three payment plans:"
        ),
        bullet("<b>full</b> — one Checkout at booking time"),
        bullet("<b>split_50_50</b> — deposit at booking, final charge off-session via saved PM post-delivery"),
        bullet("<b>monthly</b> — Subscription Schedule with N charges"),
        p(
            "Pure math at <code>apps/web/src/server/payments/plan.ts</code> — "
            "<code>calculateCharges(plan, totalAmountCents)</code> returns cents "
            "per charge. Fully tested. Webhook at "
            "<code>/api/webhooks/stripe</code> handles invoice.paid, "
            "checkout.session.completed, charge.refunded, etc."
        ),

        h2("7.6 Autopilot cron"),
        p(
            "Scheduled cron at <code>/api/cron/autopilot</code> (not yet on "
            "vercel.json — Hobby tier cron slot used by session-reminders):"
        ),
        bullet("<b>unpaid-reminder</b> — 7+ day old unpaid invoices → Resend email + stamp reminder_sent_at"),
        bullet("<b>request-testimonial</b> — detect-only (count eligible) until /t/&lt;token&gt; capture form ships"),
        bullet("<b>auto-archive</b> — 30+ day old paid projects → flip to archived"),
        p("Auth: <code>Bearer $CRON_SECRET</code>."),
    ]


def build_section_8():
    return [
        h1("8. Conventions", anchor="sec8"),

        h2("8.1 CSS — no hex codes, ever"),
        p(
            "All colors, radii, shadows go through CSS custom properties defined "
            "in <code>apps/web/src/app/globals.css</code>:"
        ),
        code(
            '// ✅ Correct\n'
            'className="bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] rounded-[var(--radius-md)]"\n'
            '\n'
            '// ❌ Never\n'
            'className="bg-blue-500 text-red-600"\n'
            'style={{ background: "#f3f4f6" }}'
        ),
        p(
            "<b>Key tokens:</b> <code>--bg-base</code>, <code>--bg-elevated</code>, "
            "<code>--fg-primary</code>, <code>--fg-secondary</code>, "
            "<code>--fg-muted</code>, <code>--fg-warning</code>, "
            "<code>--fg-danger</code>, <code>--brand-primary</code>, "
            "<code>--brand-accent</code>, <code>--border-subtle</code>, "
            "<code>--border-strong</code>, <code>--radius-sm/md/lg</code>."
        ),
        p(
            "<b>Alpha gotcha:</b> use the <code>/0.08</code> suffix. Do <b>not</b> "
            "nest <code>var()</code> with fallback inside <code>rgb()</code> with "
            "alpha — the parser fails silently."
        ),
        code(
            "// ✅ Works\n"
            "bg-[rgb(var(--fg-danger)/0.08)]\n"
            "\n"
            "// ❌ Silently broken\n"
            "bg-[rgb(var(--fg-danger,var(--brand-primary))/0.08)]"
        ),

        h2("8.2 Animation primitives"),
        p("All animation is CSS-only (no framer-motion). Primitives in globals.css:"),
        bullet("<code>.sk-lift</code> — hover lift"),
        bullet("<code>.sk-pop</code> / <code>.sk-pop-center</code> — dropdown/modal fade+scale-in"),
        bullet("<code>.sk-cta-shine</code> — CTA shimmer"),
        bullet("<code>.sk-pulse-hover</code> — breathing glow"),
        bullet("<code>.reveal-up</code> — mount fade+slide"),
        bullet("<code>.pulse-glow</code> — persistent brand pulse"),
        p(
            "<b>Every primitive must have a </b><code>@media (prefers-reduced-motion: reduce)</code><b> gate.</b> "
            "There's a test that fails CI if a new primitive skips it."
        ),

        h2("8.3 Responsive + a11y"),
        bullet("<b>Mobile-first.</b> Every new layout works at 360px before 1280px"),
        bullet("Touch targets ≥ 44×44 on mobile — use <code>.sk-tap</code>"),
        bullet("iOS safe-area via <code>.sk-safe-top</code>, <code>.sk-safe-bottom</code>, <code>.sk-safe-x</code>"),
        bullet("Horizontal rails use <code>.sk-scroll-x</code> for momentum scrolling"),
        bullet("<code>:focus-visible</code> (not <code>:focus</code>) so mouse clicks don't trigger rings"),
        bullet(
            "<b>Tabs:</b> <code>id=\"tab-&lt;key&gt;\"</code> + "
            "<code>aria-controls=\"panel-&lt;key&gt;\"</code> on the tab; "
            "<code>id=\"panel-&lt;key&gt;\"</code> + "
            "<code>aria-labelledby=\"tab-&lt;key&gt;\"</code> on the panel"
        ),
        bullet('Nav active: <code>aria-current="page"</code>, NOT <code>aria-pressed</code>'),
        bullet('Dialogs: <code>role="dialog"</code> + <code>aria-modal="true"</code> + Esc to close'),

        h2("8.4 i18n scope"),
        bullet(
            "<b>Landing + public routes are ENGLISH ONLY, LTR ONLY.</b> "
            "No <code>t()</code>, no <code>NextIntlClientProvider</code>, no locale cookie effects."
        ),
        bullet(
            'Root <code>&lt;html&gt;</code> is ALWAYS <code>lang="en" dir="ltr"</code>. '
            "Do NOT put conditional <code>dir</code> on <code>&lt;html&gt;</code> — "
            "breaks hydration with next-themes + Clerk."
        ),
        bullet(
            "RTL applies per-route-group via <code>&lt;AppI18nProvider&gt;</code> "
            "wrapping only authed groups: <code>(app)</code>, <code>(artist)</code>, "
            "<code>(artist-welcome)</code>, <code>(onboarding)</code>."
        ),
        bullet("Default locale: <b>en</b> for everyone. No IP-based auto-detection."),
        bullet("Hebrew is opt-in via the language chip in the sidebar footer"),
        bullet("Translation files: <code>apps/web/messages/{en,he,ar}.json</code>"),
    ]


def build_section_9():
    return [
        h1("9. Testing discipline", anchor="sec9"),

        h2("9.1 Placement"),
        bullet("Unit tests next to the file: <code>foo.test.ts</code> or <code>__tests__/foo.test.ts</code>"),
        bullet("tRPC router tests: <code>apps/web/src/server/trpc/routers/__tests__/</code>"),
        bullet("DB integration tests: <code>packages/db/src/__tests__/</code> (need <code>DATABASE_URL_TEST</code>)"),

        h2("9.2 Mock-DB pattern (tRPC tests)"),
        p("Use <b>marker objects</b> to branch by table:"),
        code(
            'const projectsMarker = { __table: "projects" };\n'
            'const bookingsMarker = { __table: "bookings" };\n'
            "\n"
            "const dbMock = {\n"
            "  select: () => ({\n"
            "    from: (table: unknown) => {\n"
            "      if (table === projectsMarker) { /* ... */ }\n"
            "      if (table === bookingsMarker) { /* ... */ }\n"
            '      throw new Error(`unexpected select().from(${String(table)})`);\n'
            "    },\n"
            "  }),\n"
            "};\n"
            "\n"
            'vi.mock("@skitza/db", () => ({\n'
            "  createDb: () => dbMock,\n"
            "  projects: projectsMarker,\n"
            "  bookings: bookingsMarker,\n"
            "  eq: (col, val) => ({ eq: [col, val] }),\n"
            "  and: (...args) => ({ and: args }),\n"
            "}));"
        ),

        h2("9.3 Auth-scoping assertions"),
        p(
            "Walk the WHERE predicate tree with the <code>findPredicate</code> "
            "helper to assert tenant-scoped queries. This catches silent regressions "
            "that drop tenant-scoping predicates."
        ),

        h2("9.4 Input validation"),
        p("Always use Zod. Nested <code>z.object({...}).strict()</code> for tight schemas."),

        h2("9.5 TDD cadence"),
        p(
            "Canonical RED → GREEN → refactor. Every bug fix starts with a "
            "failing test. Check recent commits on main for TDD sequences in PR "
            "bodies (e.g. Tasks 18 + 19)."
        ),
    ]


def build_section_10():
    return [
        h1("10. Database + migrations", anchor="sec10"),

        h2("10.1 The journal is broken past 0018"),
        p(
            "<code>packages/db/drizzle/meta/_journal.json</code> only tracks through "
            "migration 0018. Migrations 0019–0033 exist as .sql files but are NOT "
            "in the journal. Consequence: <code>drizzle-kit migrate</code> skips "
            "them. <b>Do NOT use </b><code>drizzle-kit migrate</code>."
        ),

        h2("10.2 Apply migrations manually"),
        code(
            "set -a && . apps/web/.env.local && set +a\n"
            "node packages/db/apply-migrations.mjs"
        ),
        p(
            "The runner reads each <code>drizzle/*.sql</code>, strips BEGIN/COMMIT, "
            "executes via neon-http's tagged-template trick. All migrations are "
            "idempotent (<code>ADD COLUMN IF NOT EXISTS</code>, etc.) so re-running "
            "is safe. Shortcut: <code>/skitza-migrate</code>."
        ),

        h2("10.3 Writing new migrations"),
        bullet("Change <code>packages/db/src/schema.ts</code>"),
        bullet("<code>pnpm -F @skitza/db db:generate</code> → produces the next NNNN.sql"),
        bullet("Verify idempotence — <code>ADD COLUMN IF NOT EXISTS</code>, <code>CREATE ... IF NOT EXISTS</code>"),
        bullet("Wrap in <code>BEGIN; ... COMMIT;</code> so the migration is atomic"),
        bullet("Sanity-check existing rows don't break (use <code>NOT NULL DEFAULT</code> for add-only)"),
        bullet("Apply via <code>/skitza-migrate</code> — do NOT touch <code>_journal.json</code>"),
        bullet("Apply to prod post-merge with prod <code>DATABASE_URL</code>"),

        h2("10.4 Neon HTTP quirk"),
        p(
            "<code>sql.query(stmt)</code> and <code>sql.unsafe(stmt)</code> don't "
            "exist in the neon HTTP client. The only way to run raw SQL without "
            "placeholders is:"
        ),
        code("sql(Object.assign([stmt], { raw: [stmt] }))"),
        p("The <code>apply-migrations.mjs</code> runner uses this pattern."),
    ]


def build_section_11():
    return [
        h1("11. Deployment + environments", anchor="sec11"),

        h2("11.1 Vercel"),
        bullet("<b>Production domain:</b> skitza.app"),
        bullet("<b>Preview URLs:</b> skitza-v2-web-&lt;hash&gt;-gili-asrafs-projects.vercel.app"),
        bullet("<b>Hobby tier</b> (pre-launch) — 1 daily cron limit (used by session-reminders)"),
        bullet("Node.js 24 default, Fluid Compute default"),
        bullet("<code>vercel.json</code> holds crons + config"),
        bullet(
            "<b>Env vars</b> live on Vercel only — never committed. Three envs: "
            "Production / Preview / Development. Always set vars in all three."
        ),

        h2("11.2 CI"),
        p(
            "GitHub Actions runs typecheck + lint + test + build on every PR. "
            "Currently red due to a billing block on Gili's account — treat CI "
            "as advisory until resolved. Always run the local gate before pushing."
        ),

        h2("11.3 Merging"),
        bullet("All PRs go through review (currently Gili + Claude; now + you)"),
        bullet("Squash-merge by default"),
        bullet("Branch auto-deleted on merge"),
        bullet("Vercel redeploys prod on every merge to <code>main</code>"),
    ]


def build_section_12():
    return [
        h1("12. Observability", anchor="sec12"),
        muted("Installed 2026-04-23 (PR #32). Verified live in prod."),
        spacer(6),

        h2('12.1 Sentry — "what\'s broken"'),
        bullet("Captures client + server + edge errors with stack traces, release attribution, user context via Clerk"),
        bullet("Config files: <code>apps/web/sentry.{client,server,edge}.config.ts</code> + <code>instrumentation.ts</code>"),
        bullet("<b>Check Sentry Issues tab daily</b> — first stop when diagnosing any prod bug"),
        bullet("Session Replay is auto-enabled (records ~30s before the error)"),

        h2('12.2 PostHog — "what are users doing"'),
        bullet("Autocapture (clicks + pageviews) + Clerk identify"),
        bullet("<code>/ingest/*</code> is a Next rewrite proxy to dodge ad-blockers"),
        bullet("Provider: <code>apps/web/src/components/observability/posthog-provider.tsx</code>"),
        bullet("Check Activity / Live Events tab for real-user behavior"),
        bullet("Session replays available per user"),

        h2("12.3 Vercel runtime logs"),
        p("The most underrated tool. Real function logs via the Vercel MCP or CLI:"),
        code("vercel logs <deployment-url>"),
        p("Claude uses the MCP server; you can use either."),

        h2("12.4 Debug pattern for prod bugs"),
        bullet('Gili reports "this page is broken"'),
        bullet("Get the URL + error reference digest if visible"),
        bullet("Pull Vercel runtime logs filtered by that path / time window"),
        bullet("If you see a stack trace → root-cause from there"),
        bullet("If no server log → suspect client-side or infra (CORS, network, third-party)"),
        bullet("For third-party (R2, Stripe, Resend): curl + OPTIONS preflight to isolate"),
    ]


def build_section_13():
    return [
        h1("13. Current state", anchor="sec13"),
        muted("As of 2026-04-23."),
        spacer(6),

        h2("13.1 Audit progression"),
        p(
            "<b>11 of 19 tracked tasks ✅ Fixed (58% closed).</b> Live tracker: "
            "docs/audit-report.md. Remaining ⏳ Pending, in rough priority order:"
        ),
        bullet("<b>Task 3</b> — S04 UI (embed parsers + /join Section B render)"),
        bullet("<b>Task 4</b> — onboarding wizard 4 → 5 steps (PRD §4.5 — Portfolio + Stripe steps)"),
        bullet("<b>Task 5</b> — /refund-policy content"),
        bullet("<b>Task 6</b> — cookie banner (EU compliance)"),
        bullet("<b>Task 7</b> — Privacy + Terms (counsel review required)"),
        bullet("<b>Task 9</b> — kill /dashboard/booking (duplicates Setup)"),
        bullet("<b>Task 10</b> — landing page TODO placeholders"),
        bullet("<b>Task 17 Phases 2+3</b> — artist desktop sidebar salvage"),

        h2("13.2 Known bugs on main (quarantine list)"),
        p(
            "Now diagnosable with Sentry + PostHog live. <b>Do NOT touch these "
            "files until we have ~1 week of real-user data.</b>"
        ),
        bullet("<code>/sign-in</code> <code>forceRedirectUrl=\"/dashboard\"</code> ignores <code>redirect_url</code> query param"),
        bullet("<code>/artist-welcome</code> (no slug) has no role guard for authed users with real studios"),
        bullet("Webhook race on <code>/artist-welcome/&lt;slug&gt;</code> — fast-clickers beat the Clerk webhook"),
        spacer(4),
        p("<b>Quarantined files:</b>"),
        bullet("<code>apps/web/src/app/(auth)/sign-in/*</code>, <code>/sign-up/*</code>"),
        bullet("<code>apps/web/src/app/(artist)/artist/layout.tsx</code>"),
        bullet("<code>apps/web/src/app/(artist-welcome)/**/*</code>"),
        bullet("<code>apps/web/src/app/api/webhooks/clerk/**/*</code>"),

        h2("13.3 Launch clock"),
        p(
            "Day 3 of a 12-week post-launch roadmap. Soft launch target: late "
            "April / early May 2026 with 5 producers."
        ),
    ]


def build_section_14():
    return [
        h1("14. Tribal knowledge / gotchas", anchor="sec14"),
        muted("Every hard-won rule from the mistake log, distilled."),
        spacer(6),

        h2('14.1 Never export lowercase functions from "use client" files that a server component might import'),
        p(
            "Pure predicates + types needed on both sides of the RSC boundary → "
            "extract into a plain <code>.ts</code> module with no "
            '<code>"use client"</code> directive. Pin with an invariant test that '
            "reads the file and asserts the first non-empty line isn't "
            '<code>"use client"</code>.'
        ),

        h2("14.2 R2 (and any browser-direct-to-storage) needs CORS upfront"),
        p(
            "Before shipping any feature that uploads directly from the browser "
            "to a storage service, the bucket's CORS policy must exist. For "
            "Skitza: <code>apps/web/src/server/storage/r2-cors.ts</code> + "
            "<code>apps/web/scripts/apply-r2-cors.mjs</code>. "
            '<b>Must </b><code>ExposeHeaders: ["ETag"]</code><b> for multipart.</b>'
        ),

        h2("14.3 Migration journal drift"),
        p(
            "Always use <code>node packages/db/apply-migrations.mjs</code>, never "
            "<code>drizzle-kit migrate</code>."
        ),

        h2("14.4 audit-report.md cascading conflicts"),
        p(
            "Every fix PR appends a row + fix log to the audit report. Merging "
            "PRs sequentially conflicts every PR after the first. Resolution:"
        ),
        bullet("<code>git checkout &lt;branch&gt; &amp;&amp; git fetch origin main &amp;&amp; git rebase origin/main</code>"),
        bullet("Edit conflict block — <b>keep both halves</b> of the status table + add the incoming row"),
        bullet("Stale <i>(Task X, PR pending)</i> → replace with actual <i>(PR #N)</i>"),
        bullet("<code>git add docs/audit-report.md &amp;&amp; git rebase --continue</code>"),
        bullet("Re-verify gates"),
        bullet("<code>git push --force-with-lease</code> + <code>gh pr merge --squash --delete-branch</code>"),

        h2("14.5 Never accept credentials via chat"),
        p(
            'Even "public" keys (<code>NEXT_PUBLIC_POSTHOG_KEY</code> ends up in '
            "the browser bundle anyway). Same channel could later carry a Stripe "
            "secret. Copy straight from source to destination (Vercel env vars). "
            "Never through a middleman — not chat, not email, not Slack."
        ),

        h2("14.6 No-key smoke tests for SaaS integrations"),
        p("Verify a third-party integration is live without leaking a key. Example for PostHog:"),
        code(
            'curl -s "https://skitza.app/ingest/decide?v=3" \\\n'
            '  -H "Content-Type: application/json" \\\n'
            '  -d \'{"token":"dummy"}\''
        ),
        p(
            "Expect: <i>The provided API key is invalid or has expired.</i> That "
            "proves (1) proxy rewrite is live, (2) upstream is receiving requests "
            "and validating keys. No real secret required."
        ),

        h2('14.7 "Failed to fetch" → CORS preflight'),
        p(
            "<code>TypeError: Failed to fetch</code> with no HTTP status in the "
            "response = almost always CORS preflight blocked. First diagnostic:"
        ),
        code(
            'curl -X OPTIONS <url> \\\n'
            '  -H "Origin: https://skitza.app" \\\n'
            '  -H "Access-Control-Request-Method: <method>"'
        ),

        h2("14.8 Local-main commits that duplicate PRs"),
        p(
            "If you commit a doc locally on <code>main</code> while the same doc "
            "is queued in an open PR, when that PR lands on origin your local "
            "commit will conflict with its own merged-back-via-PR version. "
            "<b>Preferred:</b> commit the doc on a branch from the start. "
            "<b>If already on main:</b> <code>git reset --hard origin/main</code> "
            "and re-author on a branch."
        ),

        h2("14.9 Small things"),
        bullet(
            "<code>rgb(var(--fg-danger,var(--brand-primary))/0.08)</code> fails "
            "silently — nested var() with fallback inside rgb() with alpha doesn't "
            "parse. Strip the fallback."
        ),
        bullet(
            'Conditional <code>dir="rtl"</code> on <code>&lt;html&gt;</code> crashes '
            "production — breaks hydration with next-themes + Clerk. Keep root "
            'html at <code>lang="en" dir="ltr"</code>; scope i18n to authed groups.'
        ),
        bullet(
            '<code>.success</code> toast variant is affectively wrong for "this '
            'isn\'t wired yet." Use <code>info</code> for non-success confirmations.'
        ),
        bullet(
            "All animation primitives require a <code>prefers-reduced-motion: reduce</code> "
            "gate — tested by CI."
        ),
    ]


def build_section_15():
    return [
        h1("15. Where to ask for help", anchor="sec15"),

        h2("People + process"),
        bullet("<b>Gili</b> — product questions, priorities, brand tone, anything user-facing"),
        bullet("<b>Claude</b> — anything code-y; has session context via docs/session_recap.md + full memory via CLAUDE.md"),
        bullet("<b>docs/INDEX.md</b> — if you can't find something in a dozen files, check the map first"),
        bullet("<b>docs/audit-report.md</b> — if you think you found a bug, check if it's already tracked"),
        bullet("<b>Vercel MCP + logs</b> — before guessing at any prod bug, pull the actual runtime logs"),

        h2("Helpful slash commands"),
        bullet("<code>/skitza-verify</code> — full gate (typecheck + lint + test + build)"),
        bullet("<code>/skitza-migrate</code> — apply pending SQL migrations"),
        bullet("<code>/skitza-preview</code> — print Vercel preview URL for the current branch"),
        bullet("<code>/checkpoint</code> — update docs/session_recap.md"),

        h2("Canonical files to bookmark"),
        table_2col(
            [
                [cell("<b>File</b>"), cell("<b>When to read</b>")],
                [cell("docs/session_recap.md"), cell("Every session start")],
                [cell("docs/INDEX.md"), cell("Navigation")],
                [cell("docs/audit-report.md"), cell("Before touching any file with known bugs")],
                [cell("docs/product/PRD.md"), cell("Any product question")],
                [cell("CLAUDE.md"), cell("HOW we work — conventions, commands, mistakes")],
                [cell("docs/bmad-workflow.md"), cell("How to collaborate with Claude on new features")],
            ],
            col_widths=[(PAGE_W - 2 * MARGIN) * 0.4, (PAGE_W - 2 * MARGIN) * 0.6],
        ),

        Spacer(1, 14 * mm),
        divider(),
        Spacer(1, 8 * mm),

        h2("The 4-question contract"),
        p(
            "The shortest version of this entire guide — before you do anything, "
            "ask yourself four questions:"
        ),
        Spacer(1, 4 * mm),
        quote(
            '<b>1.</b> Has this gone through BMAD?<br/><br/>'
            "<b>2.</b> Do I have a RED-verified failing test?<br/><br/>"
            "<b>3.</b> Did I run "
            "<font face='Courier'>pnpm -F web typecheck lint test</font> on this "
            "branch tip, <i>after</i> the latest rebase?<br/><br/>"
            "<b>4.</b> For quarantined files — do I have Sentry data to prove I "
            "understand what I'm fixing?"
        ),
        p("<b>Four yeses and you're safe. One no and you pause.</b>"),
        Spacer(1, 6 * mm),
        p("Welcome aboard. 🎧"),
    ]


# ─── Document ─────────────────────────────────────────────────────────────

def build_pdf():
    # Cover uses a full-bleed cream background; body pages use white.
    doc = BaseDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN + 8 * mm,
        bottomMargin=MARGIN,
        title="Skitza — Contributor Onboarding Guide",
        author="Gili Asraf + Claude",
        subject="Everything a new developer needs to know before writing code",
    )

    cover_frame = Frame(
        MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN,
        id="cover", showBoundary=0,
    )
    body_frame = Frame(
        MARGIN, MARGIN + 5 * mm, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN - 2 * mm,
        id="body", showBoundary=0,
    )

    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[cover_frame], onPage=_cover_page),
        PageTemplate(id="Body", frames=[body_frame], onPage=_body_page),
    ])

    story = []
    story.extend(build_cover())
    story.append(PageBreak())
    # Switch to body template from page 2 onward.
    from reportlab.platypus import NextPageTemplate
    story.append(NextPageTemplate("Body"))
    story.append(PageBreak())

    story.extend(build_intro())
    story.extend(build_toc())

    builders = [
        build_section_1, build_section_2, build_section_3, build_section_4,
        build_section_5, build_section_6, build_section_7, build_section_8,
        build_section_9, build_section_10, build_section_11, build_section_12,
        build_section_13, build_section_14, build_section_15,
    ]
    for b in builders:
        story.extend(b())
        story.append(PageBreak())

    doc.build(story)
    return OUTPUT_PATH


if __name__ == "__main__":
    out = build_pdf()
    size_kb = out.stat().st_size // 1024
    print(f"✅ Wrote {out} ({size_kb} KB)")
