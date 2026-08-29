import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { EMAIL_LOGO_CID, EMAIL_LOGO_HEIGHT, EMAIL_LOGO_WIDTH } from "../brand-logo";
import { formatSessionDatePartsForEmail, formatSessionLengthForEmail } from "../format";

// 24h-before reminder, sent to either the artist or the producer.
// `recipientRole` lets the copy address them correctly, and point the
// button at their own side of the app, without shipping two
// near-identical templates.
export interface SessionReminder24hProps {
  recipientName: string;
  recipientRole: "artist" | "producer";
  counterpartName: string;
  productName: string;
  startsAt: Date;
  producerTimezone: string;
  /** Session length. Omitted or <= 0 drops the row rather than printing "0 min". */
  durationMin?: number;
  /** Absolute origin for the button. Injected so tests don't depend on env. */
  siteUrl: string;
}

// ── Why this template is built light, with dark handled on top ──────────
//
// No single palette survives every client, because they disagree on what
// dark mode means:
//
//   - Gmail Android partial-inverts: light backgrounds go dark, images are
//     left untouched.
//   - Gmail iOS / Outlook Windows FULL-invert, which turns a deliberately
//     dark email back into a light one.
//   - Apple Mail changes nothing unless the color-scheme meta tags are set,
//     and then honours prefers-color-scheme.
//
// Gmail strips prefers-color-scheme entirely, so a "dark version" cannot be
// served to it by CSS. Building light is therefore the compatible base: the
// clients that darken produce the dark treatment themselves, and Apple Mail
// gets the real thing from the media query below.
//
// The rule that actually matters is that images never invert. Nothing here
// bakes a background into an image — see brand-logo.ts.
//
// Colours are the app's own tokens from globals.css, kept as literals
// because mail clients strip CSS variables. Neither pure #fff nor #000:
// some clients treat those as a cue for their most aggressive inversion.
const PAGE = "#F2EDE6"; // --bg-background (light)
const CARD = "#FDFBF7"; // --bg-elevated, nudged off pure white
const SUNKEN = "#F7F2EA";
const INK = "#111009"; // --fg-default (light)
const SOFT = "#3D3730"; // --fg-secondary
const MUTED = "#6B6359"; // --fg-muted
const HAIRLINE = "#E8E1D4"; // --border-subtle
const AMBER = "#D4960A"; // --brand-primary (light)
const AMBER_INK = "#785000"; // --brand-primary-text, for amber-on-light text
const ON_AMBER = "#1A1407"; // --fg-on-brand

// Syne is a web font and every mail client strips @font-face, so the display
// face is a plain system sans. A serif fallback read as heavy and dated.
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Apple Mail and Outlook for Mac honour this; Gmail ignores it and applies
// its own inversion, which is why the light base above has to stand alone.
const DARK_MODE_CSS = `
  @media (prefers-color-scheme: dark) {
    .sk-page { background-color: #0E0D08 !important; }
    .sk-card { background-color: #1C1A14 !important; border-color: #3C3830 !important; }
    .sk-block { background-color: #111009 !important; border-color: #3C3830 !important; }
    .sk-ink { color: #F2EDE6 !important; }
    .sk-soft { color: #D7CEC2 !important; }
    .sk-muted { color: #A89A8B !important; }
    .sk-amber { color: #F0B84E !important; }
    .sk-rule { border-top-color: #3C3830 !important; }
  }
`;

export function SessionReminder24h(props: SessionReminder24hProps) {
  const when = formatSessionDatePartsForEmail(props.startsAt, props.producerTimezone);
  const length = formatSessionLengthForEmail(props.durationMin ?? 0);
  const isArtist = props.recipientRole === "artist";
  const firstName = props.recipientName.trim().split(/\s+/)[0] ?? props.recipientName;
  const href = isArtist
    ? `${props.siteUrl}/artist/sessions`
    : `${props.siteUrl}/dashboard/calendar`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: DARK_MODE_CSS }} />
      </Head>
      <Preview>{`${when.weekday} at ${when.time} · ${props.productName}`}</Preview>
      <Body
        className="sk-page"
        style={{
          fontFamily: SANS,
          backgroundColor: PAGE,
          color: INK,
          margin: 0,
          padding: 0,
        }}
      >
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "24px 12px 32px" }}>
          {/* Brand mark: a self-contained amber tile (safe on any page colour
              because images never invert) beside live text that each client
              recolours for us. */}
          <Section style={{ padding: "0 0 20px" }}>
            <table cellPadding={0} cellSpacing={0} role="presentation">
              <tbody>
                <tr>
                  <td style={{ paddingRight: 10, verticalAlign: "middle" }}>
                    <Img
                      src={`cid:${EMAIL_LOGO_CID}`}
                      alt="Skitza"
                      width={EMAIL_LOGO_WIDTH}
                      height={EMAIL_LOGO_HEIGHT}
                      style={{ display: "block", border: 0 }}
                    />
                  </td>
                  <td style={{ verticalAlign: "middle" }}>
                    <span
                      className="sk-ink"
                      style={{
                        fontFamily: SANS,
                        fontSize: 22,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        color: INK,
                      }}
                    >
                      skitza
                      <span className="sk-amber" style={{ color: AMBER }}>
                        .
                      </span>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section
            className="sk-card"
            style={{
              backgroundColor: CARD,
              borderRadius: 16,
              border: `1px solid ${HAIRLINE}`,
              padding: 24,
            }}
          >
            <Text
              className="sk-amber"
              style={{
                margin: 0,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: AMBER_INK,
                fontWeight: 700,
              }}
            >
              Session tomorrow
            </Text>
            <Heading
              className="sk-ink"
              style={{
                fontFamily: SANS,
                fontWeight: 700,
                fontSize: 21,
                lineHeight: "28px",
                letterSpacing: "-0.01em",
                margin: "10px 0 0",
                color: INK,
              }}
            >
              Your session with {props.counterpartName}
            </Heading>
            <Text
              className="sk-soft"
              style={{ margin: "6px 0 0", fontSize: 15, lineHeight: "22px", color: SOFT }}
            >
              Hi {firstName} — here are the details.
            </Text>

            {/* The booking itself. Date and time carry the weight; the rest
                reads as the ticket underneath. */}
            <Section
              className="sk-block"
              style={{
                backgroundColor: SUNKEN,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 12,
                padding: 20,
                margin: "20px 0 0",
              }}
            >
              <Text className="sk-muted" style={{ margin: 0, fontSize: 14, color: MUTED }}>
                {when.weekday}
              </Text>
              <Text
                className="sk-ink"
                style={{
                  margin: "2px 0 0",
                  fontSize: 19,
                  lineHeight: "26px",
                  fontWeight: 600,
                  color: INK,
                }}
              >
                {when.date}
              </Text>
              <Text
                className="sk-amber"
                style={{
                  margin: "6px 0 0",
                  fontSize: 32,
                  lineHeight: "38px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: AMBER_INK,
                }}
              >
                {when.time}
              </Text>
              <Text className="sk-muted" style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
                {props.producerTimezone.replace(/_/g, " ")}
              </Text>

              <Row label={isArtist ? "With" : "Artist"} value={props.counterpartName} first />
              <Row label="Booked" value={props.productName} />
              {length ? <Row label="Length" value={length} /> : null}
            </Section>

            <Section style={{ padding: "22px 0 2px" }}>
              <Button
                href={href}
                style={{
                  backgroundColor: AMBER,
                  color: ON_AMBER,
                  fontFamily: SANS,
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: "18px",
                  padding: "14px 24px",
                  borderRadius: 16,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                {isArtist ? "View session" : "Open calendar"}
              </Button>
            </Section>

            <Text
              className="sk-muted"
              style={{ margin: "18px 0 0", fontSize: 13, lineHeight: "18px", color: MUTED }}
            >
              Need to reschedule? Just reply to this email.
            </Text>
          </Section>

          <Text
            className="sk-muted"
            style={{ margin: "18px 0 0", fontSize: 12, color: MUTED, textAlign: "center" }}
          >
            Sent from Skitza
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// One line of the booking's detail list. Separate so the rows can't drift
// apart, and so the hairline only ever appears between them.
function Row(props: { label: string; value: string; first?: boolean }) {
  return (
    <Text
      className="sk-ink sk-rule"
      style={{
        margin: 0,
        marginTop: props.first ? 20 : 12,
        padding: "12px 0 0",
        borderTop: `1px solid ${HAIRLINE}`,
        fontSize: 15,
        lineHeight: "21px",
        color: INK,
      }}
    >
      <span className="sk-muted" style={{ color: MUTED }}>
        {props.label}
      </span>
      <br />
      <strong>{props.value}</strong>
    </Text>
  );
}
