// Copied from vidzart-app/src/lib/recording/mimeType.ts (keep in sync).

// Choosing a container/codec for MediaRecorder.
//
// Browsers support different formats, and MediaRecorder throws if you ask for
// one it can't produce, so we probe with `isTypeSupported` in order of
// preference.
//
// Why WebM/VP9 first: it's what Chrome records best (hardware-friendly, good
// quality per bit) and our editor decodes it with WebCodecs anyway. The final
// MP4 is produced at export time, so the recording format only has to be good
// raw material, not a deliverable.

const CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
] as const;

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** File extension matching a recorder MIME type ("webm" or "mp4"). */
export function extensionForMimeType(mimeType: string): "webm" | "mp4" {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}
