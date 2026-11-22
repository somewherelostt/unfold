import Image from "next/image";
import type { Platform } from "../../../../../services/publishing/src/types";
import instagram from "./assets/instagram.png";
import pinterest from "./assets/pinterest.svg";
import bluesky from "./assets/bluesky.svg";

const marks = { instagram, pinterest, bluesky };

/** Official platform artwork; adjacent platform names provide the accessible label. */
export function PlatformMark({ platform, large = false }: { platform: Platform; large?: boolean }) {
  const size = large ? 48 : 28;
  return <span className={`uf-publish-mark uf-publish-mark-${platform}${large ? " is-large" : ""}`} aria-hidden="true"><Image src={marks[platform]} alt="" width={size} height={size} sizes={`${size}px`} draggable={false} /></span>;
}
