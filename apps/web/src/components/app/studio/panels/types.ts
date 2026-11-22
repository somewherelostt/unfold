import type { EditPlan, Library } from "@unfold/core";
import type { RefObject } from "react";
import type { Overrides } from "@/lib/client/types";
import type { PlayerRef } from "../../preview/PlanPlayer";

/** Props every side panel receives. `plan` = with manual edits applied; `base` = the agent's plan. */
export type PanelProps = {
  id: string;
  plan: EditPlan;
  base: EditPlan;
  overrides: Overrides;
  library: Library;
  frames: { t: number; url: string }[];
  playerRef: RefObject<PlayerRef | null>;
  set: (o: Overrides) => void;
  seek: (t: number) => void;
  now: () => number;
  onAlternates: () => void;
};
