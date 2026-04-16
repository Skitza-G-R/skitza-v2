import { SignUp } from "@clerk/nextjs";

// TODO(phase-2): pass `appearance={{ baseTheme: dark }}` from @clerk/themes
// once the chrome-dark token set lands; default Clerk light fights our shell.
export default function Page() {
  return <SignUp />;
}
