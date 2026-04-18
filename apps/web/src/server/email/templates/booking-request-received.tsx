import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components";

import { formatCurrencyForEmail, formatSessionTimeForEmail } from "../format";

// Sent to the producer the moment a visitor submits a booking request.
// Palette mirrors the marketing site (#F4EFE7 cream, #C98A0A amber,
// #A25A28 copper) so the email feels like a Skitza artefact rather
// than a generic transactional drop. Inline styles only — every email
// client strips <style> tags differently.
export interface BookingRequestReceivedProps {
  producerName: string;
  artistName: string;
  productName: string;
  startsAt: Date | null;
  producerTimezone: string;
  currency: string;
  priceCents: number;
  depositCents: number;
  notes?: string | undefined;
  reviewUrl: string;
}

export function BookingRequestReceived(props: BookingRequestReceivedProps) {
  const formattedWhen = props.startsAt
    ? formatSessionTimeForEmail(props.startsAt, props.producerTimezone)
    : "No specific time — pure deliverable";
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
              color: "#C98A0A",
            }}
          >
            New session request
          </Heading>
          <Text>Hi {props.producerName},</Text>
          <Text>
            <strong>{props.artistName}</strong> just requested a session.
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
              <strong>Price</strong> ·{" "}
              {formatCurrencyForEmail(props.priceCents, props.currency)}
              {props.depositCents > 0
                ? ` (deposit ${formatCurrencyForEmail(props.depositCents, props.currency)})`
                : ""}
            </Text>
          </Section>
          {props.notes ? (
            <Text style={{ fontStyle: "italic" }}>
              &ldquo;{props.notes}&rdquo;
            </Text>
          ) : null}
          <Button
            href={props.reviewUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#FBF7F0",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              display: "inline-block",
              marginTop: 16,
            }}
          >
            Review request
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza. Reply to this email to message {props.artistName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
