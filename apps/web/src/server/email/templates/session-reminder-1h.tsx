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

// 1h-before reminder. Same structure as 24h but punchier copy and a
// copper accent so it visually distinguishes itself from the earlier
// reminder when stacked in an inbox.
export interface SessionReminder1hProps {
  recipientName: string;
  recipientRole: "artist" | "producer";
  counterpartName: string;
  productName: string;
  startsAt: Date;
  producerTimezone: string;
}

export function SessionReminder1h(props: SessionReminder1hProps) {
  const formattedWhen = formatSessionTimeForEmail(
    props.startsAt,
    props.producerTimezone,
  );
  const lead =
    props.recipientRole === "artist"
      ? `Your session with ${props.counterpartName} starts in about an hour.`
      : `${props.counterpartName} is due in about an hour.`;
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
            Starting soon
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
            Sent from Skitza.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
