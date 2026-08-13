# SK-229 Google Calendar verification runbook

Use this runbook only after the SK-229 deployment is running behind the launch
gate with the final production Clerk instance. Use disposable Producer, Artist,
booking, and Google Calendar data.

## Verified console state (13 August 2026)

- Google Cloud project: `skitza-openclaw` (`Skitza Calendar`).
- OAuth client: `Skitza Production`.
- JavaScript origin: `https://skitza.app` only.
- Redirect URI:
  `https://skitza.app/api/integrations/google-calendar/callback` only.
- Consent-screen home, Privacy, and Terms URLs use `https://skitza.app`.
- Authorized domain: `skitza.app` only. Three retired test domains were removed.
- Audience: External, Testing, with `giasraf@gmail.com` and
  `gilkeddler@gmail.com` as test users.
- Non-sensitive scopes: `openid`, `userinfo.email`,
  `calendar.calendarlist.readonly`, and `calendar.events.freebusy`.
- Sensitive scope: `calendar.events`.
- Restricted scopes: none.
- Search Console ownership for `skitza.app` is not complete. Add the CNAME
  record Search Console supplies, verify it publicly, and then complete
  ownership from the Google Cloud project owner account.

Do not publish the OAuth app while the public homepage or Privacy URL is behind
the launch gate. Testing mode limits access to the listed test users and gives
short-lived authorizations, so it is not the final production state.

## Final gated end-to-end proof

Record timestamps, account IDs (not secrets), the deployment SHA, and screenshots
for every step.

1. Sign in as an invited Producer in the final production Clerk instance.
2. Start Google Calendar connection from the Producer Calendar settings.
3. To prove SK-225, remove only Clerk's `__session` cookie while leaving
   `skitza_gcal_oauth_txn` intact, then approve Google consent.
4. Sign in again and confirm that the Google connection was saved.
5. Select one writable destination calendar and the calendars whose busy time
   should block Artist availability.
6. Create a disposable Google busy interval and prove that Skitza removes the
   overlapping booking time.
7. Confirm a disposable session. Verify one linked Google event with both the
   Producer and Artist as attendees.
8. Change the title and time in Skitza. Verify the same event updates in Google.
9. Add a Google-only guest, make another Skitza update, and verify that guest is
   preserved in Google and never appears as a Skitza account or contact.
10. Move the linked event in Google and verify Skitza reconciles the supported
    title/date/start-time change.
11. Delete the linked Google event and prove Skitza offers Restore event and
    Cancel session without silently cancelling the session.
12. Exercise the cancellation path and attendee notification behavior.
13. Disconnect Google. Verify tokens and active calendar selections are cleared,
    sync stops, and existing Google events remain.

Do not reuse the proof data as real customer data. Repeat this matrix after any
change to the production Clerk instance, Google client, callback origin, or
deployment environment.

## English verification video

Record one continuous English walkthrough of the submitted production app:

1. Show the browser address bar on `https://skitza.app` and the public homepage,
   Privacy Notice, and Terms.
2. Sign in with the invited reviewer Producer account.
3. Open Calendar settings and read the complete pre-connection disclosure.
4. Start Connect Google Calendar and show the Google consent screen, app name,
   account, and requested permissions.
5. Choose the writable calendar and busy calendars.
6. Demonstrate busy-time protection.
7. Demonstrate event creation with Producer and Artist attendees, update,
   Google-to-Skitza reconciliation, cancellation, and disconnect.
8. End by showing where the reviewer can disconnect Google and request deletion.

Do not show credentials, OAuth client secrets, Clerk tickets, database URLs,
private customer data, or browser developer panels containing tokens.

## Submission gate

Submit only when all of the following are true:

- `skitza.app` ownership is verified in Search Console by a Google Cloud project
  owner or editor.
- The final homepage, Privacy, and Terms URLs are public without the launch
  token and match the consent-screen links.
- The final gated end-to-end proof above passed on the exact production-bound
  deployment and was repeated after public launch.
- The OAuth app is published to Production.
- Scope justifications describe calendar choice, FreeBusy protection, and
  create/read/update/delete/watch/reconcile of Skitza-linked events.
- The English video is available to Google's reviewers.
- The reviewer email supplied by Google is invited as a Producer, or the review
  account is otherwise made available exactly as Google requests.

Google controls the review timeline. A submitted review is not the same as an
approval, and Skitza must answer any reviewer follow-up before treating this
gate as complete.
