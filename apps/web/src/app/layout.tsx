import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const uiFont = Geist({ variable: "--font-ui", subsets: ["latin"] });
const monoFont = Geist_Mono({ variable: "--font-ui-mono", subsets: ["latin"] });
const displayFont = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"], weight: ["700", "800"] });

export const metadata: Metadata = {
  title: "Unfold",
  description: "Turn one clip into every version that could go viral.",
  icons: { icon: "/logo-mark.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${uiFont.variable} ${monoFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
