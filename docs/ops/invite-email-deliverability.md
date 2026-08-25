# Invite email — getting out of Gmail's Promotions tab

## What was actually wrong

The invitation email was **not** coming from `apps/web/src/server/email/`. It was
Clerk's built-in invitation template, sent over Clerk's shared SendGrid pool.
Raw headers from the 25 Aug 2026 invite to `giasraf+beta1@gmail.com`:

```
From:         Skitza <invitations@skitza.app>
Return-Path:  <bounces+112596138-82a6-...@clkmail.skitza.app>
Received:     from o5.ptr1737.clerk.dev (159.183.147.115)
DKIM:         d=skitza.app s=clk  +  d=sendgrid.info s=smtpapi
Auth-Results: dkim=pass; spf=pass; dmarc=pass (p=NONE sp=NONE)
X-SG-EID / X-SG-ID / X-Entity-Ref-ID: <present>
```

Authentication is fine — SPF, DKIM and DMARC all pass. This was never a spam
problem, it was a **tab classification** problem. Gmail read it as bulk
marketing because of:

1. `X-SG-EID` / `X-SG-ID` — SendGrid's bulk-campaign tracking headers.
2. A `clkmail.skitza.app` return path that doesn't match the From domain.
3. A shared SendGrid IP whose reputation belongs to every Clerk customer.
4. A 600px nested-table layout with `.ExternalClass` / `#outlook a` ESP
   boilerplate, a hidden preheader span, a gradient + box-shadow CTA button
   and a `© 2026 Skitza` footer.
5. The same tokenized accept link repeated twice.
6. No Reply-To, and generic copy ("You are invited to join Skitza.").

DMARC is published at `p=NONE`. That passes, but it's the weakest policy.

## What the code change does

Clerk invitations are now created with `notify: false`, and we send the accept
link ourselves through Resend (`apps/admin/src/server/registered-users/invitation-email.ts`).
That drops signals 1–3 entirely and replaces 4–6 with plain prose, one text
link, a human From name and a working Reply-To.

Side effect worth knowing: Clerk only ever emailed on *create*, so the admin
"re-send invitation" button silently sent nothing when it reused a pending
invitation. It sends now.

### Required env (per environment — see `apps/admin/.env.example`)

```
ADMIN_LIVE_RESEND_API_KEY=re_...
ADMIN_LIVE_INVITE_FROM=Gili from Skitza <gili@skitza.app>
ADMIN_LIVE_INVITE_REPLY_TO=gili@skitza.app
```

`ADMIN_*_INVITE_FROM` must carry a display name and a mailbox that genuinely
receives mail. The reply path is doing real work here — see below.

## Dashboard steps (not code)

**Resend → Domains → skitza.app → Settings**
- Open tracking: **off**. Click tracking: **off**. Both rewrite links through a
  tracking domain or embed a 1×1 pixel — two more Promotions signals.

**Clerk → Customization → Emails**
The OTP ("`114497 is your verification code`") and new-device emails still go
out over Clerk's SendGrid and cannot be moved to Resend. A verification code in
Promotions is worse than an invite there — the user can't sign in at all. Strip
each template down to plain markup: keep whatever `{{ }}` variables the
existing template already uses, delete everything around them.

```html
<p>Hi — here's your Skitza verification code:</p>
<p style="font-size:24px;font-weight:600;">{{ keep the existing code variable }}</p>
<p>It expires shortly. If you didn't ask for it, you can ignore this email.</p>
<p>— Gili</p>
```

No logo, no table wrapper, no button, no footer, no `©` line. Set the sender
name to a person, not `Skitza`.

Also leave the invitation template stripped the same way as a fallback: a
dashboard-created invitation still sends Clerk's mail, and per
`producer-invitations.ts` it also can't carry the `skitzaProducerInvitation`
marker. Invite from the admin app, not the Clerk dashboard.

## The lever that beats all of the above

Gmail's per-recipient learning outweighs every content heuristic. One reply
from a recipient, or one drag into Primary, and every future email from that
address lands in Primary **for that person, permanently**.

For a beta of tens of people this is the highest-leverage move available: when
you tell someone on WhatsApp that their invite is coming, ask them to reply
"in" to it. That is also why `ADMIN_*_INVITE_REPLY_TO` must be a real mailbox.

## Worth doing later

- Move DMARC from `p=none` to `p=quarantine` once you've watched `rua` reports
  for a couple of weeks and confirmed both senders align.
- Keep Clerk's auth mail and Skitza's product mail on separate subdomains so
  one sender's reputation can't drag the other down.
