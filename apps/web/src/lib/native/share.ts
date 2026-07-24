export interface NativeSharePayload {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
  fallbackText?: string;
}

export type NativeShareResult =
  | { status: "shared"; method: "native" }
  | { status: "copied"; method: "clipboard" }
  | { status: "cancelled"; method: "native" }
  | { status: "unavailable"; method: "none" };

interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
  clipboard?: {
    writeText: (text: string) => Promise<void>;
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function buildFallbackText(payload: NativeSharePayload): string {
  return payload.fallbackText ?? payload.url ?? payload.text ?? payload.title ?? "";
}

/**
 * Prefer the platform share sheet and fall back to copying a useful value.
 * Cancelling the system sheet is returned distinctly and never produces an
 * unexpected clipboard write.
 */
export async function shareNative(
  payload: NativeSharePayload,
  navigatorAdapter: ShareNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): Promise<NativeShareResult> {
  if (!navigatorAdapter) {
    return { status: "unavailable", method: "none" };
  }

  const shareData: ShareData = {
    ...(payload.title == null ? {} : { title: payload.title }),
    ...(payload.text == null ? {} : { text: payload.text }),
    ...(payload.url == null ? {} : { url: payload.url }),
    ...(payload.files == null ? {} : { files: payload.files }),
  };
  const includesFiles = (payload.files?.length ?? 0) > 0;
  const canUseNativeShare =
    typeof navigatorAdapter.share === "function" &&
    (!includesFiles || navigatorAdapter.canShare?.(shareData) === true);

  if (canUseNativeShare) {
    try {
      await navigatorAdapter.share?.(shareData);
      return { status: "shared", method: "native" };
    } catch (error) {
      if (isAbortError(error)) {
        return { status: "cancelled", method: "native" };
      }
    }
  }

  const fallbackText = buildFallbackText(payload);
  if (fallbackText.length > 0 && typeof navigatorAdapter.clipboard?.writeText === "function") {
    try {
      await navigatorAdapter.clipboard.writeText(fallbackText);
      return { status: "copied", method: "clipboard" };
    } catch {
      // Clipboard permission can be denied. The caller receives unavailable
      // and can show local error feedback without throwing.
    }
  }

  return { status: "unavailable", method: "none" };
}
