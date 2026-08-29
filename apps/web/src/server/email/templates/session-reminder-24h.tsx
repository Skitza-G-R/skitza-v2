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

import {
  EMAIL_LOGO_BAND,
  EMAIL_LOGO_CID,
  EMAIL_LOGO_HEIGHT,
  EMAIL_LOGO_WIDTH,
} from "../brand-logo";
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

// This template is deliberately DARK, and that is not a style preference.
//
// Gmail's Android client force-inverts light email: it rewrote a cream card
// to near-black but left the lockup PNG alone, so the logo's own #0e0d08
// background showed up as a black slab inside a white band. Images never
// invert; backgrounds do. A dark-native email gives the inverter nothing to
// flip, and the lockup blends into the page instead of fighting it.
//
// PAGE is exactly the lockup PNG's baked background, so the logo has no seam
// anywhere it sits. Everything else comes from the app's own dark theme in
// globals.css — kept as literals because mail clients strip CSS variables.
const PAGE = EMAIL_LOGO_BAND; // #0e0d08 — must equal the PNG's background
const CARD = "#1C1A14"; // --bg-elevated
const SUNKEN = "#111009"; // --bg-background
const INK = "#F2EDE6"; // --fg-default
const SOFT = "#D7CEC2"; // --fg-secondary
const MUTED = "#A89A8B"; // --fg-muted
const HAIRLINE = "#3C3830"; // --border-strong
const AMBER = "#E5A324"; // --brand-primary (dark)
const AMBER_TEXT = "#F0B84E"; // --brand-primary-text (dark)
const ON_AMBER = "#111009"; // --fg-inverse

// Syne is a web font and mail clients strip @font-face, so the display face
// is a plain system sans. A serif fallback here read as heavy and old.
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
        {/* Tells clients this email is already dark, so the ones that honour
            it (Apple Mail, Outlook) skip their own inversion pass. */}
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
      </Head>
      <Preview>{`${when.weekday} at ${when.time} · ${props.productName}`}</Preview>
      <Body
        style={{
          fontFamily: SANS,
          backgroundColor: PAGE,
          color: INK,
          margin: 0,
          padding: 0,
        }}
      >
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "28px 12px 32px" }}>
          {/* No band: the lockup sits straight on the page, whose colour is
              the PNG's own background, so there is nothing to seam against. */}
          <Section style={{ padding: "0 0 20px" }}>
            <Img
              src={`cid:${EMAIL_LOGO_CID}`}
              alt="Skitza"
              width={EMAIL_LOGO_WIDTH}
              height={EMAIL_LOGO_HEIGHT}
              style={{ display: "block", border: 0 }}
            />
          </Section>

          <Section
            style={{
              backgroundColor: CARD,
              borderRadius: 16,
              border: `1px solid ${HAIRLINE}`,
              padding: 24,
            }}
          >
            <Text
              style={{
                margin: 0,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: AMBER_TEXT,
                fontWeight: 700,
              }}
            >
              Session tomorrow
            </Text>
            <Heading
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
            <Text style={{ margin: "6px 0 0", fontSize: 15, lineHeight: "22px", color: SOFT }}>
              Hi {firstName} — here are the details.
            </Text>

            {/* The booking itself: date and time carry the weight, the rest
                reads as the ticket underneath. */}
            <Section
              style={{
                backgroundColor: SUNKEN,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 12,
                padding: 20,
                margin: "20px 0 0",
              }}
            >
              <Text style={{ margin: 0, fontSize: 14, color: MUTED }}>{when.weekday}</Text>
              <Text
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
                style={{
                  margin: "6px 0 0",
                  fontSize: 32,
                  lineHeight: "38px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: AMBER,
                }}
              >
                {when.time}
              </Text>
              <Text style={{ margin: "4px 0 0", fontSize: 12, color: MUTED }}>
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
                  padding: "13px 22px",
                  borderRadius: 16,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                {isArtist ? "View session" : "Open calendar"}
              </Button>
            </Section>

            <Text style={{ margin: "18px 0 0", fontSize: 13, lineHeight: "18px", color: MUTED }}>
              Need to reschedule? Just reply to this email.
            </Text>
          </Section>

          <Text style={{ margin: "18px 0 0", fontSize: 12, color: MUTED, textAlign: "center" }}>
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
      <span style={{ color: MUTED }}>{props.label}</span>
      <br />
      <strong>{props.value}</strong>
    </Text>
  );
}
