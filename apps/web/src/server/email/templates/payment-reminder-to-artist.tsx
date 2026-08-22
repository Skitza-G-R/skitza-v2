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

export interface PaymentReminderToArtistProps {
  artistName: string;
  producerName: string;
  /** Must come from the accepted purchase snapshot, not the mutable product. */
  purchaseName: string;
  refNumber: string;
  currency: string;
  amountCents: number;
  dueAt: Date;
  producerTimezone: string;
  paymentUrl: string;
  /** The Client has no Skitza account yet; `paymentUrl` is the producer's join link. */
  joinRequired?: boolean | undefined;
}

function formatDueDate(dueAt: Date, producerTimezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: producerTimezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dueAt);
}

export function PaymentReminderToArtist(props: PaymentReminderToArtistProps) {
  const formattedAmount = formatCurrencyForEmail(props.amountCents, props.currency);
  const formattedDueDate = formatDueDate(props.dueAt, props.producerTimezone);

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
            Payment reminder
          </Heading>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            Hi {props.artistName},
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            This is a reminder that {formattedAmount} is due for your purchase from{" "}
            {props.producerName}.
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
              <strong>Purchase</strong> · {props.purchaseName}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Reference</strong> · {props.refNumber}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Amount due</strong> · {formattedAmount}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Due date</strong> · {formattedDueDate} ({props.producerTimezone})
            </Text>
          </Section>
          {props.joinRequired ? (
            <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
              Join {props.producerName}&apos;s studio on Skitza with this email address to see
              the payment details and send your payment confirmation.
            </Text>
          ) : null}
          <Button
            href={props.paymentUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#1A1407",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              display: "inline-block",
              marginTop: 4,
            }}
          >
            {props.joinRequired ? "Join on Skitza" : "View payment details"}
          </Button>
          <Hr style={{ borderColor: "#E6DDCF", margin: "20px 0" }} />
          <Text style={{ fontSize: 12, color: "#8A8073", margin: 0 }}>
            Sent by Skitza on behalf of {props.producerName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
