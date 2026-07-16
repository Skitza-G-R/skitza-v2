export function POST(request: Request): Promise<Response> {
  void request;
  return Promise.resolve(
    new Response("Legacy Tranzila callback disabled", { status: 200 }),
  );
}
