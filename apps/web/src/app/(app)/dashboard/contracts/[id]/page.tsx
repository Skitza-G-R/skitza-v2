import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { BUCKETS, getR2 } from "~/server/storage/r2";
import { ContractEditor } from "./editor";

type PageProps = { params: Promise<{ id: string }> };

// Contract detail — edit mode for drafts, read-only preview for sent+.
// Fields & recipients come from the router. PDF access is mediated by
// a presigned GET URL (15-minute TTL) — the R2 bucket is private and
// we don't publish a CDN URL for contracts.
export default async function ContractDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });
  let detail;
  try {
    detail = await caller.contract.detail({ id });
  } catch {
    notFound();
  }

  const pdfUrl = await getSignedUrl(
    getR2(),
    new GetObjectCommand({
      Bucket: BUCKETS.docs,
      Key: detail.contract.pdfR2Key,
    }),
    { expiresIn: 900 },
  );

  const siteUrl = process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app";

  return (
    <AppShell active="contracts">
      <ContractEditor
        contract={{
          id: detail.contract.id,
          title: detail.contract.title,
          status: detail.contract.status,
          pdfUrl,
        }}
        initialFields={detail.fields.map((f) => ({
          id: f.id,
          page: f.page,
          x: Number(f.x),
          y: Number(f.y),
          w: Number(f.w),
          h: Number(f.h),
          type: f.type,
          required: f.required,
          recipientId: f.recipientId,
          prefilledValue: f.prefilledValue,
          options: f.options as Record<string, unknown> | null,
        }))}
        initialRecipients={detail.recipients.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          signedAt: r.signedAt,
        }))}
        siteUrl={siteUrl}
      />
    </AppShell>
  );
}
