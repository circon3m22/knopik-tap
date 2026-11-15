/** Original vector artwork for Knopik TAP. Filled shapes, two-tone depth, no icon font. */
export type TapIconKind =
  | "home"
  | "shop"
  | "games"
  | "path"
  | "chest"
  | "safe"
  | "profile"
  | "xp"
  | "flame"
  | "energy"
  | "heart"
  | "coin"
  | "shield"
  | "food"
  | "lock"
  | "star"
  | "check"
  | "book"
  | "trophy"
  | "memory"
  | "tap"
  | "close"
  | "arrow";
export function TapIcon({
  kind,
  className = "",
}: {
  kind: TapIconKind;
  className?: string;
}) {
  return (
    <svg
      className={`tap-icon icon-${kind} ${className}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "safe" && (
        <>
          <rect x="8" y="8" width="49" height="50" rx="10" fill="#456b82" />
          <rect x="5" y="4" width="49" height="50" rx="10" fill="#7fa6bb" />
          <rect x="11" y="10" width="37" height="38" rx="7" fill="#507c94" />
          <rect x="14" y="12" width="31" height="33" rx="5" fill="#c2dbe6" />
          <path
            d="M18 15h14"
            stroke="#e6f5fa"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect x="9" y="17" width="7" height="9" rx="2" fill="#e0eff4" />
          <rect x="9" y="33" width="7" height="9" rx="2" fill="#e0eff4" />
          <circle cx="31" cy="30" r="10" fill="#6993a9" />
          <circle cx="31" cy="28" r="10" fill="#f5ca60" />
          <circle cx="31" cy="28" r="6" fill="#fff0b4" />
          <path
            d="M31 20v5m7 3h-5m-2 8v-5m-7-3h5"
            stroke="#c39532"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="31" cy="28" r="2.5" fill="#c39532" />
          <path
            d="M14 54v4m31-4v4"
            stroke="#36566c"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "home" && (
        <>
          <path
            d="m8 29 24-19 24 19v24c0 4-3 6-7 6H15c-4 0-7-2-7-6Z"
            fill="#e49a13"
          />
          <path
            d="m11 27 21-17 21 17v23c0 3-2 5-5 5H16c-3 0-5-2-5-5Z"
            fill="#ffd442"
          />
          <path
            d="M4 25 27 6c3-2 7-2 10 0l23 19c3 3 0 8-4 7L32 14 8 32c-4 2-7-4-4-7Z"
            fill="#f56e79"
          />
          <path
            d="M4 29c-1-1-1-3 0-4L27 6c3-2 7-2 10 0l2 2L9 32c-2 1-4 0-5-3Z"
            fill="#ff8990"
          />
          <path d="M24 55V40a8 8 0 0 1 16 0v15Z" fill="#f6a416" />
          <circle cx="32" cy="27" r="6" fill="#fff4bd" />
          <circle cx="35" cy="46" r="2" fill="#fff2a1" />
        </>
      )}
      {kind === "shop" && (
        <>
          <path d="M11 28h42v28c0 3-2 5-5 5H16c-3 0-5-2-5-5Z" fill="#2a9bbd" />
          <path d="M11 25h42v28H11Z" fill="#a3def2" />
          <path d="M23 34h18v19H23Z" fill="#e6f7fc" />
          <path
            d="M7 17h50l4 13c-1 7-10 7-13 2-3 6-12 6-16 0-4 6-13 6-16 0-3 5-12 5-13-2Z"
            fill="#4ebfda"
          />
          <path d="M12 9h40l5 8H7Z" fill="#ffe377" />
          <path
            d="m17 17-1 15c-3 5-12 5-13-2l4-13Zm15 0v15c-4 6-13 6-16 0l1-15Zm15 0 1 15c-3 6-12 6-16 0V17Z"
            fill="#fff2b5"
          />
          <path d="M47 17h10l4 13c-1 7-10 7-13 2Z" fill="#fff2b5" />
          <path
            d="M31 38v9"
            stroke="#90c8d8"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "games" && (
        <>
          <path
            d="M16 18h32c6 0 10 8 12 20l1 8c1 13-8 16-16 6l-5-6H24l-5 6C11 62 2 59 3 46l1-8c2-12 6-20 12-20Z"
            fill="#7460c4"
          />
          <path
            d="M16 12h32c6 0 10 8 12 20l1 8c1 13-8 16-16 6l-5-6H24l-5 6C11 56 2 53 3 40l1-8c2-12 6-20 12-20Z"
            fill="#ad8cf4"
          />
          <path
            d="M19 23v14m-7-7h14"
            stroke="#fff"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="44" cy="24" r="4" fill="#ffe977" />
          <circle cx="52" cy="32" r="4" fill="#f77dbb" />
          <path
            d="M28 17h12"
            stroke="#cdb6ff"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "path" && (
        <>
          <path d="M17 10c0-6 7-7 8-1v46c0 5-8 5-8 0Z" fill="#3099c5" />
          <path d="M22 8c13-6 17 7 32 1v26c-14 6-22-8-32-2Z" fill="#27c4ef" />
          <path d="M22 8c6-3 11-1 16 1v26c-5-2-11-5-16-2Z" fill="#6bdffa" />
          <path d="m36 14 2 5 6 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1Z" fill="#fff" />
          <path
            d="M11 58c0-3 5-5 10-5s11 2 11 5-5 5-11 5-10-2-10-5Z"
            fill="#2686ac"
          />
        </>
      )}
      {kind === "chest" && (
        <>
          <path
            d="M7 26h50v24c0 6-5 10-11 10H18C12 60 7 56 7 50Z"
            fill="#e5a214"
          />
          <path
            d="M7 26h50v20c0 6-5 10-11 10H18C12 56 7 52 7 46Z"
            fill="#ffc928"
          />
          <path d="M7 24c0-12 9-20 25-20s25 8 25 20v9H7Z" fill="#29b4e7" />
          <path d="M15 24c0-9 6-14 17-14s17 5 17 14v9H15Z" fill="#6ad6f8" />
          <path d="M8 27h48v9H8Z" fill="#ffde50" />
          <path d="M12 8h7v45h-7ZM45 8h7v45h-7Z" fill="#ffe16a" />
          <rect x="24" y="28" width="16" height="18" rx="6" fill="#fff2a0" />
          <path
            d="M32 34v6"
            stroke="#e5ae28"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path d="m53 5 2 4 5 1-4 2v5l-3-3-4 2 1-5-3-3h5Z" fill="#fff5b8" />
        </>
      )}
      {kind === "profile" && (
        <>
          <path
            d="m9 27 1-21c0-3 3-4 5-2l15 14h6L50 4c2-2 5-1 5 2l1 22c6 20-6 33-24 33S2 48 9 27Z"
            fill="#c27d37"
          />
          <path
            d="m10 24 2-18 16 14 8 1L52 6l2 20c5 18-4 30-22 30S5 43 10 24Z"
            fill="#efa855"
          />
          <path d="m16 13 7 11-10 2Zm32 0-7 11 10 2Z" fill="#ffc68a" />
          <path
            d="M11 35c7-2 9 4 13 4 3-7 13-7 16 0 5 0 7-6 13-4 0 13-9 21-21 21S12 48 11 35Z"
            fill="#fff2d8"
          />
          <ellipse cx="22" cy="30" rx="3" ry="4" fill="#514132" />
          <ellipse cx="42" cy="30" rx="3" ry="4" fill="#514132" />
          <path d="M27 39c0-4 10-4 10 0 0 6-10 6-10 0Z" fill="#514132" />
          <path
            d="M26 49q6 5 12 0"
            stroke="#9d744f"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}
      {(kind === "xp" || kind === "energy") && (
        <>
          <rect
            x="7"
            y="12"
            width="45"
            height="45"
            rx="13"
            fill={kind === "xp" ? "#c6509d" : "#da9c20"}
          />
          <rect
            x="7"
            y="7"
            width="45"
            height="45"
            rx="13"
            fill={kind === "xp" ? "#f68acb" : "#ffcf4e"}
          />
          <path
            d="M55 23h3c4 0 4 14 0 14h-3Z"
            fill={kind === "xp" ? "#d45aad" : "#e5a52c"}
          />
          <path d="m33 12-14 20h11l-3 15 16-23H31Z" fill="#fff" />
          <path
            d="M15 12h10"
            stroke={kind === "xp" ? "#ffc3e9" : "#ffe99c"}
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "flame" && (
        <>
          <path
            d="M36 4c6 14 5 17 12 22l4-9c13 25 5 43-20 43S2 39 12 24l7 5c0-12 6-18 17-25Z"
            fill="#ef8b07"
          />
          <path
            d="M36 3c5 11 2 17 10 22l4-7c9 18 4 34-18 34S7 38 15 24l4 5c0-12 6-18 17-26Z"
            fill="#ffb91c"
          />
          <path
            d="M34 29c2 7 9 11 8 16-1 8-18 9-20 0-1-6 6-9 12-16Z"
            fill="#ffe169"
          />
        </>
      )}
      {kind === "heart" && (
        <>
          <path
            d="M32 17C12 0-4 25 8 39l19 20c3 3 7 3 10 0l19-20C68 25 52 0 32 17Z"
            fill="#db518d"
          />
          <path
            d="M32 11C12-5-4 19 8 33l19 20c3 3 7 3 10 0l19-20C68 19 52-5 32 11Z"
            fill="#ff87bb"
          />
          <path
            d="M13 19c1-5 5-7 10-6"
            stroke="#ffc1dc"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "coin" && (
        <>
          <ellipse cx="33" cy="35" rx="25" ry="27" fill="#dda324" />
          <circle cx="30" cy="29" r="25" fill="#ffd550" />
          <circle cx="30" cy="29" r="18" stroke="#f1b52e" strokeWidth="3" />
          <path
            d="M23 18v22m0-10 14-12m-14 12 14 10"
            stroke="#d89916"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 24c1-8 6-13 13-14"
            stroke="#ffe990"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "shield" && (
        <>
          <path
            d="m32 7 25 9v18c0 16-12 24-25 28C19 58 7 50 7 34V16Z"
            fill="#278cb9"
          />
          <path
            d="m32 2 25 9v18c0 16-12 24-25 28C19 53 7 45 7 29V11Z"
            fill="#55c6eb"
          />
          <path d="m32 10 17 6v13c0 10-7 17-17 21Z" fill="#8adcf5" />
          <path
            d="m22 29 7 7 14-15"
            stroke="#fff"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {kind === "food" && (
        <>
          <path
            d="M12 27h40l8 24c1 5-2 9-7 9H11c-5 0-8-4-7-9Z"
            fill="#cf8d32"
          />
          <path
            d="M12 22h40l8 24c1 5-2 9-7 9H11c-5 0-8-4-7-9Z"
            fill="#f9bd62"
          />
          <ellipse cx="32" cy="24" rx="21" ry="9" fill="#976643" />
          {[
            [20, 21],
            [30, 18],
            [41, 21],
            [26, 26],
            [38, 26],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#b58251" />
          ))}
          <ellipse cx="32" cy="42" rx="7" ry="5" fill="#ffedc3" />
          <circle cx="24" cy="36" r="2.6" fill="#ffedc3" />
          <circle cx="30" cy="34" r="2.6" fill="#ffedc3" />
          <circle cx="37" cy="35" r="2.6" fill="#ffedc3" />
          <circle cx="42" cy="39" r="2.6" fill="#ffedc3" />
        </>
      )}
      {kind === "lock" && (
        <>
          <path
            d="M19 30V19a13 13 0 0 1 26 0v11"
            stroke="#7897a2"
            strokeWidth="8"
          />
          <rect x="11" y="25" width="42" height="35" rx="10" fill="#7897a2" />
          <rect x="11" y="21" width="42" height="35" rx="10" fill="#a8bec4" />
          <circle cx="32" cy="36" r="5" fill="#688a97" />
          <path
            d="M32 39v6"
            stroke="#688a97"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "star" && (
        <>
          <path
            d="m32 8 9 16 19 3-14 14 3 19-17-8-17 8 3-19L4 27l19-3Z"
            fill="#dda728"
          />
          <path
            d="m32 2 9 16 19 3-14 14 3 19-17-8-17 8 3-19L4 21l19-3Z"
            fill="#ffda58"
          />
          <path d="m32 10 5 13 15 2-14 5Z" fill="#fff0a7" />
        </>
      )}
      {kind === "check" && (
        <>
          <path
            d="m13 33 13 13 26-28"
            stroke="#339f0e"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m13 28 13 13 26-28"
            stroke="#6bd31a"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {(kind === "book" || kind === "memory") && (
        <>
          <path
            d="M7 13c10-4 17-1 25 3 8-4 15-7 25-3v41c-12-2-17 1-25 5-8-4-13-7-25-5Z"
            fill="#279bc5"
          />
          <path
            d="M7 7c10-4 17-1 25 3 8-4 15-7 25-3v41c-12-2-17 1-25 5-8-4-13-7-25-5Z"
            fill="#79d7f3"
          />
          <path
            d="M11 7c8-1 13 1 19 4v37c-6-3-11-5-19-4Zm42 0c-8-1-13 1-19 4v37c6-3 11-5 19-4Z"
            fill="#fff"
          />
          <path
            d="M18 17h5m-5 8h5m18-8h5m-5 8h5"
            stroke="#d8edf4"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "trophy" && (
        <>
          <path
            d="M11 16H5v12c0 9 7 14 16 14m32-26h6v12c0 9-7 14-16 14"
            stroke="#df9b25"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path d="M17 5h30v23c0 10-6 17-15 17S17 38 17 28Z" fill="#ffc447" />
          <path d="M23 5h18v23c0 6-4 10-9 10s-9-4-9-10Z" fill="#ffdf78" />
          <path d="M28 42h8v11h-8Z" fill="#de9c24" />
          <rect x="17" y="52" width="30" height="10" rx="4" fill="#d78e1b" />
          <rect x="17" y="49" width="30" height="9" rx="4" fill="#ffc447" />
        </>
      )}
      {kind === "tap" && (
        <>
          <ellipse cx="32" cy="43" rx="16" ry="14" fill="#cb8640" />
          <ellipse cx="32" cy="38" rx="16" ry="14" fill="#f6bb6f" />
          {[
            [13, 23],
            [25, 14],
            [40, 14],
            [52, 25],
          ].map(([x, y]) => (
            <g key={x}>
              <ellipse cx={x} cy={y + 4} rx="7" ry="9" fill="#cb8640" />
              <ellipse cx={x} cy={y} rx="7" ry="9" fill="#f6bb6f" />
            </g>
          ))}
          <path
            d="M25 35q7-6 14 0"
            stroke="#ffd69a"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "close" && (
        <path
          d="m19 19 26 26m0-26L19 45"
          stroke="#7b8f97"
          strokeWidth="8"
          strokeLinecap="round"
        />
      )}
      {kind === "arrow" && (
        <path
          d="m25 13 18 19-18 19"
          stroke="#7b8f97"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
