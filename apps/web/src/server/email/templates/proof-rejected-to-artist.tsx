import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components";

// Sent to the artist when the producer can't verify a proof of payment
// (BE-2, Gate 2 reject). Unlike Gate-1 declines, the note here IS
// artist-facing — it explains what to fix before re-uploading.
export interface ProofRejectedToArtistProps {
  artistName: string;
  producerName: string;
  productName: string;
  refNumber: string;
  note: string;
}

export function ProofRejectedToArtist(props: ProofRejectedToArtistProps) {
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
            About your payment proof
          </Heading>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            Hi {props.artistName},
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            {props.producerName} couldn&apos;t verify the payment proof you
            uploaded for <strong>{props.productName}</strong> ({props.refNumber}).
          </Text>
          <Text
            style={{
              fontSize: 15,
              lineHeight: "24px",
              margin: "0 0 12px",
              padding: "12px 16px",
              backgroundColor: "#F4EFE7",
              borderRadius: 8,
            }}
          >
            &ldquo;{props.note}&rdquo;
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            You can upload a new proof from the payment screen — nothing else
            about your booking changes.
          </Text>
          <Hr style={{ borderColor: "#E6DDCF", margin: "20px 0" }} />
          <Text style={{ fontSize: 12, color: "#8A8073", margin: 0 }}>
            Sent by Skitza on behalf of {props.producerName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
