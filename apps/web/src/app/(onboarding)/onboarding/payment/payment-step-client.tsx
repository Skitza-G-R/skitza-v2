"use client";

import { CheckCircle2, LockKeyhole, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type InputHTMLAttributes } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

import { saveOnboardingPaymentInstructions } from "./actions";
import {
  parseBankTransferDetails,
  serializeBankTransferDetails,
  type BankTransferFields,
} from "./bank-transfer";
import {
  PAYMENT_STEP_INDEX,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

export interface PaymentInstructionsFormState {
  bankTransfer: string;
  bitPhone: string;
  note: string;
}

const INPUT_CLASS =
  "min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[14px] text-[rgb(var(--fg-default))] outline-none transition-[border-color,box-shadow] placeholder:text-[rgb(var(--fg-muted)/0.65)] focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.16)] disabled:cursor-not-allowed disabled:opacity-60";

export function PaymentStepClient({
  initialInstructions,
  previewMode = false,
}: {
  initialInstructions: PaymentInstructionsFormState;
  previewMode?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const parsedBankDetails = parseBankTransferDetails(initialInstructions.bankTransfer);
  const [bankFields, setBankFields] = useState<BankTransferFields>(parsedBankDetails.fields);
  const [bankFieldsTouched, setBankFieldsTouched] = useState(false);
  const [bitPhone, setBitPhone] = useState(initialInstructions.bitPhone);
  const [note, setNote] = useState(initialInstructions.note);
  const [error, setError] = useState<string | null>(null);

  const updateBankField = (key: keyof BankTransferFields, value: string) => {
    setBankFields((current) => ({ ...current, [key]: value }));
    setBankFieldsTouched(true);
    if (error) setError(null);
  };

  const handleContinue = () => {
    setError(null);
    if (previewMode) {
      router.push(nextRouteAfterPayment(true));
      return;
    }
    if (!online) {
      setError("Reconnect to save your payment details.");
      return;
    }

    startTransition(async () => {
      try {
        const bankTransfer = bankFieldsTouched
          ? serializeBankTransferDetails(bankFields)
          : initialInstructions.bankTransfer;
        const result = await saveOnboardingPaymentInstructions({
          bankTransfer,
          bitPhone,
          note,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(nextRouteAfterPayment(false));
      } catch {
        setError("Could not save your payment details. Try again.");
      }
    });
  };

  return (
    <WizardChrome
      activePosition={PAYMENT_STEP_INDEX}
      completedCount={5}
      stepIndicator="Optional payment details"
      hideOuterProgress
      canExit={!previewMode}
      previewMode={previewMode}
      footer={
        <WizardFooter
          onBack={() => {
            router.push(routeOnBackFromPayment(previewMode));
          }}
          onSkip={() => {
            router.push(routeOnSkipFromPayment(previewMode));
          }}
          onContinue={handleContinue}
          continueLabel="Save details"
          pending={pending}
        />
      }
    >
      <div className="ob-stagger mx-auto w-full max-w-[620px]">
        <p className="font-mono text-[11px] font-bold tracking-[0.22em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Optional payment detail
        </p>
        <h1
          className="font-display mt-3 text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Payments stay between you and the artist.
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Your public page is already ready. Add bank or Bit details now, or come back later.
        </p>

        <div
          role="note"
          className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        >
          <div className="flex items-start gap-3.5 p-4">
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
            >
              <Wallet size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                External payments only
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                Skitza does not connect a payment provider and never holds, routes, or processes
                money. Artists pay you directly using bank or Bit details.
              </p>
            </div>
          </div>
          <div className="grid border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.55)] sm:grid-cols-2 sm:divide-x sm:divide-[rgb(var(--border-subtle))]">
            <div className="flex gap-2.5 px-4 py-3">
              <LockKeyhole
                aria-hidden
                size={15}
                className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary-dark))]"
              />
              <p className="text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                Artists see these details only after you approve their request.
              </p>
            </div>
            <div className="flex gap-2.5 border-t border-[rgb(var(--border-subtle))] px-4 py-3 sm:border-t-0">
              <CheckCircle2
                aria-hidden
                size={15}
                className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary-dark))]"
              />
              <p className="text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                The artist uploads proof. You verify or reject it.
              </p>
            </div>
          </div>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleContinue();
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <legend className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
              Bank details
              <span className="ml-1.5 text-[12px] font-normal text-[rgb(var(--fg-muted))]">
                Optional
              </span>
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              <PaymentField
                id="payment-account-owner"
                label="Account owner"
                value={bankFields.accountOwner}
                maxLength={100}
                autoComplete="name"
                placeholder="Your full name"
                onChange={(value) => {
                  updateBankField("accountOwner", value);
                }}
              />
              <PaymentField
                id="payment-bank"
                label="Bank"
                value={bankFields.bank}
                maxLength={100}
                placeholder="Bank name"
                onChange={(value) => {
                  updateBankField("bank", value);
                }}
              />
              <PaymentField
                id="payment-branch"
                label="Branch"
                value={bankFields.branch}
                maxLength={80}
                placeholder="Branch number"
                onChange={(value) => {
                  updateBankField("branch", value);
                }}
              />
              <PaymentField
                id="payment-account-number"
                label="Account number"
                value={bankFields.accountNumber}
                maxLength={100}
                placeholder="Account number"
                onChange={(value) => {
                  updateBankField("accountNumber", value);
                }}
              />
            </div>

            {parsedBankDetails.preservedText && !bankFieldsTouched ? (
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3.5 py-3">
                <div className="text-[11px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
                  Current saved bank details
                </div>
                <pre className="mt-1.5 font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-default))]">
                  {parsedBankDetails.preservedText}
                </pre>
                <p className="mt-1.5 text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                  Kept as-is unless you edit a bank field above.
                </p>
              </div>
            ) : null}

            <PaymentField
              id="payment-bit-phone"
              label="Bit phone"
              value={bitPhone}
              maxLength={32}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+972 50 123 4567"
              hint="The phone number connected to your Bit account."
              onChange={(value) => {
                setBitPhone(value);
                if (error) setError(null);
              }}
            />

            <label className="block" htmlFor="payment-note">
              <span className="text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
                Note
                <span className="ml-1.5 font-normal text-[rgb(var(--fg-muted))]">Optional</span>
              </span>
              <textarea
                id="payment-note"
                rows={3}
                maxLength={500}
                value={note}
                placeholder="Add a payment reference or a short instruction"
                className={`${INPUT_CLASS} mt-1.5 resize-y py-3 leading-relaxed`}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (error) setError(null);
                }}
              />
            </label>
          </fieldset>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3.5 py-2.5 text-[13px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </WizardChrome>
  );
}

function PaymentField({
  id,
  label,
  value,
  onChange,
  hint,
  ...inputProps
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
} & Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "autoComplete" | "inputMode" | "maxLength" | "placeholder" | "type"
>) {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">{label}</span>
      <input
        {...inputProps}
        id={id}
        value={value}
        className={`${INPUT_CLASS} mt-1.5`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint ? (
        <span className="mt-1.5 block text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
