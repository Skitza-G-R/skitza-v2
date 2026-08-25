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

**The OTP email is the control group.** `notifications@skitza.app` goes over the
same Clerk SendGrid pool, with the same `X-SG-*` headers and the same
`clkmail.skitza.app` return path — and it lands in Primary. So the bulk-sender
infrastructure is not what decided the tab. What differs is shape: the OTP is a
few lines and a number, while the invitation is a marketing layout with a button
and a footer. (Engagement likely helps too — that address gets opened many times
a week, `invitations@` almost never.) Either way it points at the same fix:
plain content, from an address people actually reply to.

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

**Resend → Domains — already correct**
Click tracking and open tracking are both off. Keep them off, and do **not** add
a tracking subdomain: that exists to redirect every link through a tracking host,
which is the exact thing we are trying to avoid.

The verified sending domain is `send.skitza.app`, so `ADMIN_*_INVITE_FROM` has to
use an address on it (`gili@send.skitza.app`) unless the `skitza.app` root gets
verified in Resend too. Reply-To needs no verification — point it at a real
mailbox you read.

**Clerk → Customization → Emails — nothing to do**
The OTP ("`114497 is your verification code`") already lands in Primary. A
`category:promotions` search over the mailbox returns the invitations and
nothing else — the code emails are not in that list. Leave that template alone.

Do strip the **invitation** template down to plain markup as a fallback, since
a dashboard-created invitation still sends Clerk's mail. Better: invite from the
admin app, not the Clerk dashboard — per `producer-invitations.ts` a dashboard
invitation can't carry the `skitzaProducerInvitation` marker either way.

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
