import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Buttons. One white primary per view; secondary on surface-2 with a hairline; ghost is text only.
 * `buttonClasses()` lets other elements (links, labels) share the look.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const BASE =
  "ui-button inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[13px] font-medium leading-none transition-[background-color,color,box-shadow,opacity] duration-150 ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0 cursor-pointer";
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3",
  md: "h-9 px-3.5",
  lg: "h-11 px-5 text-[14px]",
  icon: "size-8 rounded-full",
  "icon-sm": "size-7 rounded-full",
};
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary-btn text-primary-btn-ink hover:opacity-90",
  secondary: "bg-surface-2 text-text-1 shadow-[inset_0_0_0_1px_var(--hairline)] hover:bg-surface-3 hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)]",
  ghost: "text-text-2 hover:text-text-1",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className = "") {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`;
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children?: ReactNode };

export function Button({ variant, size, className, type = "button", ...p }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} {...p} className={buttonClasses(variant, size, className)} />;
}

export function ButtonLink({ variant, size, className, href, ...p }: Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <Link href={href} {...p} className={buttonClasses(variant, size, className)} />;
}
