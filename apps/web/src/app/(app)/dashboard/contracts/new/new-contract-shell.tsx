"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PdfUploadZone } from "~/components/contracts/pdf-upload-zone";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";

// Landing card for a fresh draft: optional title + PDF upload zone.
// On successful upload+createDraft the router returns a contractId and
// we navigate straight into the editor for field placement.
//
// Why the title is optional: the uploader falls back to the PDF's
// filename (minus .pdf) if the title field is blank. Most of our
// producers label their contracts "Marcus — mixing" which matches the
// upload filename anyway.

export function NewContractShell() {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/dashboard/contracts"
        className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
      >
        ← All contracts
      </Link>

      <h1
        className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
        style={{ fontWeight: 800 }}
      >
        New contract
      </h1>
      <p className="mt-3 max-w-lg text-sm text-[rgb(var(--fg-secondary))]">
        Upload the PDF to sign — you&apos;ll place signature, date, and text
        fields on the pages in the next step.
      </p>

      <div className="mt-8 space-y-4">
        <div>
          <Label htmlFor="contract-title">Title (optional)</Label>
          <Input
            id="contract-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder="Marcus T. — Mixing + Mastering Agreement"
            maxLength={200}
          />
        </div>

        <PdfUploadZone
          defaultTitle={title}
          onCreated={(id) => {
            toast("Draft created — place your fields.", "success");
            router.push(`/dashboard/contracts/${id}`);
          }}
        />
      </div>
    </div>
  );
}
