export type PreviewReadiness = "loading" | "ready" | "error";
type MediaState = { readyState: number; seeking: boolean; error: unknown };

/** Metadata and a requested seek position do not establish that a picture has decoded. */
export function previewReadiness(media: readonly MediaState[]): PreviewReadiness {
  if (media.some((item) => item.error)) return "error";
  if (!media.length || media.some((item) => item.readyState < 2 || item.seeking)) return "loading";
  return "ready";
}
