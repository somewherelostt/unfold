import { ASPECT_SIZE, type EditPlan } from "@unfold/core";
import type { ExportReview } from "./types";

/** Match the server's visible export options before comparing a rendered quality report. */
export function exportPreview(plan: EditPlan, resolution: "720p" | "1080p", burnCaptions: boolean): EditPlan {
  const scale = resolution === "720p" ? 2 / 3 : 1;
  return { ...plan, width: Math.round(ASPECT_SIZE[plan.aspect].width * scale), height: Math.round(ASPECT_SIZE[plan.aspect].height * scale), captions: { ...plan.captions, enabled: burnCaptions && plan.captions.enabled } };
}

export function reviewMatches(record: ExportReview | undefined, currentFingerprint: string, unsaved: boolean, conflict: boolean): boolean {
  return !!record?.review && !unsaved && !conflict && !!currentFingerprint
    && record.submittedFingerprint === currentFingerprint && record.submittedInputFingerprint === record.submittedFingerprint
    && record.review.planFingerprint === record.renderedPlanFingerprint
    && !!record.requestedSettings && record.settings?.resolution === record.requestedSettings.resolution && record.settings?.burnCaptions === record.requestedSettings.burnCaptions;
}
