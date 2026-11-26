// "hostAnnouncement" as "Host announcement".
export const kindName = (kind: string) => {
  const s = kind.replace(/([A-Z])/g, " $1").toLowerCase();
  return s[0]!.toUpperCase() + s.slice(1);
};
