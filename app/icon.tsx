import { ImageResponse } from "next/og";

// This file makes Next generate the site's browser-tab icon (favicon) at build
// time — a red rounded square with a "W" for Ward.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#e23742",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
          borderRadius: 7,
        }}
      >
        W
      </div>
    ),
    { ...size }
  );
}
