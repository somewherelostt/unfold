import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary, type EditPlan } from "@unfold/core";
import { UnfoldComposition, type UnfoldCompositionProps } from "./UnfoldComposition";
import { COMPOSITION_ID } from "./ids";
import { getCompositionConfig } from "./util";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const samples: EditPlan[] = sampleAgentPlans.map((p, i) =>
  compileEditPlan(p, sampleAnalysis, sampleLibrary, { id: `sample-${i}-${slug(p.title)}` }),
);

// Studio-only: exercises the transitions the samples don't use.
const fxTest: EditPlan = {
  ...samples[0],
  id: "dev-fx-test",
  title: "FX test",
  transitions: [
    { at: samples[0].clips[0].end, type: "glitch", durationSec: 0.25 },
    { at: samples[0].clips[1].end, type: "slide", durationSec: 0.3 },
    { at: samples[0].clips[2].end, type: "shake", durationSec: 0.3 },
  ],
  captions: { ...samples[0].captions, preset: "karaoke", position: "lower", highlightColor: "#FFE14D" },
  overlays: [{ start: 8, end: 9.5, text: "bro what" }],
};

const calculateMetadata: CalculateMetadataFunction<UnfoldCompositionProps> = ({ props }) => getCompositionConfig(props.plan);

export const Root: React.FC = () => (
  <>
    {/* Generic composition used by renderPlan(); the plan arrives via inputProps. */}
    <Composition
      id={COMPOSITION_ID}
      component={UnfoldComposition}
      defaultProps={{ plan: samples[0] } as UnfoldCompositionProps}
      calculateMetadata={calculateMetadata}
      {...getCompositionConfig(samples[0])}
    />
    {[...samples, fxTest].map((plan) => (
      <Composition
        key={plan.id}
        id={plan.id}
        component={UnfoldComposition}
        defaultProps={{ plan } as UnfoldCompositionProps}
        calculateMetadata={calculateMetadata}
        {...getCompositionConfig(plan)}
      />
    ))}
  </>
);
