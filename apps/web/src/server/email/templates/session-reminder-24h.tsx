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

// Email clients strip @font-face and most of CSS, so every colour and
// spacing value here is inline and literal — no tokens, no classes.
const INK = "#1A1714";
const MUTED = "#6B6158";
const HAIRLINE = "#E8E2D9";
const AMBER = "#C98A0A";
const PAGE = "#F4EFE7";
const CARD = "#FBF7F0";

export function SessionReminder24h(props: SessionReminder24hProps) {
  const when = formatSessionDatePartsForEmail(props.startsAt, props.producerTimezone);
  const length = formatSessionLengthForEmail(props.durationMin ?? 0);
  const isArtist = props.recipientRole === "artist";
  const lead = isArtist
    ? `Your session with ${props.counterpartName} is tomorrow.`
    : `You have a session with ${props.counterpartName} tomorrow.`;
  const href = isArtist
    ? `${props.siteUrl}/artist/sessions`
    : `${props.siteUrl}/dashboard/calendar`;

  return (
    <Html>
      <Head />
      <Preview>{`${when.weekday} at ${when.time} · ${props.productName}`}</Preview>
      <Body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          backgroundColor: PAGE,
          color: INK,
          margin: 0,
          padding: 0,
        }}
      >
        <Container style={{ maxWidth: 520, margin: "24px auto", padding: "0 0 8px" }}>
          {/* The lockup PNG carries its own #0e0d08 background, so this band
              must stay exactly that colour or a seam shows around the image. */}
          <Section
            style={{
              backgroundColor: EMAIL_LOGO_BAND,
              borderRadius: "16px 16px 0 0",
              padding: "20px 24px",
            }}
          >
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
              borderRadius: "0 0 16px 16px",
              padding: 24,
            }}
          >
            <Text
              style={{
                margin: 0,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: AMBER,
                fontWeight: 700,
              }}
            >
              Session tomorrow
            </Text>
            <Heading
              style={{
                fontFamily: "Georgia, serif",
                fontWeight: 700,
                fontSize: 26,
                lineHeight: "32px",
                margin: "8px 0 0",
                color: INK,
              }}
            >
              Hi {props.recipientName} — {lead}
            </Heading>

            {/* The booking itself: date and time carry the weight, the rest
                reads as the ticket underneath. */}
            <Section
              style={{
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 12,
                padding: 20,
                margin: "24px 0 0",
                backgroundColor: PAGE,
              }}
            >
              <Text style={{ margin: 0, fontSize: 14, color: MUTED }}>{when.weekday}</Text>
              <Text
                style={{
                  margin: "2px 0 0",
                  fontFamily: "Georgia, serif",
                  fontSize: 22,
                  lineHeight: "28px",
                  fontWeight: 700,
                  color: INK,
                }}
              >
                {when.date}
              </Text>
              <Text
                style={{
                  margin: "6px 0 0",
                  fontSize: 30,
                  lineHeight: "36px",
                  fontWeight: 700,
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

            <Section style={{ padding: "24px 0 4px" }}>
              <Button
                href={href}
                style={{
                  backgroundColor: INK,
                  color: PAGE,
                  fontSize: 15,
                  fontWeight: 600,
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

            <Text style={{ margin: "16px 0 0", fontSize: 12, color: MUTED }}>
              Need to reschedule? Just reply to this email.
            </Text>
          </Section>

          <Text
            style={{
              margin: "16px 0 0",
              fontSize: 12,
              color: MUTED,
              textAlign: "center",
            }}
          >
            Sent from Skitza
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// One line of the booking's detail list. Separate so the three rows can't
// drift apart, and so the hairline only ever appears between rows.
function Row(props: { label: string; value: string; first?: boolean }) {
  return (
    <Text
      style={{
        margin: 0,
        padding: "12px 0 0",
        marginTop: 12,
        borderTop: `1px solid ${HAIRLINE}`,
        fontSize: 15,
        lineHeight: "20px",
        color: INK,
        ...(props.first ? { marginTop: 20 } : {}),
      }}
    >
      <span style={{ color: MUTED }}>{props.label}</span>
      <br />
      <strong>{props.value}</strong>
    </Text>
  );
}
