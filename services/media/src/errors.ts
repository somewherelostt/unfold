/** Safe messages may be returned to creators; subprocess diagnostics stay on the server. */
export class MediaError extends Error {
  constructor(public readonly code: "INVALID_MEDIA" | "DURATION_LIMIT" | "SPEECH_MODEL_MISSING" | "SPEECH_FAILED" | "ANALYSIS_FAILED" | "CANCELLED" | "TIMEOUT" | "REFERENCE_URL", message: string) {
    super(message);
    this.name = "MediaError";
  }
}
