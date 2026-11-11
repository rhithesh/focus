import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The 1200×630 share card used for Open Graph and X/Twitter. Rendered once at build time.
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "Focus: your feeds, minus the noise. A free Chrome extension for YouTube, X and LinkedIn.";

const PAPER = "#f3f0e8";
const INK = "#16150f";
const MUTED = "#6b665b";
const LIME = "#c9f25d";

const font = (file: string) => readFile(join(process.cwd(), "assets", file));

function Mark({ size }: { size: number }) {
  const u = size / 24;
  const s = "2px solid #fff";
  const inset = 5 * u;
  const arm = 4.5 * u;
  const bracket = {
    position: "absolute" as const, width: arm, height: arm, boxSizing: "border-box" as const,
    borderStyle: "solid" as const, borderColor: "#fff", borderWidth: 0,
  };
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: 7 * u, background: INK, display: "flex" }}>
      <div style={{ ...bracket, left: inset, top: inset, borderTop: s, borderLeft: s, borderTopLeftRadius: 6 * u }} />
      <div style={{ ...bracket, right: inset, top: inset, borderTop: s, borderRight: s, borderTopRightRadius: 6 * u }} />
      <div style={{ ...bracket, left: inset, bottom: inset, borderBottom: s, borderLeft: s, borderBottomLeftRadius: 6 * u }} />
      <div style={{ ...bracket, right: inset, bottom: inset, borderBottom: s, borderRight: s, borderBottomRightRadius: 6 * u }} />
      <div style={{ position: "absolute", left: 6.5 * u, top: 6.5 * u, width: 11 * u, height: 11 * u, borderRadius: "50%", background: "#fff", opacity: 0.16 }} />
      <div style={{ position: "absolute", left: 9 * u, top: 9 * u, width: 6 * u, height: 6 * u, borderRadius: "50%", background: "#fff" }} />
    </div>
  );
}

// A feed card: sharp ones get real-looking lines, "blurred" ones are washed out.
function Card({ blurred, lines, thumb }: { blurred?: boolean; lines: number[]; thumb?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 330,
        padding: 16,
        borderRadius: 22,
        background: "#fff",
        border: "1px solid #e1dbcd",
        boxShadow: "0 18px 40px -22px rgba(22,21,15,0.35)",
        opacity: blurred ? 0.55 : 1,
      }}
    >
      {thumb && <div style={{ height: 120, borderRadius: 14, background: blurred ? "#e8c9c2" : thumb }} />}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 30, height: 30, borderRadius: 15, background: blurred ? "#ece7dc" : "#cfe6d6" }} />
        <div style={{ height: 10, width: 120, borderRadius: 5, background: blurred ? "#ece7dc" : "#d9d3c6" }} />
      </div>
      {lines.map((w, i) => (
        <div key={i} style={{ height: 11, width: w, borderRadius: 6, background: blurred ? "#efebe2" : "#c9c3b5" }} />
      ))}
    </div>
  );
}

export async function renderOgImage() {
  const [serif, serifItalic, sans] = await Promise.all([
    font("InstrumentSerif-Regular.ttf"),
    font("InstrumentSerif-Italic.ttf"),
    font("Geist-Medium.ttf"),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, padding: "64px 0 64px 72px", fontFamily: "Geist", color: INK }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 690 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30 }}>
            <Mark size={46} />
            Focus
          </div>

          <div style={{ display: "flex", flexDirection: "column", fontFamily: "Instrument Serif", fontSize: 118, lineHeight: 0.92, letterSpacing: -3 }}>
            <div style={{ display: "flex" }}>Your feeds,</div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              minus the&nbsp;
              <div style={{ display: "flex", position: "relative", fontStyle: "italic" }}>
                <div style={{ position: "absolute", left: -6, right: -6, top: 46, bottom: 8, background: LIME, borderRadius: 12 }} />
                <div style={{ display: "flex", position: "relative" }}>noise.</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 27, color: MUTED, lineHeight: 1.35 }}>Free Chrome extension. Blurs clickbait and spam.</div>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { label: "YouTube", dot: "#FF0033" },
                { label: "X", dot: "#0f0f0f" },
                { label: "LinkedIn", dot: "#0A66C2" },
              ].map((p) => (
                <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 18px", borderRadius: 999, background: "#fff", border: "1px solid #e1dbcd", fontSize: 24 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 7, background: p.dot }} />
                  {p.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginLeft: 44, marginTop: -30 }}>
          <Card thumb="#1d2a4a" lines={[280, 190]} />
          <Card blurred lines={[290, 250, 150]} />
          <Card lines={[270, 230, 120]} />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Instrument Serif", data: serif, style: "normal", weight: 400 },
        { name: "Instrument Serif", data: serifItalic, style: "italic", weight: 400 },
        { name: "Geist", data: sans, style: "normal", weight: 500 },
      ],
    }
  );
}
