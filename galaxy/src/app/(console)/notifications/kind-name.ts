// "hostAnnouncement" as "Host announcement". Its own file so client components can use it (tabs.tsx reads the session).
export const kindName = (kind: string) => {
  const s = kind.replace(/([A-Z])/g, " $1").toLowerCase();
  return s[0]!.toUpperCase() + s.slice(1);
};
