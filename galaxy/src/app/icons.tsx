// 16px stroke icons drawn in Cloudscape's style (2px stroke, round joins).
// Add a path here when a screen needs a new one.

const paths = {
  panel: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
    </>
  ),
  "angle-left": <path d="M10 3 5 8l5 5" />,
  "angle-down": <path d="m4 6 4 4 4-4" />,
  search: (
    <>
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3.5 3.5" />
    </>
  ),
  external: <path d="M10 2h4v4M14 2 8 8M12 9v5H2V4h5" />,
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
