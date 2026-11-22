import type { Metadata } from "next";
import "@/components/marketing/marketing.css";
import { Features } from "@/components/marketing/Features";
import { Hero, Nav } from "@/components/marketing/Hero";
import { LandingHandoff } from "@/components/marketing/LandingHandoff";
import { RawToEdit } from "@/components/marketing/RawToEdit";
import { Faq, FinalCta, Footer } from "@/components/marketing/Sections";
import { Ways } from "@/components/marketing/Ways";
import { Speed } from "@/components/marketing/Speed";

const title = "Unfold · Raw footage in. Your story, edited.";
const description =
  "Turn raw footage into one edit shaped around your clip and brief. Refine the pacing, captions and sound in chat, then export an MP4.";
const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://unfold.maazx.dev");
const shareImage = {
  url: new URL("/brand/unfold-og-dark.png", siteUrl).href,
  width: 1200,
  height: 630,
  alt: "Unfold. You shoot it. Unfold edits it.",
};

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Unfold",
    url: siteUrl,
    title,
    description,
    images: [{ ...shareImage, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [shareImage],
  },
};

export default function Home() {
  return (
    <LandingHandoff>
      <Nav />
      <main>
        <Hero />
        <RawToEdit />
        <Features />
        <Ways />
        <Speed />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </LandingHandoff>
  );
}
