import type { ReactNode } from "react";

export const metadata = { title: "Privacy" };

const GOOGLE_USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";

export default function PrivacyPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
        Privacy notice
      </p>
      <h1 className="font-syne mt-3 text-5xl leading-tight font-extrabold tracking-tight">
        Your data, in plain English.
      </h1>
      <p className="mt-2 font-mono text-sm text-[rgb(var(--fg-muted))]">
        Last updated: August 13, 2026
      </p>

      <div className="mt-12 space-y-10 text-[rgb(var(--fg-secondary))]">
        <Section title="Who this notice covers">
          <p>
            This notice explains how Skitza handles personal information when Producers, Artists,
            public visitors, and people who contact us use skitza.app. Skitza is operated by Gili
            Asraf as an Israeli <span lang="he">עוסק מורשה</span> (registration number 315016071)
            from Ein Gedi 7, Hadera, Israel.
          </p>
          <p className="mt-3">
            Skitza is a web service for independent music Producers and the Artists they work with.
            Gili Asraf is responsible for the personal information handled through Skitza.
          </p>
          <p className="mt-3">
            Questions or privacy requests can be sent to <MailLink address="privacy@skitza.app" />.
            We aim to send an initial response within 7 business days.
          </p>
        </Section>

        <Section title="Age limit">
          <p>
            Skitza&apos;s Israel-only beta is for people aged 18 or older. We do not knowingly offer
            accounts to people under 18. If you believe someone under 18 has given us personal
            information, email <MailLink address="privacy@skitza.app" />.
          </p>
        </Section>

        <Section title="Information we collect">
          <List>
            <li>
              <strong>Account and profile data:</strong> your name, email address, authentication
              identifier, account role, profile image, studio name and URL, timezone, currency,
              brand settings, preferences, and sign-in status.
            </li>
            <li>
              <strong>Client and studio data:</strong> contact details, private Producer notes,
              tags, projects, products, offers, accepted terms, sessions, comments, files, artwork,
              credits, notification choices, and availability settings.
            </li>
            <li>
              <strong>External-payment records:</strong> a Producer&apos;s payment instructions, the
              price and payment plan users agree to, payment status, and proof of a payment made
              outside Skitza. Skitza does not collect payment-card details or move money between
              Producers and Artists.
            </li>
            <li>
              <strong>Communications:</strong> messages and transactional email details needed for
              invitations, bookings, reminders, comments, payment updates, and support.
            </li>
            <li>
              <strong>Technical and usage data:</strong> IP address, browser and device data, pages
              and features used, request and error details, security events, and similar operational
              data. Depending on our production configuration, this can include analytics and
              session-replay data described below.
            </li>
          </List>
        </Section>

        <Section title="How we use information">
          <List>
            <li>Authenticate users and keep Producer and Artist workspaces separate.</li>
            <li>
              Operate profiles, projects, bookings, agreements, external-payment records, audio
              review, controlled downloads, notifications, and support.
            </li>
            <li>Protect accounts and files, prevent abuse, troubleshoot, and improve Skitza.</li>
            <li>
              Keep an accurate history of accepted terms, work, sessions, payment records, and
              changes where that history is part of the service users asked us to provide.
            </li>
          </List>
        </Section>

        <Section title="Google Calendar data">
          <p>
            Connecting Google Calendar is optional and available only to a Producer. We request
            access only after the Producer chooses <strong>Connect Google Calendar</strong>.
          </p>

          <h3 className="mt-5 font-bold text-[rgb(var(--fg-primary))]">What we access</h3>
          <List>
            <li>The connected Google account identifier and email address.</li>
            <li>
              The calendar list, including calendar names, timezones, access roles, and which
              calendar is primary, so the Producer can choose calendars inside Skitza.
            </li>
            <li>
              Busy and free time from the calendars the Producer selects, so Skitza can avoid
              offering times that are already busy.
            </li>
            <li>
              Google&apos;s event permission covers the calendars you can access. Skitza uses it to
              create, update, read, delete, watch, and reconcile Skitza session events in the
              destination calendar the Producer chooses.
            </li>
            <li>
              Those session events can include the session title and time, Producer and Artist names
              and email addresses, RSVP status, an Artist-safe Skitza link, and private linkage
              metadata. When updating an existing Skitza-linked event, Skitza may read and preserve
              the email address, display name, and RSVP status of other attendees already on that
              event. This reading is temporary; Skitza does not save those other attendees in its
              database.
            </li>
          </List>

          <h3 className="mt-5 font-bold text-[rgb(var(--fg-primary))]">What we store</h3>
          <p className="mt-3">
            We store the connected Google account identifier and email, granted permissions,
            connection and sync status, encrypted access and refresh tokens, calendar names and
            timezones, access roles, selected-calendar settings, encrypted calendar identifiers, and
            limited linked-event and sync records. Google access and refresh tokens are encrypted
            before they are stored.
          </p>
          <p className="mt-3">
            For unrelated Google events, Skitza uses busy/free intervals and does not store or
            display their title, attendees, description, location, Google Meet details, or
            reminders. Artists can see which Skitza booking times are available; they do not see the
            Producer&apos;s unrelated Google event details.
          </p>

          <h3 className="mt-5 font-bold text-[rgb(var(--fg-primary))]">
            How Google data is used and shared
          </h3>
          <p className="mt-3">
            We use Google data only to provide the visible Calendar features described above,
            maintain and secure the integration, provide support, and comply with law. We do not
            sell Google user data, use it for advertising or credit decisions, or use it to train a
            generalized AI model. We disclose it only to service providers acting for Skitza where
            needed to host, secure, operate, or troubleshoot the integration; when the user directs
            or consents to the disclosure; or when security or law requires it.
          </p>
          <p className="mt-3">
            When Skitza delivers a confirmed session through the Producer&apos;s connected Google
            Calendar, Skitza asks Google to send calendar invitations and updates to the Producer
            and Artist attendees on the Producer&apos;s behalf.
          </p>
          <p className="mt-3">
            People at Skitza or its service providers do not read Google user data unless you
            specifically ask for support and agree to that access, the access is needed to
            investigate a security or abuse incident, the law requires it, or the data has been
            aggregated and de-identified for internal operations.
          </p>
          <p className="mt-3">
            Skitza&apos;s use of information received from Google Workspace APIs will adhere to the{" "}
            <ExternalLink href={GOOGLE_USER_DATA_POLICY}>
              Google API Services User Data Policy
            </ExternalLink>
            , including its Limited Use requirements.
          </p>

          <h3 className="mt-5 font-bold text-[rgb(var(--fg-primary))]">
            Disconnecting or deleting Google data
          </h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>
              Open <strong>Dashboard → Calendar</strong>, open the Google Calendar control, and
              choose <strong>Disconnect</strong>.
            </li>
            <li>
              Skitza then tries to stop Calendar notifications and revoke Google authorization,
              permanently clears the stored access and refresh tokens, and removes the saved
              calendar selections. New changes stop syncing.
            </li>
            <li>
              Existing Google events remain in Google Calendar and can be removed there. A retained
              technical record can include the Google account identifier and email, encrypted
              destination-calendar identifiers, Google event or watch identifiers, permissions, sync
              status, timestamps, safe error codes, and linked booking history. It does not include
              the cleared tokens or active calendar selections.
            </li>
            <li>
              To request deletion of the remaining Google-derived account or operational data, email{" "}
              <MailLink address="privacy@skitza.app" /> from the account email. We may need to
              verify your identity. You can also remove Skitza from your Google Account&apos;s
              third-party connections, but that alone does not delete data already stored by Skitza.
            </li>
          </ol>
        </Section>

        <Section title="Analytics, diagnostics, and browser storage">
          <p>
            When configured, PostHog helps us understand page and feature use. For signed-in users,
            it can receive the Clerk user ID, email address, first name, pageviews, and product
            events. We configure it to respect the browser&apos;s Do Not Track setting.
          </p>
          <p className="mt-3">
            When configured, Sentry receives error, performance, request, device, and diagnostic
            information. That information may include an IP address or account context. Sentry
            session replay is currently disabled. Public song-listening and invitation routes have
            additional collection protections.
          </p>
          <p className="mt-3">
            Skitza and Clerk use cookies and similar browser storage for sign-in, security, language
            and studio preferences, invitation flow, uploads, playback, and offline or recent-audio
            behavior. Clearing site data in your browser removes locally stored Skitza data and may
            sign you out.
          </p>
        </Section>

        <Section title="When we share information">
          <p>
            We use service providers to run Skitza. They process information for the function listed
            here and under their own service terms and privacy commitments:
          </p>
          <List>
            <li>Clerk — authentication, account management, and invitations.</li>
            <li>Neon — database hosting.</li>
            <li>Vercel — website hosting and server runtime.</li>
            <li>Cloudflare R2 — audio, artwork, documents, and payment-proof storage.</li>
            <li>Resend — transactional email delivery.</li>
            <li>Namecheap — domain-name service and legal and privacy email forwarding.</li>
            <li>
              Google — the optional Google Calendar connection and attendee updates, and Gmail for
              receiving and storing forwarded legal and privacy requests.
            </li>
            <li>PostHog — product analytics, when configured.</li>
            <li>Sentry — error, performance, and diagnostic information, when configured.</li>
          </List>
          <p className="mt-3">
            We may also disclose information when a user directs us to, to protect users or the
            service, in response to a valid legal requirement, or as part of a business transfer
            subject to applicable notice and consent requirements. We do not sell personal
            information or use it for targeted advertising.
          </p>
          <p className="mt-3">
            Messages sent to <MailLink address="legal@skitza.app" /> or{" "}
            <MailLink address="privacy@skitza.app" /> pass through Namecheap email forwarding and
            are received in Google Gmail. The information processed can include the sender&apos;s
            name and email address, recipients, subject, message, attachments, and delivery details.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            We keep information for as long as needed to provide and secure Skitza, maintain the
            records users asked us to keep, resolve disputes, and meet legal obligations. Account,
            project, content, booking, and operational records can remain while an account or
            relationship is active. For records controlled by Skitza, the following limits apply:
          </p>
          <List>
            <li>
              Google access and refresh tokens stored by Skitza and saved calendar selections are
              removed immediately when the Producer disconnects Google Calendar. Limited account,
              event, watch, and sync identifiers can remain when needed for safe reconnection,
              shared booking history, security, or legal obligations.
            </li>
            <li>
              After we verify an account-closure request, we delete or de-identify non-shared
              account, profile, and audio data within 30 days, unless it must be kept for a legal or
              security reason.
            </li>
            <li>Backups may retain deleted information for up to 90 days.</li>
            <li>Security and diagnostic logs may be kept for up to 12 months.</li>
            <li>
              Accepted terms, external-payment records and proofs, sessions, and related audit
              history may be kept for up to 7 years when needed to preserve a shared record, resolve
              a dispute, establish or defend a legal claim, prevent fraud, or meet a legal
              record-keeping obligation.
            </li>
            <li>
              Legal, privacy, and support messages are kept only as long as needed to answer the
              request, keep a relevant business or legal record, resolve a dispute, or meet a legal
              obligation.
            </li>
          </List>
          <p className="mt-3">
            When retention is no longer needed, we delete or de-identify the information where
            practical. Service providers may retain their own limited logs and backups under their
            commitments and applicable law.
          </p>
        </Section>

        <Section title="Your choices and requests">
          <p>
            Depending on where you live, you may have rights to access, correct, export, object to,
            restrict, or delete personal information. You can change many profile, notification,
            file, public-link, and Calendar settings inside Skitza. For another request, email{" "}
            <MailLink address="privacy@skitza.app" />. We may verify your identity and may keep
            information where the law or the integrity of another user&apos;s shared record requires
            it.
          </p>
        </Section>

        <Section title="Security and changes">
          <p>
            We use access controls, HTTPS, encrypted Google tokens, hashed public-link tokens, and
            private or short-lived file-delivery methods. No online service can promise perfect
            security.
          </p>
          <p className="mt-3">
            We may update this notice when the service or our legal obligations change. We will
            update the date above and provide additional notice when a material change requires it.
            We will ask for consent before using previously collected Google data for a new purpose
            when Google&apos;s policies or applicable law require it.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-syne text-2xl font-bold tracking-tight text-[rgb(var(--fg-primary))]">
        {title}
      </h2>
      <div className="mt-3 leading-relaxed">{children}</div>
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5">{children}</ul>;
}

function MailLink({ address }: { address: string }) {
  return (
    <a className="font-medium underline underline-offset-4" href={`mailto:${address}`}>
      {address}
    </a>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="font-medium underline underline-offset-4"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
