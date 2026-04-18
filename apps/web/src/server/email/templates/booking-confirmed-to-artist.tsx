import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components";

import { formatCurrencyForEmail, formatSessionTimeForEmail } from "../format";

// Sent to the artist (visitor) when the producer approves their
// booking request. The producer name + studio brand land at the top
// so the artist immediately recognises the sender.
export interface BookingConfirmedToArtistProps {
  artistName: string;
  producerName: string;
  productName: string;
  startsAt: Date | null;
  producerTimezone: string;
  currency: string;
  priceCents: number;
  depositCents: number;
}

export function BookingConfirmedToArtist(props: BookingConfirmedToArtistProps) {
  const formattedWhen = props.startsAt
    ? formatSessionTimeForEmail(props.startsAt, props.producerTimezone)
    : "TBC — your producer will confirm a date soon";
  return (
    <Html>
      <Head />
      <Body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          backgroundColor: "#F4EFE7",
          color: "#1A1714",
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 520,
            margin: "24px auto",
            padding: 24,
            backgroundColor: "#FBF7F0",
            borderRadius: 12,
          }}
        >
          <Heading
            style={{
              fontFamily: "Georgia, serif",
              fontWeight: 700,
              fontSize: 28,
              margin: "0 0 16px",
              color: "#A25A28",
            }}
          >
            Your session is confirmed
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            <strong>{props.producerName}</strong> approved your request — see
            you soon.
          </Text>
          <Section
            style={{
              padding: "12px 0",
              borderTop: "1px solid #E8E2D9",
              borderBottom: "1px solid #E8E2D9",
              margin: "16px 0",
            }}
          >
            <Text style={{ margin: "4px 0" }}>
              <strong>Product</strong> · {props.productName}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>When</strong> · {formattedWhen}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Total</strong> ·{" "}
              {formatCurrencyForEmail(props.priceCents, props.currency)}
              {props.depositCents > 0
                ? ` (deposit ${formatCurrencyForEmail(props.depositCents, props.currency)})`
                : ""}
            </Text>
          </Section>
          <Text>
            We&apos;ll send you reminders 24 hours and 1 hour before the
            session.
          </Text>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza on behalf of {props.producerName}. Reply to this
            email to reach them directly.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
