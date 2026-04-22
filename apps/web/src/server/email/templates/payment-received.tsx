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

import { formatCurrencyForEmail } from "../format";

// Sent to the producer when Stripe confirms an incoming payment.
// Receipt-style: "you just got paid, here's the breakdown."
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.2).
export interface PaymentReceivedProps {
  producerName: string;
  artistName: string;
  projectName: string;
  /** Gross amount the artist paid. */
  amountCents: number;
  /** Platform fee Skitza took (5% on Pro, 30% on Free). */
  platformFeeCents: number;
  currency: string;
  /** Deep link to the project's Money tab for the full breakdown. */
  viewUrl: string;
}

export function PaymentReceived(props: PaymentReceivedProps) {
  const net = props.amountCents - props.platformFeeCents;
  return (
    <Html>
      <Head />
      <Body
        style={{
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
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
              color: "#3F7D4E",
            }}
          >
            You just got paid
          </Heading>
          <Text>Hi {props.producerName},</Text>
          <Text>
            <strong>{props.artistName}</strong> paid you{" "}
            <strong>
              {formatCurrencyForEmail(props.amountCents, props.currency)}
            </strong>{" "}
            on <strong>{props.projectName}</strong>. Funds are on the way
            to your connected Stripe account.
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
              <strong>Gross</strong> ·{" "}
              {formatCurrencyForEmail(props.amountCents, props.currency)}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Platform fee</strong> ·{" "}
              {formatCurrencyForEmail(
                props.platformFeeCents,
                props.currency,
              )}
            </Text>
            <Text
              style={{
                margin: "4px 0",
                fontSize: 16,
                fontWeight: 700,
                color: "#3F7D4E",
              }}
            >
              <strong>Net to you</strong> ·{" "}
              {formatCurrencyForEmail(net, props.currency)}
            </Text>
          </Section>
          <Button
            href={props.viewUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#1A1714",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              display: "inline-block",
              margin: "8px 0",
            }}
          >
            View details →
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Payout timing depends on your Stripe account settings.
            Questions? Reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
