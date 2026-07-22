import type { ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";

type IsolatedClerkSetupInput = Pick<ApprovedSk102Runtime, "clerkPublishableKey" | "clerkSecretKey">;

export function isolatedClerkSetupOptions(runtime: IsolatedClerkSetupInput): Readonly<{
  dotenv: false;
  publishableKey: string;
  secretKey: string;
}> {
  return Object.freeze({
    dotenv: false,
    publishableKey: runtime.clerkPublishableKey,
    secretKey: runtime.clerkSecretKey,
  });
}
