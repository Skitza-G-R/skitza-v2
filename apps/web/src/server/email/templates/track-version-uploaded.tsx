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

// Sent to the artist when the producer uploads a new mix / version
// on one of their tracks. Pulls the artist back into the Project Room.
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.1).
export interface TrackVersionUploadedProps {
  artistName: string;
  producerName: string;
  projectName: string;
  /** The version label the producer tagged it with, e.g. "Mix v2". */
  versionLabel: string;
  /** Deep link to the Music sub-tab / Project Room for this track. */
  reviewUrl: string;
}

export function TrackVersionUploaded(props: TrackVersionUploadedProps) {
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
            New mix from {props.producerName}
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            <strong>{props.producerName}</strong> just uploaded{" "}
            <strong>{props.versionLabel}</strong> on{" "}
            <strong>{props.projectName}</strong>. Give it a listen and
            leave timestamped notes right on the waveform.
          </Text>
          <Button
            href={props.reviewUrl}
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
            Listen now →
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
