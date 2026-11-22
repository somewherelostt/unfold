import { ID, isPlatform, PublishingError, type CompletedExport, type DestinationInput } from "./types.ts";
export type ValidationIssue = { field: string; message: string; severity: "error" | "notice" };
export const characters = (text: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;
export function parseDestinations(value: unknown): DestinationInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new PublishingError("INVALID_DESTINATIONS", "Choose one to three destinations.");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !["accountId", "platform", "text", "instagram", "pinterest", "bluesky"].includes(key))) throw new PublishingError("INVALID_DESTINATIONS", "Invalid destination settings.");
    const d = item as DestinationInput;
    if (!isPlatform(d.platform) || typeof d.accountId !== "string" || !ID.test(d.accountId) || typeof d.text !== "string" || d.text.length > 20_000 || ids.has(d.accountId)) throw new PublishingError("INVALID_DESTINATIONS", "Choose distinct connected accounts and valid text.");
    ids.add(d.accountId);
    for (const platform of ["instagram", "pinterest", "bluesky"] as const) if (platform !== d.platform && d[platform] !== undefined) throw new PublishingError("INVALID_DESTINATIONS", "Use settings for the selected platform.");
    const fields = d[d.platform];
    const allowed = d.platform === "instagram" ? ["shareToFeed", "thumbnailMs"] : d.platform === "pinterest" ? ["boardId", "title", "altText", "link", "coverFrameMs"] : ["altText", "languages"];
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).some((key) => !allowed.includes(key))) throw new PublishingError("INVALID_FIELDS", "Complete this platform’s post settings.");
    if (d.platform === "instagram" && (typeof d.instagram!.shareToFeed !== "boolean" || !Number.isSafeInteger(d.instagram!.thumbnailMs) || d.instagram!.thumbnailMs < 0)) throw new PublishingError("INVALID_FIELDS", "Choose valid Reel settings.");
    if (d.platform === "pinterest" && (typeof d.pinterest!.boardId !== "string" || !/^\d{1,40}$/.test(d.pinterest!.boardId) || typeof d.pinterest!.title !== "string" || typeof d.pinterest!.altText !== "string" || (d.pinterest!.link !== undefined && typeof d.pinterest!.link !== "string") || !Number.isSafeInteger(d.pinterest!.coverFrameMs) || d.pinterest!.coverFrameMs < 0)) throw new PublishingError("INVALID_FIELDS", "Choose a Pinterest board and valid Pin settings.");
    if (d.platform === "bluesky" && (typeof d.bluesky!.altText !== "string" || !Array.isArray(d.bluesky!.languages) || d.bluesky!.languages.length > 3 || d.bluesky!.languages.some((lang) => typeof lang !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang)))) throw new PublishingError("INVALID_FIELDS", "Choose valid video description and languages.");
    return structuredClone(d);
  });
}
/** Limits are pinned to the verified implementation route; account/API checks still run at dispatch. */
export function validateDestination(d: DestinationInput, media: CompletedExport): ValidationIssue[] {
  const issues: ValidationIssue[] = [], m = media.properties;
  const error = (field: string, message: string) => issues.push({ field, message, severity: "error" });
  const notice = (field: string, message: string) => issues.push({ field, message, severity: "notice" });
  if (m.mime !== "video/mp4" || m.videoCodec !== "h264" || (m.audioCodec && m.audioCodec !== "aac")) error("video", "Export an MP4 with H.264 video and AAC audio.");
  if (![m.bytes, m.duration, m.width, m.height, m.fps].every((n) => Number.isFinite(n) && n > 0)) error("video", "Inspect this export again before publishing.");
  if (d.platform === "instagram") {
    if ([...d.text].length > 2200) error("text", "Instagram captions allow up to 2,200 characters.");
    if (m.duration < 3 || m.duration > 900) error("video", "Instagram Reels require a video between 3 seconds and 15 minutes.");
    if (m.bytes > 300_000_000) error("video", "This Reel exceeds the 300 MB upload limit.");
    if ((d.text.match(/(?:^|\s)#[^\s#]+/gu) ?? []).length > 30) error("text", "Use no more than 30 hashtags in an Instagram caption.");
    if ((d.text.match(/(?:^|\s)@[A-Za-z0-9_.]+/g) ?? []).length > 20) error("text", "Use no more than 20 mentions in an Instagram caption.");
    if (m.fps < 23 || m.fps > 60 || m.width > 1920) error("video", "Use 23–60 fps and a width of 1,920 pixels or less for this Reel.");
    if (m.width / m.height < 0.01 || m.width / m.height > 10) error("video", "This video’s aspect ratio is outside Instagram’s supported range.");
    if (d.instagram && d.instagram.thumbnailMs >= m.duration * 1000) error("thumbnailMs", "Choose a thumbnail within the video.");
    if (Math.abs(m.width / m.height - 9 / 16) > 0.03) notice("video", "A 9:16 video fills the Reel screen; other ratios may be cropped.");
    notice("account", "Requires an Instagram Business or Creator account with publishing permission. Personal accounts are unsupported.");
  } else if (d.platform === "pinterest") {
    if ([...d.text].length > 800) error("text", "Pin descriptions allow up to 800 characters.");
    if (d.pinterest && [...d.pinterest.title].length > 100) error("title", "Pin titles allow up to 100 characters.");
    if (d.pinterest && [...d.pinterest.altText].length > 500) error("altText", "Pin descriptions for accessibility allow up to 500 characters.");
    if (m.duration < 4 || m.duration > 300) error("video", "Video Pins require a video between 4 seconds and 5 minutes.");
    if (m.bytes > 300_000_000) error("video", "This publishing flow supports video Pins up to 300 MB.");
    if (d.pinterest && d.pinterest.coverFrameMs >= m.duration * 1000) error("coverFrameMs", "Choose a cover frame within the video.");
    if (d.pinterest && d.pinterest.coverFrameMs % 1000 !== 0) error("coverFrameMs", "Choose a Pinterest cover frame in whole seconds.");
    if (d.pinterest?.link) { try { const u = new URL(d.pinterest.link); if (u.protocol !== "https:" || u.username || u.password || d.pinterest.link.length > 2048) throw Error(); } catch { error("link", "Use a complete HTTPS destination link of up to 2,048 characters."); } }
    notice("account", "Pinterest production posting requires Standard API access. A Trial connection cannot create production Pins.");
  } else {
    if (characters(d.text) > 300 || new TextEncoder().encode(d.text).length > 3000) error("text", "Bluesky posts allow up to 300 characters and 3,000 UTF-8 bytes.");
    if (m.duration > 600 || m.bytes > 300_000_000) error("video", "This route supports a single video up to 10 minutes and 300 MB; account upload limits also apply.");
    if (d.bluesky && [...d.bluesky.altText].length > 2000) error("altText", "Use a video description of up to 2,000 characters.");
    notice("account", "Video publishing is unavailable until a supported connection and upload route are verified.");
  }
  notice("video", media.settings ? media.settings.burnCaptions ? "This export includes burned-in captions." : "This export has no burned-in captions. Separate subtitle uploads are not supported here." : "Inspect this completed export for captions. Separate subtitle uploads are not supported here.");
  return issues;
}
