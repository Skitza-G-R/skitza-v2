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

import { formatCurrencyForEmail } from "../format";

// Sent to the artist when the producer approves their purchase request
// (SK-37 / BE-1, Gate 1). The next step for the artist is to accept the
// producer's agreement, then pay — but those flows live in BE-2/3, so
// this email keeps to "you're approved, here's what you committed to".
export interface PurchaseApprovedToArtistProps {
  artistName: string;
  producerName: string;
  productName: string;
  refNumber: string;
  currency: string;
  priceCents: number;
}

export function PurchaseApprovedToArtist(props: PurchaseApprovedToArtistProps) {
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
            You&apos;re approved
          </Heading>
          <Text>Hi {props.artistName},</Text>
          <Text>
            <strong>{props.producerName}</strong> approved your request. Head
            back to Skitza to review the agreement and continue.
          </Text>
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
              <strong>Reference</strong> · {props.refNumber}
            </Text>
            <Text style={{ margin: "4px 0" }}>
              <strong>Total</strong> ·{" "}
              {formatCurrencyForEmail(props.priceCents, props.currency)}
            </Text>
          </Section>
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
