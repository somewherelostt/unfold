import type { Metadata } from "next";
import "@/components/marketing/marketing.css";
import { Features } from "@/components/marketing/Features";
import { Hero, Nav } from "@/components/marketing/Hero";
import { LandingHandoff } from "@/components/marketing/LandingHandoff";
import { RawToEdit } from "@/components/marketing/RawToEdit";
import { Faq, FinalCta, Footer } from "@/components/marketing/Sections";
import { Ways } from "@/components/marketing/Ways";
import { Speed } from "@/components/marketing/Speed";

export const metadata: Metadata = {
  title: "Unfold · Raw footage in. Your story, edited.",
  description:
    "Turn raw footage into one edit shaped around your clip and brief. Refine the pacing, captions and sound in chat, then export an MP4.",
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
