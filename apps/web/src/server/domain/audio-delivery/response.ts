import {
  AudioRangeNotSatisfiableError,
  parseSingleByteRange,
  privateAudioRangeNotSatisfiableHeaders,
  privateAudioResponseHeaders,
} from "./http";
import { readExactAudioObject } from "./storage";
import type { AudioObjectRequest } from "./service";

function extensionForContentType(contentType: string | undefined): string {
  switch (contentType?.toLowerCase()) {
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aiff":
    case "audio/x-aiff":
      return "aiff";
    default:
      return "audio";
  }
}

export async function authorizedAudioResponse(
  request: Request,
  audio: AudioObjectRequest,
  disposition: "attachment" | "inline",
): Promise<Response> {
  let range;
  try {
    range = parseSingleByteRange(request.headers.get("range"), audio.sizeBytes);
  } catch (error) {
    if (error instanceof AudioRangeNotSatisfiableError) {
      return new Response(null, {
        status: 416,
        headers: privateAudioRangeNotSatisfiableHeaders(audio.sizeBytes),
      });
    }
    throw error;
  }

  const object = await readExactAudioObject({
    storageKey: audio.key,
    objectEtag: audio.objectEtag,
    sizeBytes: audio.sizeBytes,
    range,
  });
  const headers = privateAudioResponseHeaders({
    contentType: object.contentType,
    sizeBytes: audio.sizeBytes,
    range,
    ...(disposition === "attachment"
      ? {
          downloadFileName: `${audio.title} - ${audio.versionLabel}.${extensionForContentType(object.contentType)}`,
        }
      : {}),
  });
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers,
  });
}
