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

// Sent to the artist when the producer replies to a track comment
// they left. Keeps the collaboration loop tight outside the app.
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.1).
export interface ProducerRepliedToCommentProps {
  artistName: string;
  producerName: string;
  trackTitle: string;
  /** The reply text (truncated server-side if needed). */
  replyBody: string;
  /** Deep link to the comment thread on the Project Room. */
  threadUrl: string;
}

export function ProducerRepliedToComment(props: ProducerRepliedToCommentProps) {
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
              fontSize: 24,
              margin: "0 0 16px",
              color: "#A25A28",
            }}
          >
            {props.producerName} replied to your note
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            <strong>{props.producerName}</strong> replied to your comment
            on <strong>{props.trackTitle}</strong>:
          </Text>
          <Section
            style={{
              padding: "12px 16px",
              borderLeft: "3px solid #C98A0A",
              backgroundColor: "#F4EFE7",
              margin: "16px 0",
              borderRadius: 4,
            }}
          >
            <Text
              style={{
                margin: 0,
                fontStyle: "italic",
                color: "#3D3730",
                lineHeight: 1.5,
              }}
            >
              {props.replyBody}
            </Text>
          </Section>
          <Button
            href={props.threadUrl}
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
            Reply in Skitza →
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza on behalf of {props.producerName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
