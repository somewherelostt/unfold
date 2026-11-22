import type { EditPlan } from "@unfold/core";

type CaptionChunk = EditPlan["captions"]["chunks"][number];

/** Also handles stored plans compiled before caption output ordering was enforced. */
export function orderCaptionChunks(chunks: CaptionChunk[]): CaptionChunk[] {
  return [...chunks].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function captionChunkIndexAt(chunks: CaptionChunk[], t: number): number {
  return chunks.findIndex((chunk, i) => {
    const next = chunks[i + 1];
    const until = Math.min(next ? next.start : Infinity, chunk.end + (next ? 0.6 : 0.9));
    return t >= chunk.start - 0.03 && t < until;
  });
}
