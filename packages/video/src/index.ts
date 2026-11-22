// Browser-safe entry: composition + config. For server-side MP4 export use "@unfold/video/render".
export { UnfoldComposition, type UnfoldCompositionProps } from "./UnfoldComposition";
export { getCompositionConfig, resolveSrc } from "./util";
export { FONTS, ensureFonts } from "./fonts";
export { COMPOSITION_ID } from "./ids";
export { CAPTION_DESIGNS, resolveCaptionDesign, hookRepeatsOpening } from "./captionDesign";
