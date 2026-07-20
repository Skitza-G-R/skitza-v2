import { AudioDeliveryStorageError } from "./storage";
import { AudioDeliveryDomainError } from "./policy";
import { AudioDeliveryTokenError } from "./tokens";

function hidden(status: 403 | 404): Response {
  return new Response(status === 403 ? "Forbidden" : "Not found", {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function audioDeliveryErrorResponse(error: unknown): Response {
  if (error instanceof AudioDeliveryDomainError) {
    return hidden(error.code === "PAYMENT_REQUIRED" ? 403 : 404);
  }
  if (error instanceof AudioDeliveryStorageError || error instanceof AudioDeliveryTokenError) {
    return hidden(404);
  }
  throw error;
}

export function audioNotFoundResponse(): Response {
  return hidden(404);
}
