/* eslint-disable @next/next/no-img-element */
import type { DemoVariant } from "./variants";

/** One 9:16 variant: graded frame, viral caption, label. Purely visual. */
export function PhoneTile({ v, size = "sm" }: { v: DemoVariant; size?: "sm" | "md" }) {
  const cap = size === "md" ? "text-[15px] sm:text-[24px] lg:text-[26px]" : "text-[clamp(11px,2.4vw,19px)]";
  return (
    <div className="absolute inset-0 bg-[#0b0b0c]">
      <img src={v.frame} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0 opacity-50 mix-blend-multiply" style={{ backgroundImage: v.tint }} />
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_45%,transparent,rgb(0_0_0/.45))]" />
      <div className={`mk-caption absolute inset-x-2 top-[54%] text-center ${cap}`}>
        {v.hook[0]}{" "}
        <span style={{ color: v.emphasis === "yellow" ? "#FFE14D" : "#FF5A1F" }}>{v.hook[1]}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
        <span className="truncate text-[9px] font-medium text-white/90 sm:text-[10px]">{v.name}</span>
        <span className="hidden shrink-0 font-mono text-[9px] text-white/60 sm:inline">{v.meta}</span>
      </div>
    </div>
  );
}
