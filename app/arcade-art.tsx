import type { ArcadeKind } from "./arcade-engine";
import { TapIcon } from "./tap-icon";

/** Original game-cover illustrations, made from filled SVG shapes. */
export function ArcadeArt({ kind }: { kind: ArcadeKind }) {
  return (
    <svg
      viewBox="0 0 180 136"
      fill="none"
      aria-hidden="true"
      className={`arcade-art art-${kind}`}
    >
      <ellipse
        cx="90"
        cy="119"
        rx="55"
        ry="7"
        fill="currentColor"
        opacity=".1"
      />
      {kind === "timing" && (
        <>
          <rect x="20" y="51" width="140" height="46" rx="21" fill="#419e16" />
          <rect x="20" y="44" width="140" height="46" rx="21" fill="#84dc3e" />
          <rect x="28" y="51" width="124" height="30" rx="15" fill="#e9f9d6" />
          <rect x="69" y="51" width="42" height="30" rx="12" fill="#58bd1a" />
          <path d="m82 22 8 15 8-15Z" fill="#ffd35a" />
          <rect x="85" y="40" width="10" height="57" rx="5" fill="#2c7135" />
          <rect x="87" y="42" width="4" height="44" rx="2" fill="#fff" />
        </>
      )}
      {kind === "memory" && (
        <>
          {[0, 1, 2, 3].map((n) => (
            <g key={n}>
              <rect
                x={(n % 2) * 52 + 40}
                y={Math.floor(n / 2) * 48 + 20}
                width="45"
                height="41"
                rx="12"
                fill={["#ae88db", "#3f9fc9", "#d7a83c", "#71a84c"][n]}
              />
              <rect
                x={(n % 2) * 52 + 40}
                y={Math.floor(n / 2) * 48 + 14}
                width="45"
                height="41"
                rx="12"
                fill={["#c7a2f4", "#7dd7fa", "#ffe17b", "#a4e276"][n]}
              />
            </g>
          ))}
          <path d="m114 23 4 7 8 1-6 6 1 8-7-4-7 4 1-8-6-6 8-1Z" fill="#fff" />
        </>
      )}
      {kind === "coin" && (
        <svg x="43" y="12" width="100" height="110" viewBox="0 0 64 64">
          <TapIcon kind="coin" />
        </svg>
      )}
      {kind === "dice" && (
        <g transform="rotate(-12 90 68)">
          <rect x="43" y="24" width="90" height="94" rx="23" fill="#3da6d2" />
          <rect x="40" y="16" width="90" height="94" rx="23" fill="#fff" />
          <path
            d="M61 20h42"
            stroke="#e5f6fc"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {[
            [61, 38],
            [109, 38],
            [85, 62],
            [61, 86],
            [109, 86],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="7" fill="#5bbde4" />
          ))}
        </g>
      )}
      {kind === "tower" && (
        <>
          {[0, 1, 2].map((n) => (
            <g key={n}>
              <rect
                x={32 + n * 16}
                y={88 - n * 28}
                width={116 - n * 32}
                height="28"
                rx="8"
                fill={["#8760bf", "#9b74cf", "#ad87dd"][n]}
              />
              <rect
                x={32 + n * 16}
                y={81 - n * 28}
                width={116 - n * 32}
                height="26"
                rx="8"
                fill={["#b18be5", "#c9a7f5", "#dcc2ff"][n]}
              />
              <path
                d={`M${42 + n * 16} ${86 - n * 28}h${92 - n * 32}`}
                stroke="#ead8ff"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          ))}
          <path
            d="m90 1 7 11 12 2-9 9 2 13-12-6-12 6 2-13-9-9 12-2Z"
            fill="#e1ad29"
          />
          <path
            d="m90 0 7 8 12 2-9 9 2 13-12-6-12 6 2-13-9-9 12-2Z"
            fill="#ffdf65"
          />
        </>
      )}
      {kind === "slots" && (
        <>
          <rect x="23" y="30" width="134" height="87" rx="20" fill="#e7a22c" />
          <rect x="23" y="22" width="134" height="87" rx="20" fill="#ffcc54" />
          <rect x="34" y="35" width="112" height="53" rx="10" fill="#fff5cc" />
          {[0, 1, 2].map((n) => (
            <g key={n}>
              <rect
                x={40 + n * 35}
                y="40"
                width="30"
                height="42"
                rx="7"
                fill="#fff"
              />
              <path
                d={`m${47 + n * 35} 50 h15 l-11 24`}
                stroke="#ef7c68"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
          <path
            d="M162 68V39"
            stroke="#d58b25"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="162" cy="33" r="10" fill="#f77baa" />
          <circle cx="159" cy="30" r="3" fill="#ffb5d0" />
          <rect x="71" y="95" width="38" height="6" rx="3" fill="#e3a332" />
        </>
      )}
      {kind === "mines" && (
        <>
          {[0, 1, 2, 3, 4].map((n) => (
            <g
              key={n}
              transform={`translate(${(n % 3) * 43 + 26},${Math.floor(n / 3) * 46 + 21})`}
            >
              <rect
                y="6"
                width="37"
                height="37"
                rx="10"
                fill={n === 1 ? "#56a62a" : "#d7799a"}
              />
              <rect
                width="37"
                height="37"
                rx="10"
                fill={n === 1 ? "#89d956" : "#f7b3cd"}
              />
              {n === 1 ? (
                <path
                  d="m10 18 6 6 12-12"
                  stroke="white"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <rect x="9" y="7" width="18" height="4" rx="2" fill="#ffd6e5" />
              )}
            </g>
          ))}
        </>
      )}
      {kind === "roulette" && (
        <>
          <circle cx="90" cy="74" r="48" fill="#298fb8" />
          <circle cx="90" cy="67" r="48" fill="#74d0f3" />
          <path d="M90 67V27a40 40 0 0 1 40 40Z" fill="#ffe17b" />
          <path d="M90 67h40a40 40 0 0 1-40 40Z" fill="#afdf76" />
          <path d="M90 67v40a40 40 0 0 1-40-40Z" fill="#f7a6c4" />
          <path d="M90 67H50a40 40 0 0 1 40-40Z" fill="#b7a1ed" />
          <circle cx="90" cy="67" r="10" fill="#fff" />
          <path
            d="m90 67 23-28"
            stroke="#3481ac"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path d="m90 2-11 22h22Z" fill="#e4ad30" />
          <path d="m90 0-9 18h18Z" fill="#ffda64" />
        </>
      )}
    </svg>
  );
}
export function GamepadIcon() {
  return <TapIcon kind="games" />;
}
