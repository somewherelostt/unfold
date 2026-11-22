import type { SVGProps } from "react";

/** Shared 1.5px-stroke icon set (16px default). */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export const IconPlus = (p: IconProps) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconArrowUp = (p: IconProps) => <svg {...base(p)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
export const IconArrowRight = (p: IconProps) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const IconChevronDown = (p: IconProps) => <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>;
export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>
);
export const IconBolt = (p: IconProps) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>;
export const IconLink = (p: IconProps) => (
  <svg {...base(p)}><path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" /><path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" /></svg>
);
export const IconX = (p: IconProps) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IconCheck = (p: IconProps) => <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const IconPlay = (p: IconProps) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>;
export const IconDownload = (p: IconProps) => <svg {...base(p)}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
export const IconCaptions = (p: IconProps) => <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 15h4M13 15h4M7 11h10" /></svg>;
export const IconMusic = (p: IconProps) => <svg {...base(p)}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;
export const IconCut = (p: IconProps) => (
  <svg {...base(p)}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></svg>
);
export const IconSpeaker = (p: IconProps) => <svg {...base(p)}><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
export const IconChat = (p: IconProps) => <svg {...base(p)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" /></svg>;
export const IconMenu = (p: IconProps) => <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
/* Editor set (product UI) */
export const IconUndo = (p: IconProps) => <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;
export const IconRedo = (p: IconProps) => <svg {...base(p)}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>;
export const IconBack = (p: IconProps) => <svg {...base(p)}><path d="M15 18l-6-6 6-6" /></svg>;
export const IconPause = (p: IconProps) => <svg {...base(p)} fill="currentColor" stroke="none"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>;
export const IconExpand = (p: IconProps) => <svg {...base(p)}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
export const IconTransition = (p: IconProps) => <svg {...base(p)}><rect x="3" y="6" width="8" height="12" rx="2" /><rect x="13" y="6" width="8" height="12" rx="2" /><path d="M11 12h2" /></svg>;
export const IconStyle = (p: IconProps) => <svg {...base(p)}><path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z" /><circle cx="7.5" cy="11.5" r="1" /><circle cx="10.5" cy="7.5" r="1" /><circle cx="15" cy="7.5" r="1" /></svg>;
export const IconMedia = (p: IconProps) => <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m3 15 5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="8.5" r="1.5" /></svg>;
export const IconExport = (p: IconProps) => <svg {...base(p)}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>;
export const IconLayers = (p: IconProps) => <svg {...base(p)}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
export const IconSettings = (p: IconProps) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>;
export const IconChevronRight = (p: IconProps) => <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>;
export const IconUpload = (p: IconProps) => <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>;
export const IconVolume = (p: IconProps) => <svg {...base(p)}><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>;
export const IconGrid = (p: IconProps) => <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
