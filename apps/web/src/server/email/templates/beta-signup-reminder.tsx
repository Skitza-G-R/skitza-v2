import { Body, Container, Head, Heading, Hr, Html, Text } from "@react-email/components";

// SK-273 beta nudge #1 — sent once, ~5 days after a producer invitation went
// out with no signup. The actual invitation link lives only in Clerk's
// original email (we cannot mint a fresh one from here), so this nudge points
// the reader back at that email instead of carrying a button of its own.
// Mirrors the client-invite palette (#F4EFE7 cream / #A25A28 copper) and uses
// inline styles only — email clients strip <style> tags differently.
export interface BetaSignupReminderProps {
  name: string | null;
}

export function BetaSignupReminder(props: BetaSignupReminderProps) {
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
            Your Skitza beta invite is waiting
          </Heading>
          <Text>Hi {props.name ?? "there"},</Text>
          <Text>
            A few days ago we sent you a personal invitation to the Skitza beta, and it looks like
            it hasn&apos;t been used yet. Invitation links expire about a week after they go out, so
            now is a good moment.
          </Text>
          <Text>
            Search your inbox (and your spam folder) for an email from Skitza titled{" "}
            <strong>&quot;You&apos;ve been invited&quot;</strong> — the button inside it opens your
            account.
          </Text>
          <Text>
            Can&apos;t find it? Just reply to this email and we&apos;ll send you a fresh one.
          </Text>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            You&apos;re getting this one-time reminder because you asked to join the Skitza beta.
            Reply to this email to reach a human.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
