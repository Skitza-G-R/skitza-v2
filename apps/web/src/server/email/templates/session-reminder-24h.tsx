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

import { formatSessionTimeForEmail } from "../format";

// 24h-before reminder, sent to either the artist or the producer.
// `recipientRole` lets the copy address them correctly without
// shipping two near-identical templates.
export interface SessionReminder24hProps {
  recipientName: string;
  recipientRole: "artist" | "producer";
  counterpartName: string;
  productName: string;
  startsAt: Date;
  producerTimezone: string;
}

export function SessionReminder24h(props: SessionReminder24hProps) {
  const formattedWhen = formatSessionTimeForEmail(
    props.startsAt,
    props.producerTimezone,
  );
  const lead =
    props.recipientRole === "artist"
      ? `Quick heads-up — your session with ${props.counterpartName} is tomorrow.`
      : `Quick heads-up — you have a session with ${props.counterpartName} tomorrow.`;
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
            Session tomorrow
          </Heading>
          <Text>Hi {props.recipientName},</Text>
          <Text>{lead}</Text>
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
          </Section>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza. Need to reschedule? Reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
