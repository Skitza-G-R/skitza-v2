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

import { formatSessionTimeForEmail } from "../format";

// Sent when a session is cancelled or rescheduled. Shared template
// serving both artist + producer sides — copy adapts to `recipient`
// + `status`. Original + new time are both shown for the rescheduled
// variant so the reader can spot the diff at a glance.
//
// Wave: 2026-04-22 — audit Task 13 (PRD §14.1 + §14.2).
export interface BookingCancelledOrRescheduledProps {
  recipientName: string;
  /** Who made the change. */
  counterpartName: string;
  productName: string;
  status: "cancelled" | "rescheduled";
  /** Original session time (required). */
  oldStartsAt: Date;
  /** New session time — present only when status === "rescheduled". */
  newStartsAt: Date | null;
  /** Producer's timezone — applied to both timestamps so everyone
   *  reads the same wall-clock time. */
  producerTimezone: string;
  /** Free-form reason the producer (or artist) attached. Optional. */
  reason: string | null;
}

export function BookingCancelledOrRescheduled(
  props: BookingCancelledOrRescheduledProps,
) {
  const oldLabel = formatSessionTimeForEmail(
    props.oldStartsAt,
    props.producerTimezone,
  );
  const newLabel = props.newStartsAt
    ? formatSessionTimeForEmail(props.newStartsAt, props.producerTimezone)
    : null;
  const isCancel = props.status === "cancelled";
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
              fontSize: 26,
              margin: "0 0 16px",
              color: isCancel ? "#B3321C" : "#A25A28",
            }}
          >
            {isCancel
              ? "Your session was cancelled"
              : "Your session was rescheduled"}
          </Heading>
          <Text>Hi {props.recipientName},</Text>
          <Text>
            {isCancel ? (
              <>
                <strong>{props.counterpartName}</strong> cancelled the{" "}
                <strong>{props.productName}</strong> session originally
                scheduled for <strong>{oldLabel}</strong>.
              </>
            ) : (
              <>
                <strong>{props.counterpartName}</strong> moved your{" "}
                <strong>{props.productName}</strong> session.
              </>
            )}
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
              <strong>Was</strong> · {oldLabel}
            </Text>
            {!isCancel && newLabel ? (
              <Text
                style={{
                  margin: "4px 0",
                  color: "#3F7D4E",
                  fontWeight: 700,
                }}
              >
                <strong>Now</strong> · {newLabel}
              </Text>
            ) : null}
          </Section>
          {props.reason ? (
            <Text
              style={{
                padding: "8px 12px",
                backgroundColor: "#F4EFE7",
                borderRadius: 4,
                fontStyle: "italic",
                color: "#3D3730",
              }}
            >
              {props.counterpartName} said: &ldquo;{props.reason}&rdquo;
            </Text>
          ) : null}
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Sent from Skitza. Reply to this email to reach{" "}
            {props.counterpartName} directly.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
