import { Body, Button, Container, Head, Heading, Hr, Html, Text } from "@react-email/components";

// SK-273 beta nudge #2 — sent once, ~7 days after a beta producer signed up
// without creating their first project. Friendly checklist plus a button into
// the dashboard. Same cream/copper palette as client-invite; inline styles
// only — email clients strip <style> tags differently.
export interface BetaActivationHelpProps {
  dashboardUrl: string;
  name: string | null;
}

export function BetaActivationHelp(props: BetaActivationHelpProps) {
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
            Need a hand getting set up?
          </Heading>
          <Text>Hi {props.name ?? "there"},</Text>
          <Text>
            Welcome again to the Skitza beta. We noticed you haven&apos;t started your first project
            yet — it takes about two minutes:
          </Text>
          <Text style={{ margin: "0 0 4px" }}>1. Add your first artist under Clients.</Text>
          <Text style={{ margin: "0 0 4px" }}>2. Create their project.</Text>
          <Text style={{ margin: "0 0 16px" }}>
            3. Share your studio link so they can listen and book you.
          </Text>
          <Button
            href={props.dashboardUrl}
            style={{
              backgroundColor: "#C98A0A",
              color: "#1A1407",
              padding: "12px 24px",
              borderRadius: 8,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Open your studio
          </Button>
          <Hr style={{ margin: "24px 0", borderColor: "#E8E2D9" }} />
          <Text style={{ fontSize: 12, color: "#6B6158" }}>
            Stuck, or something feels broken? Reply to this email — during the beta we read
            everything. This is a one-time nudge, not a drip campaign.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
