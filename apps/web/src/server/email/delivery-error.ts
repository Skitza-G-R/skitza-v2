export type EmailProviderFailure = Readonly<{
  name: string;
  message: string;
  statusCode: number | null;
}>;

/**
 * The email provider refused a send request. The message stays short and
 * free of provider prose; the provider's own name, message, and status code
 * travel on the error (and as its cause) for logs and the durable outbox.
 */
export class EmailDeliveryError extends Error {
  readonly provider: EmailProviderFailure;

  constructor(provider: EmailProviderFailure) {
    const status = provider.statusCode === null ? "" : ` (${String(provider.statusCode)})`;
    super(`Email delivery failed: ${provider.name}${status}`, { cause: provider });
    this.name = "EmailDeliveryError";
    this.provider = provider;
  }
}
