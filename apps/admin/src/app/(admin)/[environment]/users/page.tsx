import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";
import { parseUserRoleFilter } from "~/features/dashboard/user-demo-workflows";
import { UsersDirectoryView } from "~/features/dashboard/users-view";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<{
    query?: string | string[];
    role?: string | string[];
  }>;
}) {
  const { environment: rawEnvironment } = await params;
  const { query: rawQuery, role: rawRole } = await searchParams;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.searchUsers(environment);
  const query = Array.isArray(rawQuery) ? (rawQuery[0] ?? "") : (rawQuery ?? "");
  const role = parseUserRoleFilter(Array.isArray(rawRole) ? rawRole[0] : rawRole);

  return <UsersDirectoryView data={data} query={query} role={role} />;
}
