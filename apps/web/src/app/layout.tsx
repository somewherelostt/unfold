import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque, Instrument_Serif } from "next/font/google";
import "./globals.css";

const uiFont = Geist({ variable: "--font-ui", subsets: ["latin"] });
const monoFont = Geist_Mono({ variable: "--font-ui-mono", subsets: ["latin"] });
const displayFont = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"], weight: ["700", "800"] });
const serifFont = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Unfold",
  description: "Turn raw footage into one edit shaped around your clip and brief. Refine it in chat and export an MP4.",
  icons: { icon: "/logo-mark.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={`${uiFont.variable} ${monoFont.variable} ${displayFont.variable} ${serifFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
