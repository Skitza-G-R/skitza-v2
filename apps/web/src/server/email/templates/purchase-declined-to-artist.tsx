import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components";

// Sent to the artist when the producer declines their purchase request
// (SK-37 / BE-1, Gate 1). Deliberately GENERIC — we never surface the
// producer's internal decline reason to the artist (BE-1 success
// criteria). No amounts, no judgement, just a graceful close.
export interface PurchaseDeclinedToArtistProps {
  artistName: string;
  producerName: string;
  productName: string;
  refNumber: string;
}

export function PurchaseDeclinedToArtist(props: PurchaseDeclinedToArtistProps) {
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
            About your request
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            Thanks for your interest in <strong>{props.productName}</strong>{" "}
            ({props.refNumber}). {props.producerName} isn&apos;t able to take
            this one on right now.
          </Text>
          <Text>
            Feel free to reach out to them directly if you&apos;d like to
            explore other options.
          </Text>
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
