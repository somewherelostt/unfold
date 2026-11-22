/** Burned-in caption looks for the example clips. Fixed colours: they always sit on footage. */
export type CaptionStyle = "pop" | "box" | "clean" | "chaos" | "focus";

export function Caption({
  words,
  hot = [],
  lit,
  style = "pop",
  size = 22,
  className = "",
}: {
  words: string[];
  /** indexes always highlighted (caption yellow) */
  hot?: number[];
  /** karaoke: index of the word being spoken (lit), words after it dimmed */
  lit?: number;
  style?: CaptionStyle;
  size?: number;
  className?: string;
}) {
  const shade = (i: number) => {
    if (lit !== undefined) return i === lit ? "#FFE14D" : i < lit ? "#fff" : "rgb(255 255 255 / .55)";
    return hot.includes(i) ? "#FFE14D" : "#fff";
  };

  if (style === "focus") {
    return (
      <div className={`mk-cap-focus ${className}`} style={{ fontSize: size * 0.9 }}>
        {words.map((w, i) => (
          <span key={i} className={hot.includes(i) || i === lit ? "is-emphasized" : ""}>{w}</span>
        ))}
      </div>
    );
  }

  if (style === "box") {
    return (
      <div className={`mk-cap-box flex flex-wrap justify-center gap-1 ${className}`} style={{ fontSize: size * 0.82 }}>
        {words.map((w, i) => (
          <span key={i} className="rounded-[5px] px-1.5 py-1" style={{ background: hot.includes(i) || i === lit ? "#FF5A1F" : "#000", color: "#fff" }}>
            {w}
          </span>
        ))}
      </div>
    );
  }
  if (style === "clean") {
    return (
      <div className={`mk-cap-clean text-center ${className}`} style={{ fontSize: size * 0.78, lineHeight: 1.15 }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: shade(i) }}>
            {w}{" "}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div
      className={`mk-cap text-center ${style === "chaos" ? "-rotate-6" : ""} ${className}`}
      style={{ fontSize: style === "chaos" ? size * 1.15 : size }}
    >
      {words.map((w, i) => (
        <span key={i} style={{ color: style === "chaos" && !hot.includes(i) && lit === undefined ? "#FF7AC0" : shade(i) }}>
          {w}{" "}
        </span>
      ))}
    </div>
  );
}
