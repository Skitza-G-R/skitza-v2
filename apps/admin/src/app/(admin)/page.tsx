import { EnvironmentChoice } from "~/components/environment-choice";
import { requireActiveAdminPage } from "~/server/auth/page-access";

export default async function AdminHomePage() {
  await requireActiveAdminPage();
  return <EnvironmentChoice />;
}
