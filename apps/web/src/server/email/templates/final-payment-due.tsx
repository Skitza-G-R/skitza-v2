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

// Sent to the artist 3 days before a project's final payment is due.
// Gives a deep-link to Skitza's payment surface so the artist can
// settle without needing to message the producer.
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.1).
export interface FinalPaymentDueProps {
  artistName: string;
  producerName: string;
  projectName: string;
  amountCents: number;
  currency: string;
  /** Human-readable due date, e.g. "Fri, May 3". Caller formats
   *  because timezone rules live with the caller. */
  dueLabel: string;
  /** Deep link to the project's Money tab or the invoice. */
  payUrl: string;
}

export function FinalPaymentDue(props: FinalPaymentDueProps) {
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
              color: "#A25A28",
            }}
          >
            Final payment due soon
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            Your final payment for{" "}
            <strong>{props.projectName}</strong> with{" "}
            <strong>{props.producerName}</strong> is due on{" "}
            <strong>{props.dueLabel}</strong>. Once it&apos;s cleared,
            your final mixes + stems unlock for download.
          </Text>
          <Section
            style={{
              padding: "12px 16px",
              borderRadius: 8,
              backgroundColor: "#F4EFE7",
              margin: "16px 0",
            }}
          >
            <Text style={{ margin: 0, fontSize: 14, color: "#6B6158" }}>
              Amount due
            </Text>
            <Text
              style={{
                margin: "4px 0 0",
                fontSize: 22,
                fontWeight: 700,
                color: "#1A1714",
              }}
            >
              {formatCurrencyForEmail(props.amountCents, props.currency)}
            </Text>
          </Section>
          <Button
            href={props.payUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#1A1714",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              display: "inline-block",
              margin: "16px 0",
            }}
          >
            Pay now →
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza on behalf of {props.producerName}. Reply to
            this email to reach them directly.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
