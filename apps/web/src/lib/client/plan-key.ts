import type { EditPlan } from "@unfold/core";

/** Compare edit content independently of object key order or derived quality feedback. */
export function planKey(plan: EditPlan): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  const { quality: _quality, ...content } = plan;
  void _quality;
  return JSON.stringify(canonical(content));
}
