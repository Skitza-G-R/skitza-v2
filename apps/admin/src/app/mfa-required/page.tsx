import { redirect } from "next/navigation";

import { requireFounderRolePage } from "~/server/auth/page-access";

export default async function MfaRequiredPage() {
  await requireFounderRolePage();
  redirect("/unlock");
}
