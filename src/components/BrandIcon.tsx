const BARS = [0.22, 0.5, 0.82, 0.6, 0.36, 0.18];

/** The app icon: a whisper as sound waves, drawn with plain divs so `next/og` can render it. */
export function BrandIcon({ size, ring }: { size: number; ring: boolean }) {
  const barWidth = size * 0.055;
  const gap = size * 0.04;
  const maxHeight = size * 0.42;
  const bars = (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      {BARS.map((h, i) => (
        <div
          key={i}
          style={{
            width: barWidth,
            height: maxHeight * h,
            borderRadius: barWidth,
            background: i % 2 ? "#c4b5fd" : "#ffffff",
          }}
        />
      ))}
    </div>
  );
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 35%, #2a2140 0%, #07070a 70%)",
      }}
    >
      {ring ? (
        <div
          style={{
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: 9999,
            border: `${Math.round(size * 0.02)}px solid rgba(167,139,250,0.75)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {bars}
        </div>
      ) : (
        bars
      )}
    </div>
  );
}
