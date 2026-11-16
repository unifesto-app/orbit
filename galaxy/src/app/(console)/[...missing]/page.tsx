import { notFound } from "next/navigation";

// Any other address shows not-found.tsx inside the shell, as the sections not built yet always have.
// It never renders anything, so there's nothing for instant-navigation validation to check.
export const instant = false;

export default function Missing() {
  notFound();
}
