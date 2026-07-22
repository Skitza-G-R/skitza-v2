export function safePlaywrightArguments(argv: readonly string[]): readonly string[] {
  if (argv.length === 0) return [];
  if (argv.length === 1 && argv[0] === "--list") return ["--list"];
  throw new Error("SK102_BROWSER_ARGUMENT_FORBIDDEN");
}
