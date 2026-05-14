import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components";

// Sent to a contact when their producer triggers "Send invite email"
// from the Invite-to-App modal (Clients & Projects v3 redesign,
// Phase 1, Task 13). Mirrors the booking-request-received palette
// (#F4EFE7 cream / #C98A0A amber / #A25A28 copper) so the invite
// reads as a Skitza artefact and not a generic system mail.
//
// Inline styles only — every email client strips <style> tags
// differently.
export interface ClientInviteProps {
  clientName: string;
  producerName: string;
  inviteUrl: string;
}

export function ClientInvite(props: ClientInviteProps) {
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
            You&apos;re invited to Skitza
          </Heading>
          <Text>Hi {props.clientName},</Text>
          <Text>
            <strong>{props.producerName}</strong> invited you to their Skitza
            studio. Tap below to open your space — see your projects, hear
            your mixes, and book new sessions in one place.
          </Text>
          <Button
            href={props.inviteUrl}
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
            Open your studio
          </Button>
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
