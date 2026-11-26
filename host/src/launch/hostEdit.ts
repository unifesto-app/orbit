// Edit host's form (src/app/host.tsx) as PATCH /hosts/:id takes it: only what changed, blank about and website cleared
// (null), and a website without a scheme read as https:// (the API takes https only, so http:// is refused here first).
export type HostForm = { name: string; about: string; website: string; city: string; visibility: 'public' | 'private' };

export const HTTP_REFUSED = 'Use the https:// address of your website.';

/** The website to send: '' clears it, "example.com" becomes "https://example.com"; `why` when it can't be sent. */
export function siteOf(raw: string): { site: string; why?: undefined } | { site?: undefined; why: string } {
  const t = raw.trim();
  if (!t) return { site: '' };
  if (/^http:\/\//i.test(t)) return { why: HTTP_REFUSED };
  return { site: /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}` };
}

/** What changed between the form as loaded and as it stands, ready for PATCH. */
export function hostChanges(was: HostForm, f: HostForm) {
  const changes: Record<string, unknown> = {};
  const site = siteOf(f.website);
  if (f.name.trim() !== was.name.trim()) changes.name = f.name.trim();
  if (f.about.trim() !== was.about.trim()) changes.about = f.about.trim() || null;
  if (site.site !== undefined && site.site !== was.website.trim()) changes.website = site.site || null;
  if (f.city !== was.city) changes.city = f.city;
  if (f.visibility !== was.visibility) changes.visibility = f.visibility;
  return { changes, why: site.why };
}
