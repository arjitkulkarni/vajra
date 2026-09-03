import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist_Mono, Instrument_Sans, Noto_Sans_Devanagari, Noto_Sans_Kannada } from "next/font/google";
import "./globals.css";

// Daylight: two grotesks with a clear division of labour, plus a mono.
//
// Bricolage Grotesque is the DISPLAY voice and only appears at 40px and up. It carries an optical
// size axis, so the same file that looks eccentric at 16px resolves into a confident editorial
// face at 96px — which is exactly the register the hero and the section heads are set in. Two
// weights only; a display face with five cuts is a font family, not a voice.
//
// Instrument Sans carries everything a person operates: nav, labels, body, tables, forms. It is a
// true neo-grotesk with a tall x-height and closed apertures, and it is deliberately quiet — the
// counterweight to the display face rather than a second personality.
//
// Geist Mono carries anything a machine produced: hashes, DIDs, timestamps, payloads.
//
// Both Noto faces stay: they are the Devanagari and Kannada coverage that the :lang(hi)/:lang(kn)
// heading rules in globals.css fall back to BY NAME, because neither grotesk has that coverage and
// falling through to --font-sans would put Latin metrics on Indic text.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-bricolage", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "500", "600"], variable: "--font-devanagari", display: "swap" });
const kannada = Noto_Sans_Kannada({ subsets: ["kannada"], weight: ["400", "500", "600"], variable: "--font-kannada", display: "swap" });

export const metadata: Metadata = {
  title: "VAJRA — A Cryptographic Trust Layer for Digital Assets",
  description:
    "VAJRA doesn't just control who can access an asset — it proves who accessed it, why they were allowed, what they did, and whether the asset can still be trusted.",
  applicationName: "VAJRA",
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${geistMono.variable} ${devanagari.variable} ${kannada.variable}`}>
      <body>{children}</body>
    </html>
  );
}
