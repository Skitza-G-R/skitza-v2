import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components";

import { formatCurrencyForEmail } from "../format";

// Sent to the artist when the producer verifies a proof of payment
// (BE-2, Gate 2). Confirms the amount recorded, shows the running
// total, and — on the final installment — celebrates paid-in-full.
export interface ProofVerifiedToArtistProps {
  artistName: string;
  producerName: string;
  productName: string;
  refNumber: string;
  currency: string;
  amountCents: number;
  paidCents: number;
  totalCents: number;
  paidInFull: boolean;
}

export function ProofVerifiedToArtist(props: ProofVerifiedToArtistProps) {
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
              color: "#1F7A3D",
            }}
          >
            {props.paidInFull ? "Paid in full" : "Payment confirmed"}
          </Heading>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            Hi {props.artistName},
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            {props.producerName} confirmed your payment of{" "}
            {formatCurrencyForEmail(props.amountCents, props.currency)} for{" "}
            <strong>{props.productName}</strong> ({props.refNumber}).
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            Paid so far: {formatCurrencyForEmail(props.paidCents, props.currency)} of{" "}
            {formatCurrencyForEmail(props.totalCents, props.currency)}.
          </Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", margin: "0 0 12px" }}>
            {props.paidInFull
              ? "Everything is settled — your downloads unlock as soon as your music is delivered."
              : "You can review your schedule and remaining balance any time from your home screen."}
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
