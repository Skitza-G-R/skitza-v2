"use client";

import type {
  AgreementMode,
  ProductRoyaltyDraft,
  RoyaltyDraftErrors,
  RoyaltyMode,
} from "../product-editor-draft";

interface RightsAgreementStepProps {
  royalty: ProductRoyaltyDraft;
  agreementMode: AgreementMode;
  contractUrl: string;
  agreementText: string;
  errors: RoyaltyDraftErrors;
  agreementError?: string;
  legacyUnspecified?: boolean;
  onRoyaltyChange: (next: ProductRoyaltyDraft) => void;
  onAgreementChange: (
    patch: Partial<{
      agreementMode: AgreementMode;
      contractUrl: string;
      agreementText: string;
    }>,
  ) => void;
}

const ROYALTY_MODES: readonly { id: RoyaltyMode; label: string }[] = [
  { id: "none", label: "No royalty" },
  { id: "percentage", label: "Percentage" },
  { id: "agreement", label: "Defined in agreement" },
];

const AGREEMENT_MODES: readonly { id: AgreementMode; label: string }[] = [
  { id: "none", label: "No attachment" },
  { id: "link", label: "Add a link" },
  { id: "text", label: "Write terms" },
];

function RoyaltyModePicker({
  name,
  value,
  describedBy,
  onChange,
}: {
  name: string;
  value: RoyaltyMode | null;
  describedBy?: string;
  onChange: (mode: RoyaltyMode) => void;
}) {
  return (
    <div className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {ROYALTY_MODES.map((option) => (
        <label
          key={option.id}
          className="flex min-h-11 cursor-pointer items-center gap-2.5 px-1 py-2.5 sm:px-3"
        >
          <input
            type="radio"
            name={name}
            value={option.id}
            checked={value === option.id}
            aria-describedby={describedBy}
            onChange={() => {
              onChange(option.id);
            }}
            className="h-4 w-4 shrink-0 accent-[rgb(var(--brand-primary))]"
          />
          <span className="text-[12.5px] font-medium leading-snug text-[rgb(var(--fg-default))]">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

function PercentageInput({
  id,
  label,
  value,
  errorId,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  errorId?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
      >
        {label}
      </label>
      <div className="flex h-[46px] items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 focus-within:border-[rgb(var(--brand-primary))] focus-within:ring-2 focus-within:ring-[rgb(var(--brand-primary)/0.2)] sm:h-11 sm:rounded-[var(--radius-md)]">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          aria-describedby={errorId}
          placeholder="0.01–100"
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="h-11 min-w-0 flex-1 border-0 bg-transparent text-base tabular-nums text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))] sm:h-full sm:text-[14px]"
        />
        <span aria-hidden className="text-[13px] font-semibold text-[rgb(var(--fg-muted))]">
          %
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-faint))]">
        Enter an exact percentage from 0.01% to 100%.
      </p>
    </div>
  );
}

export function RightsAgreementStep({
  royalty,
  agreementMode,
  contractUrl,
  agreementText,
  errors,
  agreementError,
  legacyUnspecified = false,
  onRoyaltyChange,
  onAgreementChange,
}: RightsAgreementStepProps) {
  return (
    <div className="flex flex-col gap-7">
      {legacyUnspecified ? (
        <p className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Rights were not specified on this existing product. You can leave them unchanged or define them now.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          Master rights
        </legend>
        <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Your headline share in income from the sound recording.
        </p>
        <RoyaltyModePicker
          name="master-royalty-mode"
          value={royalty.masterMode}
          {...(errors.master ? { describedBy: "master-royalty-error" } : {})}
          onChange={(masterMode) => {
            onRoyaltyChange({ ...royalty, masterMode });
          }}
        />
        {royalty.masterMode === "percentage" ? (
          <PercentageInput
            id="master-royalty-percentage"
            label="Master percentage"
            value={royalty.masterPercentage}
            {...(errors.master ? { errorId: "master-royalty-error" } : {})}
            onChange={(masterPercentage) => {
              onRoyaltyChange({ ...royalty, masterPercentage });
            }}
          />
        ) : null}
        {errors.master ? (
          <p
            id="master-royalty-error"
            role="alert"
            className="text-[12px] font-medium text-[rgb(var(--fg-danger))]"
          >
            {errors.master}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-[rgb(var(--border-subtle))] pt-6">
        <legend className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          Composition rights
        </legend>
        <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Your headline share in the writing, lyrics, arrangement, or publishing.
        </p>
        <RoyaltyModePicker
          name="composition-royalty-mode"
          value={royalty.compositionMode}
          {...(errors.composition
            ? { describedBy: "composition-royalty-error" }
            : {})}
          onChange={(compositionMode) => {
            onRoyaltyChange({ ...royalty, compositionMode });
          }}
        />
        {royalty.compositionMode === "percentage" ? (
          <div className="flex flex-col gap-4">
            <PercentageInput
              id="composition-royalty-percentage"
              label="Composition percentage"
              value={royalty.compositionPercentage}
              {...(errors.composition
                ? { errorId: "composition-royalty-error" }
                : {})}
              onChange={(compositionPercentage) => {
                onRoyaltyChange({ ...royalty, compositionPercentage });
              }}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="composition-role"
                  className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
                >
                  Contribution role
                </label>
                <select
                  id="composition-role"
                  value={royalty.compositionRole}
                  onChange={(event) => {
                    onRoyaltyChange({
                      ...royalty,
                      compositionRole: event.target.value as ProductRoyaltyDraft["compositionRole"],
                    });
                  }}
                  className="h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:rounded-[var(--radius-md)] sm:text-[13px]"
                >
                  <option value="">Not specified</option>
                  <option value="composer">Composer</option>
                  <option value="lyricist">Lyricist</option>
                  <option value="arranger">Arranger</option>
                  <option value="publisher">Publisher</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="collecting-society"
                  className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
                >
                  Collecting society
                </label>
                <input
                  id="collecting-society"
                  type="text"
                  value={royalty.collectingSociety}
                  maxLength={200}
                  placeholder="e.g. ACUM"
                  onChange={(event) => {
                    onRoyaltyChange({
                      ...royalty,
                      collectingSociety: event.target.value,
                    });
                  }}
                  className="h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:rounded-[var(--radius-md)] sm:text-[13px]"
                />
                <p className="text-[11.5px] leading-relaxed text-[rgb(var(--fg-faint))]">
                  Optional. This records the name only; Skitza does not register works.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {errors.composition ? (
          <p
            id="composition-royalty-error"
            role="alert"
            className="text-[12px] font-medium text-[rgb(var(--fg-danger))]"
          >
            {errors.composition}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] pt-6">
        <label
          htmlFor="royalty-notes"
          className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]"
        >
          Rights notes <span className="font-normal text-[rgb(var(--fg-faint))]">(optional)</span>
        </label>
        <textarea
          id="royalty-notes"
          rows={3}
          value={royalty.notes}
          maxLength={4_000}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? "royalty-notes-error" : undefined}
          placeholder="Add a short clarification about these headline terms."
          onChange={(event) => {
            onRoyaltyChange({ ...royalty, notes: event.target.value });
          }}
          className="resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-base leading-relaxed text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:rounded-[var(--radius-md)] sm:text-[13px]"
        />
        {errors.notes ? (
          <p
            id="royalty-notes-error"
            role="alert"
            className="text-[12px] font-medium text-[rgb(var(--fg-danger))]"
          >
            {errors.notes}
          </p>
        ) : null}
      </div>

      <fieldset
        className="flex flex-col gap-3 border-t border-[rgb(var(--border-subtle))] pt-6"
        {...(agreementError ? { "aria-describedby": "agreement-error" } : {})}
      >
        <legend className="font-display text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          Agreement <span className="font-normal text-[rgb(var(--fg-faint))]">(optional)</span>
        </legend>
        <div className="divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))] sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {AGREEMENT_MODES.map((option) => (
            <label
              key={option.id}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 px-1 py-2.5 sm:px-3"
            >
              <input
                type="radio"
                name="agreement-mode"
                value={option.id}
                checked={agreementMode === option.id}
                aria-invalid={agreementError ? true : undefined}
                onChange={() => {
                  onAgreementChange({ agreementMode: option.id });
                }}
                className="h-4 w-4 shrink-0 accent-[rgb(var(--brand-primary))]"
              />
              <span className="text-[12.5px] font-medium text-[rgb(var(--fg-default))]">
                {option.label}
              </span>
            </label>
          ))}
        </div>

        {agreementMode === "link" ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="agreement-link"
              className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
            >
              Public agreement link
            </label>
            <input
              id="agreement-link"
              type="url"
              inputMode="url"
              value={contractUrl}
              maxLength={2048}
              aria-invalid={agreementError ? true : undefined}
              aria-describedby={agreementError ? "agreement-error" : undefined}
              placeholder="https://…"
              onChange={(event) => {
                onAgreementChange({ contractUrl: event.target.value });
              }}
              className="h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-base text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:rounded-[var(--radius-md)] sm:text-[13px]"
            />
          </div>
        ) : null}

        {agreementMode === "text" ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="agreement-text"
              className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
            >
              Agreement text
            </label>
            <textarea
              id="agreement-text"
              rows={7}
              value={agreementText}
              maxLength={20_000}
              aria-invalid={agreementError ? true : undefined}
              aria-describedby={agreementError ? "agreement-error" : undefined}
              placeholder="Write the exact terms the artist will review and accept."
              onChange={(event) => {
                onAgreementChange({ agreementText: event.target.value });
              }}
              className="resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-base leading-relaxed text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:outline-none sm:rounded-[var(--radius-md)] sm:text-[13px]"
            />
            <div className="text-right text-[11px] tabular-nums text-[rgb(var(--fg-faint))]">
              {agreementText.length} characters
            </div>
          </div>
        ) : null}

        {agreementError ? (
          <p
            id="agreement-error"
            role="alert"
            className="text-[12px] font-medium text-[rgb(var(--fg-danger))]"
          >
            {agreementError}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
