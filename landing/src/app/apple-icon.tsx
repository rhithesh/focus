import { ImageResponse } from "next/og";

// Home-screen icon: the Focus viewfinder mark, full-bleed (iOS rounds the corners itself).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const s = "11px solid #fff";
  const inset = 36;
  const arm = 34;
  const bracket = { position: "absolute" as const, width: arm, height: arm, borderStyle: "solid" as const, borderColor: "#fff", borderWidth: 0 };
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#16150f" }}>
        <div style={{ ...bracket, left: inset, top: inset, borderTop: s, borderLeft: s, borderTopLeftRadius: 40 }} />
        <div style={{ ...bracket, right: inset, top: inset, borderTop: s, borderRight: s, borderTopRightRadius: 40 }} />
        <div style={{ ...bracket, left: inset, bottom: inset, borderBottom: s, borderLeft: s, borderBottomLeftRadius: 40 }} />
        <div style={{ ...bracket, right: inset, bottom: inset, borderBottom: s, borderRight: s, borderBottomRightRadius: 40 }} />
        <div style={{ position: "absolute", left: 48, top: 48, width: 84, height: 84, borderRadius: "50%", background: "#fff", opacity: 0.16 }} />
        <div style={{ position: "absolute", left: 67, top: 67, width: 46, height: 46, borderRadius: "50%", background: "#fff" }} />
      </div>
    ),
    size
  );
}
