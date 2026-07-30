import { RegisteredUsersDirectory } from "~/features/registered-users/directory-view";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import { parseRegisteredUserDirectoryQuery } from "~/server/registered-users/model";
import { createRegisteredUserRuntime } from "~/server/registered-users/runtime";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}) {
  await requireActiveAdminPage();
  const { environment: rawEnvironment } = await params;
  const rawSearch = await searchParams;
  const cursorInput = rawSearch.cursor;
  const rawCursor =
    typeof cursorInput === "string" ? cursorInput.trim() : "";
  const malformedCursor =
    (cursorInput !== undefined && typeof cursorInput !== "string") ||
    (rawCursor !== "" && !/^[A-Za-z0-9_-]{1,2000}$/.test(rawCursor));
  const query = parseRegisteredUserDirectoryQuery(rawSearch);
  const runtime = createRegisteredUserRuntime(rawEnvironment);
  const data = await runtime.repository.findDirectory(query);

  return (
    <RegisteredUsersDirectory
      data={
        malformedCursor && !data.cursorReset
          ? { ...data, cursorReset: true }
          : data
      }
      environment={runtime.environment}
      query={query}
    />
  );
}
