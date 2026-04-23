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

// Sent to the artist when the producer publishes a contract for
// signature on a project. CTA deep-links to the signing surface.
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.1).
export interface ContractReadyProps {
  artistName: string;
  producerName: string;
  contractTitle: string;
  /** Deep link to the signing page, e.g. `/sign/<token>`. */
  reviewUrl: string;
}

export function ContractReady(props: ContractReadyProps) {
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
            Your contract is ready
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            <strong>{props.producerName}</strong> has prepared the{" "}
            <strong>{props.contractTitle}</strong> contract for your review.
            Take a minute to read it and sign at your convenience.
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
            Review &amp; sign →
          </Button>
          <Text style={{ fontSize: 14, color: "#3D3730" }}>
            You can always come back to this link later — it stays valid
            until you sign or the producer voids the contract.
          </Text>
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
