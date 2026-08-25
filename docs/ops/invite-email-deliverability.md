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

### Why it is branded, and what that cost

The first version was bare text. Gili's call after seeing it land (25 Aug 2026):
it had to look official, and it had to remind people what Skitza is, because
the beta list signed up for early access more than two months earlier.

So the invitation now uses Skitza's own email palette — the dark lockup band
(`#0e0d08`), a cream card (`#FBF7F0` on `#F4EFE7`), the Georgia/copper heading
and the amber CTA — matching the templates in `apps/web/src/server/email/`.

**Tab placement is measured, not argued about.** Each version went to a real
Gmail `+tag` address:

| Version | Tab |
| --- | --- |
| Clerk's own invitation | Promotions |
| ours, plain text | **Primary** |
| ours, plain + small logo + reminder | **Primary** |
| ours, fully branded (this one) | **Primary** |

How to re-check after editing the template — in Gmail, or through any Gmail
API client:

```
category:promotions from:gili@send.skitza.app   -> must return nothing
category:primary    from:gili@send.skitza.app   -> must return the message
```

The `category:` operator is the only reliable read. Gmail's API does not expose
`CATEGORY_*` in `labelIds`, so an absent Promotions label proves nothing.

### The logo is an inline attachment, not a hosted URL

Syne is a web font and every mail client strips `@font-face`, so the wordmark
has to be an image. It ships as a ~4 KB PNG attached with a `Content-ID` and
referenced as `<img src="cid:skitzalockup">`, rather than hosted under
`apps/web/public`, because a hosted URL would mean the admin app sends a broken
logo until the web app happens to deploy. Verified on the delivered message:

```
Content-Type: multipart/related; type="text/html"
  text/html   -> <img src="cid:skitzalockup">
  image/png   -> Content-ID: <skitzalockup>
                 Content-Disposition: inline
```

`apps/admin/src/server/registered-users/invite-logo.ts` documents how to
regenerate the crop. The band colour in the template must stay `#0e0d08` — the
PNG carries that background, so any other value draws a rectangle around it.

### What must survive any future redesign

Our own verified sending domain, a From with a human display name, a real
Reply-To, and exactly **one** link. No `List-Unsubscribe` header (it marks
transactional mail as bulk), no tracking pixel, no click tracking, and no
second copy of the link. A test asserts there is exactly one image, so the
lockup cannot quietly grow into a masthead.

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
