"use client";

import { type SyntheticEvent, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { requestPaymentConnection } from "./actions";

// "Payment connection" card on /dashboard/settings → Integrations.
// Three states:
//   1. Connected (terminalName set on producer row) — green badge.
//   2. Request submitted in this session — pending message.
//   3. Not connected — request form (business name + email + phone).
//
// `connected` reflects DB truth from the server. `submitted` is local UI
// state for the "we got your request" confirmation; it doesn't persist
// across reloads — once the admin provisions a terminal, `connected`
// flips to true and the form disappears for good.
export function PaymentCard({
  connected,
  defaultBusinessName,
  defaultContactEmail,
}: {
  connected: boolean;
  defaultBusinessName: string;
  defaultContactEmail: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  const [businessName, setBusinessName] = useState(defaultBusinessName);
  const [contactEmail, setContactEmail] = useState(defaultContactEmail);
  const [phone, setPhone] = useState("");

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await requestPaymentConnection({
        businessName: businessName.trim(),
        contactEmail: contactEmail.trim(),
        phone: phone.trim(),
      });
      if (res.ok) {
        setSubmitted(true);
        toast("Request received. We'll be in touch.", "success");
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <section>
      <header className="mb-3 flex items-center justify-end">
        <StatusBadge connected={connected} pending={submitted} />
      </header>

      {connected && (
        <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-[rgb(var(--fg-secondary))]">
          Your payment connection is active. Artist payments route directly
          to your Tranzila terminal.
        </p>
      )}

      {!connected && submitted && (
        <p className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-sm text-[rgb(var(--fg-secondary))]">
          We&apos;ve received your request. We&apos;ll set up your payment
          connection within 1 business day and notify you when it&apos;s ready.
        </p>
      )}

      {!connected && !submitted && (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="payment-business-name">Business name</Label>
              <Input
                id="payment-business-name"
                type="text"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                }}
                required
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="payment-contact-email">Contact email</Label>
              <Input
                id="payment-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => {
                  setContactEmail(e.target.value);
                }}
                required
              />
            </div>
            <div>
              <Label htmlFor="payment-phone">Phone number</Label>
              <Input
                id="payment-phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                }}
                required
                minLength={5}
                maxLength={30}
                placeholder="+972 50 000 0000"
              />
            </div>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Submitting…" : "Request payment connection"}
          </Button>
        </form>
      )}
    </section>
  );
}

function StatusBadge({
  connected,
  pending,
}: {
  connected: boolean;
  pending: boolean;
}) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    );
  }
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Connection pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--fg-muted))]">
      Not connected
    </span>
  );
}
