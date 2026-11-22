import { depth, palette, role } from "@orbit/tokens";

// The brand kit's pieces (https://claude.ai/artifact/R9S2HUVQ9q4PAHC9YPPBQ2), drawn inline so nothing is a file to load:
// the wordmark, the four symbols on tilted, crossing orbits (never a bullseye), and the one shading they share.

const stops = (ramp: typeof depth.symbol | typeof depth.wordmark) =>
  ramp.map(([at, colour]) => <stop key={at} offset={at} stopColor={colour} />);

// The 3D look: a body lit from the top-left, a raw gloss (never smoothed) and a soft Night shadow. `bevel` is the
// gloss blur: 8 for the heart, 3.4 for the small symbols, 2.9 for the one line of type (the kit's own values).
function Shade({ id, bevel, drop, blur = drop }: { id: string; bevel: number; drop: number; blur?: number }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="220%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation={bevel} result="height" />
      <feSpecularLighting in="height" surfaceScale="8" specularConstant="1.2" specularExponent="26" lightingColor={palette.stone} result="spec">
        <feDistantLight azimuth={depth.light.azimuth} elevation={depth.light.elevation} />
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss" />
      <feOffset in="SourceAlpha" dy={drop} result="drop" />
      <feGaussianBlur in="drop" stdDeviation={blur} result="dropBlur" />
      <feFlood floodColor={role.shadow} floodOpacity={depth.shadowOpacity} result="ink" />
      <feComposite in="ink" in2="dropBlur" operator="in" result="shadow" />
      <feMerge>
        <feMergeNode in="shadow" />
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="gloss" />
      </feMerge>
    </filter>
  );
}

// Once per page: the symbols' body and the filters, which CSS can point at too (the line of type).
export function Defs() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <radialGradient id="body" cx="0.36" cy="0.3" r="0.8">
          {stops(depth.symbol)}
        </radialGradient>
        <Shade id="heart3d" bevel={8} drop={12} blur={10} />
        <Shade id="sym3d" bevel={3.4} drop={5} blur={4.2} />
        <Shade id="type3d" bevel={2.9} drop={5.6} />
      </defs>
    </svg>
  );
}

// The one line of type in 3D: the wordmark's lighter ramp, clipped to the letters.
export const deepType = `linear-gradient(175deg, ${depth.wordmark.map(([at, colour]) => `${colour} ${at * 100}%`).join(", ")})`;

// ORBIT in 3D, as on the kit's cover (owner, 18 Nov 2026: "for orbit logo, use not nrml one"). The filter is in the
// drawing's own units, so the gloss and shadow scale with the logo. The kit keeps it flat under 48 px; the owner chose 3D.
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg role="img" aria-label="Orbit" viewBox="36 -742 5431 802" className={className} overflow="visible">
      <defs>
        <radialGradient id="wmBody" cx="0.36" cy="0.3" r="0.85">
          {stops(depth.wordmark)}
        </radialGradient>
        <filter id="wm3d" x="-10%" y="-40%" width="120%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="42" result="height" />
          <feSpecularLighting in="height" surfaceScale="8" specularConstant="1.2" specularExponent="26" lightingColor={palette.stone} result="spec">
            <feDistantLight azimuth={depth.light.azimuth} elevation={depth.light.elevation} />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss" />
          <feOffset in="SourceAlpha" dy="67.2" result="drop" />
          <feGaussianBlur in="drop" stdDeviation="58.8" result="dropBlur" />
          <feFlood floodColor={role.shadow} floodOpacity={depth.shadowOpacity} result="ink" />
          <feComposite in="ink" in2="dropBlur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="gloss" />
          </feMerge>
        </filter>
      </defs>
      <g fill="url(#wmBody)" filter="url(#wm3d)">
        <path d="M855 0C1052 0 1185 -149 1185 -341C1185 -536 1054 -682 855 -682H365C167 -682 36 -539 36 -341C36 -148 170 0 365 0ZM786 -300C786 -164 750 -118 668 -118H532C456 -118 422 -165 422 -300V-409C422 -530 453 -565 532 -565H668C755 -565 786 -532 786 -409Z" />
        <path transform="translate(1266,0)" d="M1236 0C1248 0 1254 -8 1254 -16C1254 -21 1252 -28 1247 -32L971 -315C1078 -331 1166 -395 1166 -508C1166 -611 1075 -682 954 -682H80C62 -682 53 -673 53 -656V-27C53 -9 62 0 80 0H423C441 0 450 -9 450 -27V-565H673C736 -565 768 -541 768 -498C768 -455 736 -430 673 -430H536C518 -430 510 -421 510 -404V-373C510 -355 516 -347 527 -336L828 -27C846 -8 869 0 894 0Z" />
        <path transform="translate(2575,0)" d="M913 0C1083 0 1157 -104 1157 -205C1157 -305 1093 -368 1050 -382C1078 -396 1129 -427 1129 -510C1129 -617 1062 -682 930 -682H62C45 -682 36 -673 36 -656V-27C36 -9 45 0 62 0ZM656 -313C731 -313 763 -282 763 -217C763 -153 731 -118 656 -118H421V-565H673C739 -565 760 -538 760 -498C760 -458 739 -430 673 -430H510C493 -430 484 -421 484 -404V-339C484 -322 493 -313 510 -313Z" />
        <path transform="translate(3820,0)" d="M429 0C446 0 455 -9 455 -27V-656C455 -673 446 -682 429 -682H84C67 -682 58 -673 58 -656V-27C58 -9 67 0 84 0Z" />
        <path transform="translate(4379,0)" d="M698 0C710 0 716 -4 716 -13V-565H1009C1022 -565 1028 -568 1028 -576V-669C1028 -678 1022 -682 1009 -682H28C15 -682 9 -678 9 -669V-576C9 -568 15 -565 28 -565H320V-13C320 -4 326 0 339 0Z" />
      </g>
    </svg>
  );
}

// The symbols in orbit exactly as on the kit's "Symbols in orbit" page (owner, 18 Nov 2026: "the rings should be same
// like in artifact", "bring heart to middle ring"): three tilted, crossing rings round the heart, each in two halves.
// The far halves and four dimmer symbols sit behind the heart; the near halves cross in front of it with a Charcoal
// gap, and three symbols ride them. Drawn in the kit's own units (its 1000 x 580 board, cropped to the rings), so the
// gloss and shadows scale with it. The line sits over the lowest part only (site.module.css, .copy), below every
// symbol, so the rings pass behind the words and no word covers a symbol (owner: "orbit back of text only"). The kit's
// two low pearls would sit under the words: one moved up its ring, one left out.
const RINGS = [
  { opacity: 0.28, points: "64,229 67,216 72,203 79,191 88,179 100,168 113,158 128,148 144,138 163,130 183,122 205,115 228,109 253,104 278,100 305,96 333,94 361,93 390,92 420,93 450,94 481,96 511,100 542,104 572,109 602,115 631,122 660,130 688,138 715,148 741,158 766,168 789,179 811,191 832,203 851,216 868,229 884,242 897,256 909,269 918,283 926,297 932,311 935,324 936,338 936,351" },
  { opacity: 0.5, points: "173,384 172,375 171,365 173,356 176,346 181,335 187,325 195,314 204,303 214,292 227,282 240,271 255,260 270,249 288,239 306,229 324,219 344,209 365,200 386,191 408,183 430,176 453,168 476,162 498,156 522,151 544,146 567,142 589,139 611,137 632,135 653,134 673,134 692,134 710,136 727,138 743,141 758,144 772,149 784,154 795,159 804,166 812,172 819,180 824,188 827,196" },
  { opacity: 0.42, points: "284,155 291,145 299,136 308,127 318,119 328,112 340,106 353,101 366,97 380,93 394,91 409,90 424,89 440,90 456,91 472,94 489,97 505,102 521,107 538,113 554,120 570,128 585,137 600,146 615,156 629,167 642,179 655,191 667,203 678,216 688,229 698,242 706,256 714,270 720,284 725,298 730,312 732,326 734,340 735,353 735,366 733,379 731,391 727,403 722,414 716,425" },
  { opacity: 0.28, points: "936,351 933,364 928,377 921,389 912,401 900,412 887,422 872,432 856,442 837,450 817,458 795,465 772,471 747,476 722,480 695,484 667,486 639,487 610,488 580,487 550,486 519,484 489,480 458,476 428,471 398,465 369,458 340,450 312,442 285,432 259,422 234,412 211,401 189,389 168,377 149,364 132,351 116,338 103,324 91,311 82,297 74,283 68,269 65,256 64,242 64,229" },
  { opacity: 0.5, points: "827,196 828,205 829,215 827,224 824,234 819,245 813,255 805,266 796,277 786,288 773,298 760,309 745,320 730,331 712,341 694,351 676,361 656,371 635,380 614,389 592,397 570,404 547,412 524,418 502,424 478,429 456,434 433,438 411,441 389,443 368,445 347,446 327,446 308,446 290,444 273,442 257,439 242,436 228,431 216,426 205,421 196,414 188,408 181,400 176,392 173,384" },
  { opacity: 0.42, points: "716,425 709,435 701,444 692,453 682,461 672,468 660,474 647,479 634,483 620,487 606,489 591,490 576,491 560,490 544,489 528,486 511,483 495,478 479,473 462,467 446,460 430,452 415,443 400,434 385,424 371,413 358,401 345,389 333,377 322,364 312,351 302,338 294,324 286,310 280,296 275,282 270,268 268,254 266,240 265,227 265,214 267,201 269,189 273,177 278,166 284,155" },
];
const far = RINGS.slice(0, 3);
const near = RINGS.slice(3);

const HEART = "M 500 553 C 455 523, 440 493, 448 473 C 456 451, 486 446, 500 468 C 514 446, 544 451, 552 473 C 560 493, 545 523, 500 553 Z";
const SPARK = (x: number, y: number, r: number) => {
  const c = r * 0.2; // the kit's pinch
  return `M ${x} ${y - r} C ${x + c} ${y - c}, ${x + c} ${y - c}, ${x + r} ${y} C ${x + c} ${y + c}, ${x + c} ${y + c}, ${x} ${y + r} C ${x - c} ${y + c}, ${x - c} ${y + c}, ${x - r} ${y} C ${x - c} ${y - c}, ${x - c} ${y - c}, ${x} ${y - r} Z`;
};

const Ring = ({ points, opacity }: { points: string; opacity: number }) => (
  <polyline points={points} fill="none" stroke={role.accent} strokeOpacity={opacity} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
);

export function Orbits({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="56 84 888 412" className={className}>
      {far.map((r) => (
        <Ring key={r.points} {...r} />
      ))}
      <g opacity={0.7}>
        <g filter="url(#sym3d)">
          <path d="M 211.7 275.4 L 216.8 288.1 L 230.4 289.0 L 220.0 297.8 L 223.3 311.0 L 211.7 303.8 L 200.2 311.0 L 203.5 297.8 L 193.0 289.0 L 206.6 288.1 Z" transform="rotate(44.6 211.7 295.1)" fill="url(#body)" />
        </g>
        <g filter="url(#sym3d)">
          <path d={SPARK(765.1, 146.4, 19.7)} transform="rotate(-17.5 765.1 146.4)" fill="url(#body)" />
        </g>
        <g filter="url(#sym3d)">
          <path d="M 513.2 91.2 L 516.6 99.7 L 525.7 100.3 L 518.7 106.1 L 520.9 114.9 L 513.2 110.1 L 505.5 114.9 L 507.7 106.1 L 500.7 100.3 L 509.8 99.7 Z" transform="rotate(-18.0 513.2 104.3)" fill="url(#body)" />
        </g>
        <g filter="url(#sym3d)">
          <path d={SPARK(673.9, 134.1, 13.95)} transform="rotate(-16.9 673.9 134.1)" fill="url(#body)" />
        </g>
      </g>
      <g filter="url(#heart3d)">
        <path d={HEART} transform="rotate(12 500 290) translate(500 290) scale(1.25) translate(-500 -500)" fill="url(#body)" />
      </g>
      {near.map((r) => (
        <g key={r.points}>
          <polyline points={r.points} fill="none" stroke={role.ground} strokeWidth={7} />
          <Ring {...r} />
        </g>
      ))}
      <g filter="url(#sym3d)">
        <circle cx={760} cy={309} r={15} fill="url(#body)" />
      </g>
      <g filter="url(#sym3d)">
        <path d={HEART} transform="rotate(-57.7 300.0 334.1) translate(300.0 334.1) scale(0.420) translate(-500 -500)" fill="url(#body)" />
      </g>
      <g filter="url(#sym3d)">
        <path d={SPARK(81.5, 296.8, 15)} transform="rotate(-57.9 81.5 296.8)" fill="url(#body)" />
      </g>
    </svg>
  );
}
