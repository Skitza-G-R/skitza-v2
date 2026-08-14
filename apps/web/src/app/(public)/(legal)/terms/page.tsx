import type { ReactNode } from "react";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="py-16 md:py-24">
      <p className="font-mono text-[0.72rem] tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
        Terms of service
      </p>
      <h1 className="font-syne mt-3 text-5xl leading-tight font-extrabold tracking-tight">
        The rules for using Skitza.
      </h1>
      <p className="mt-2 font-mono text-sm text-[rgb(var(--fg-muted))]">
        Last updated: August 13, 2026
      </p>

      <div className="mt-12 space-y-10 text-[rgb(var(--fg-secondary))]">
        <Section title="Agreeing to these terms">
          <p>
            These Terms are an agreement between you and Gili Asraf, who operates Skitza as an
            Israeli <span lang="he">עוסק מורשה</span> (registration number 315016071) from Ein Gedi
            7, Hadera, Israel. By accessing or using Skitza, you agree to these Terms and the
            Privacy Notice.
          </p>
          <p className="mt-3">
            You may use Skitza only if you are at least 18 years old and can legally agree to these
            Terms. If you use Skitza for a business or another person, you confirm that you have
            authority to act for them.
          </p>
        </Section>

        <Section title="What Skitza provides">
          <p>
            Skitza is a web service for independent music Producers. It helps Producers manage
            clients, projects, products, offers, bookings, accepted terms, external-payment records,
            music versions, feedback, approvals, and controlled delivery. Artists use a
            Producer&apos;s Skitza link to join that studio and work with the Producer.
          </p>
          <p className="mt-3">
            Producer access is invitation-only. Artist access begins through a valid Producer join
            flow. One person may have both roles on the same account, but an invitation, account, or
            access right may not be sold, transferred, or shared with another person.
          </p>
        </Section>

        <Section title="Your account">
          <List>
            <li>Provide accurate information and keep it reasonably current.</li>
            <li>
              Protect your sign-in method and tell us promptly if your account is compromised.
            </li>
            <li>
              You are responsible for actions taken through your account unless those actions result
              from Skitza&apos;s own security failure.
            </li>
            <li>
              Do not access another studio, Artist relationship, file, invitation, or account
              without permission.
            </li>
          </List>
        </Section>

        <Section title="Your content and permissions">
          <p>
            You keep ownership of audio, artwork, names, messages, terms, documents, and other
            content you submit. You give Skitza a limited, non-exclusive permission to host, copy,
            process, display, transmit, and deliver that content only as needed to operate, secure,
            and support the service and the sharing choices you make.
          </p>
          <p className="mt-3">
            You confirm that you have the rights and permissions needed for content and personal
            information you submit, including permission to invite or notify other people. You
            remain responsible for your music, business promises, prices, rights, tax treatment,
            payment instructions, and dealings with other users.
          </p>
        </Section>

        <Section title="Agreements and external payments">
          <p>
            Producers set their services, prices, rights, royalty terms, payment plans, and external
            payment instructions. Artists can review and accept the exact terms shown to them.
            Skitza stores accepted terms and related history as a durable record, so users must
            review them carefully before accepting.
          </p>
          <p className="mt-3">
            Payments happen outside Skitza, directly between the Producer and Artist. Skitza does
            not take, hold, route, split, refund, or process money or payment cards. Skitza can
            store payment instructions, uploaded proof, and the payment status recorded by the
            Producer. Users are responsible for resolving payment mistakes, refunds, taxes, and
            commercial disputes with each other and for following applicable law.
          </p>
        </Section>

        <Section title="Google Calendar">
          <p>
            A Producer may optionally connect Google Calendar. Skitza uses the permissions the
            Producer grants to list calendars, check selected calendars for busy time, and create,
            update, cancel, watch, and reconcile Skitza-linked session events. The Producer can
            disconnect from the Calendar control. Existing Google events remain after disconnect
            unless they are removed in Google Calendar.
          </p>
          <p className="mt-3">
            When Skitza delivers a confirmed session through the Producer&apos;s connected Google
            Calendar, Skitza asks Google to send calendar invitations and updates to the Producer
            and Artist attendees on the Producer&apos;s behalf.
          </p>
          <p className="mt-3">
            Google Calendar is a third-party service governed by Google&apos;s terms. Skitza cannot
            guarantee Google&apos;s availability or preserve sync when Google changes, limits, or
            revokes access. The Privacy Notice explains the Google data Skitza accesses, stores,
            uses, shares, and deletes.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>Do not use Skitza to:</p>
          <List>
            <li>Upload or share content you do not have the right to use.</li>
            <li>Infringe privacy, copyright, publicity, or other legal rights.</li>
            <li>Harass, threaten, deceive, discriminate against, or harm another person.</li>
            <li>Send spam, phishing, malware, or unlawful messages.</li>
            <li>
              Probe, bypass, overload, scrape, reverse engineer, or disrupt security controls.
            </li>
            <li>Misrepresent payments, approvals, identity, usage, or business records.</li>
            <li>Use Google user data in a way that violates Google&apos;s API policies.</li>
          </List>
        </Section>

        <Section title="Beta access and service changes">
          <p>
            Skitza&apos;s current beta is offered only to users in Israel, and Producer access is
            free during the beta. The current Producer audio-storage limit is 1 GB. We do not
            currently collect payment-card details for use of the Skitza platform. If a paid
            platform plan is introduced later, we will present its price and terms before charging
            anyone.
          </p>
          <p className="mt-3">
            We may add, change, pause, or remove features to improve, secure, or operate the
            service. We may also set reasonable usage limits. We will not silently rewrite an
            Artist&apos;s accepted commercial terms or confirmed payment history when platform
            features change.
          </p>
        </Section>

        <Section title="Availability and third-party services">
          <p>
            We work to keep Skitza available and records accurate, but beta software and third-party
            services can fail or be interrupted. Skitza is provided on an “as available” basis to
            the extent permitted by law. Keep copies of files and records that are critical to your
            business. We do not guarantee uninterrupted access, delivery, Calendar sync, email
            delivery, or a particular business result.
          </p>
          <p className="mt-3">
            Nothing in these Terms limits a right or remedy that applicable law does not allow us to
            limit.
          </p>
        </Section>

        <Section title="Suspension, closure, and retained records">
          <p>
            You may stop using Skitza and ask us to close your account. You can disconnect Google
            Calendar and disable or delete eligible content using available controls. We may
            restrict or suspend access when reasonably needed to protect users or Skitza,
            investigate misuse, comply with law, or address a serious breach of these Terms.
          </p>
          <p className="mt-3">
            Account closure does not automatically erase every shared or historical record. Accepted
            agreements, purchases, payment records and proofs, sessions, approvals, security
            records, and related history may be retained as described in the Privacy Notice.
            Provisions that by their nature need to continue after closure remain in effect,
            including content permissions needed for retained records and rules about responsibility
            and disputes.
          </p>
        </Section>

        <Section title="Governing law and disputes">
          <p>
            Israeli law governs these Terms. Nothing in these Terms overrides any mandatory consumer
            protection or other right that applicable law does not allow us to limit.
          </p>
          <p className="mt-3">
            Before starting court proceedings, email <MailLink address="legal@skitza.app" /> and try
            in good faith to resolve the dispute in writing. This step does not prevent either side
            from asking a court for an urgent order or using a right that mandatory law allows
            immediately.
          </p>
          <p className="mt-3">
            If the dispute is not resolved, the courts with legal authority in Tel Aviv–Jaffa,
            Israel, will have jurisdiction, subject to any mandatory right to bring a claim
            elsewhere. These Terms do not require arbitration.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            We may update these Terms as Skitza changes. We will update the date above and give
            additional notice when a material change requires it. Changes apply going forward and do
            not silently rewrite already accepted Producer–Artist commercial terms.
          </p>
          <p className="mt-3">
            For a contractual or Terms question, email <MailLink address="legal@skitza.app" />. For
            a privacy request, email <MailLink address="privacy@skitza.app" />. We aim to send an
            initial response to messages at either address within 7 business days.
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
