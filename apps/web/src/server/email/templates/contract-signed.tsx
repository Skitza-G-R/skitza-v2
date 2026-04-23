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

// Sent to the producer when the artist completes signing a contract.
// Signals the project can proceed to the next stage (payment,
// scheduling, etc.).
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.2).
export interface ContractSignedProps {
  producerName: string;
  artistName: string;
  contractTitle: string;
  /** Deep link to the contract record / project in Skitza. */
  viewUrl: string;
}

export function ContractSigned(props: ContractSignedProps) {
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
            Contract signed
          </Heading>
          <Text>Hi {props.producerName},</Text>
          <Text>
            <strong>{props.artistName}</strong> just signed the{" "}
            <strong>{props.contractTitle}</strong>. The signed PDF is
            attached in Skitza and also available at the link below.
          </Text>
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
              margin: "16px 0",
            }}
          >
            View contract →
          </Button>
          <Text style={{ fontSize: 14, color: "#3D3730" }}>
            The project is now ready for its next step — deposit (if
            unpaid), scheduling, or session work.
          </Text>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent automatically by Skitza.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
