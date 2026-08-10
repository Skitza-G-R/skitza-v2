type OperationKeyCrypto = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

export function newCalendarOperationKey(
  prefix: string,
  cryptoApi: OperationKeyCrypto = globalThis.crypto,
): string {
  const operationId =
    typeof cryptoApi.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");

  return `${prefix}:${operationId}`;
}
