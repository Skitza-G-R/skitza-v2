import { Body, Button, Container, Head, Heading, Hr, Html, Text } from "@react-email/components";

/**
 * A private-offer email is deliberately only a notification. Commercial
 * terms stay behind Skitza's signed-in, verified-email authorization gate.
 */
export interface PrivateOfferNotificationProps {
  recipientName: string;
  producerName: string;
  openUrl: string;
}

export function PrivateOfferNotification(props: PrivateOfferNotificationProps) {
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
            A private offer is waiting
          </Heading>
          <Text>Hi {props.recipientName},</Text>
          <Text>
            <strong>{props.producerName}</strong> sent you a private offer in Skitza. Open Skitza to
            review it privately and choose what to do next.
          </Text>
          <Text>
            Sign in or create your account with the same email address that received this message.
            Only that verified account can open the offer.
          </Text>
          <Button
            href={props.openUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#1A1407",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              display: "inline-block",
              marginTop: 16,
            }}
          >
            Open Skitza
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            This email is a notification only. Review and respond inside Skitza.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
