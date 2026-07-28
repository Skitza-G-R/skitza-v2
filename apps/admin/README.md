# Skitza Admin

Private founder-only operations app for `admin.skitza.app`.

## Deployment boundary

Create a separate Vercel project with **Root Directory** set to
`apps/admin`. Do not attach `admin.skitza.app` or promote a production
deployment without Gili's explicit approval for that exact deployment.

The project reuses Skitza's Clerk application for primary sign-in. Founder
access is granted through server-only Clerk private metadata:

```json
{ "skitzaAdminRole": "founder" }
```

Cloudflare Access is the independent-MFA boundary for the separate admin
hostname. Every dynamic page and admin API verifies the Access application
JWT against the exact team JWKS, issuer, audience, founder subject, expiry,
not-before time, and configured canonical host before Clerk authorization.
The same verified Access identity and server-only Clerk founder role are
required again inside protected page and API code. A direct `*.vercel.app`
request therefore fails closed even if it replays an otherwise valid Access
token.

The only middleware exceptions are immutable `/_next/static/**` files and
the exact `favicon.ico`, `robots.txt`, and `sitemap.xml` metadata paths.
`/_next/image`, dynamic UI, RSC/data requests, and all APIs remain protected.
No excluded path may contain admin data or session-specific output.

The Access application and policy must be audited before attaching a
hostname:

- Protect only the exact Cloudflare-proxied admin hostname.
- Allow only Gili's human founder identity. Do not use Everyone, Bypass,
  Service Auth, or a Disable-MFA exception.
- Require an independent MFA method at every Access login with a `0m`
  reauthentication duration.
- Keep the direct Vercel deployment and project aliases outside the accepted
  canonical host.

The 30-minute app inactivity lock stores a signed record bound to both the
Clerk session and Access subject. Unlock starts an Access logout/re-entry
flow and accepts only a different application token issued after the lock;
deleting the app cookie or posting directly to the unlock API cannot bypass
that transition.

Configure every variable listed in `.env.example` separately for the admin
project. Live and Test database bindings must identify different Postgres
host/database targets; different credentials or connection options do not
make one target isolated. Phase 1 validates but does not connect to them.

A full preview requires a separate Cloudflare-protected non-production
hostname with Preview-only values. Raw `*.vercel.app` previews are
intentionally useful only for proving fail-closed denial. Never copy
production Clerk keys into a default Vercel preview or attach a domain
without Gili's explicit approval.
