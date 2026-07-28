# Skitza Admin

Private founder-only operations app for `admin.skitza.app`.

## Deployment boundary

Create a separate Vercel project with **Root Directory** set to
`apps/admin`. Do not attach `admin.skitza.app` or promote a production
deployment without Gili's explicit approval for that exact deployment.

The project reuses Skitza's Clerk application so Gili signs in with her
normal account. Founder access is granted through server-only Clerk private
metadata:

```json
{ "skitzaAdminRole": "founder" }
```

Configure every variable listed in `.env.example` separately for the admin
project. Live and Test database bindings must identify different Postgres
host/database targets; different credentials or connection options do not
make one target isolated. The Phase 1 app validates those bindings but never
connects to either database.

For a `*.vercel.app` preview, use the Clerk development instance and grant
the founder role in that instance's server-only private metadata. Do not copy
production Clerk keys into the default Vercel preview domain.
