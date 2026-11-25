// Shared with the host apps since 22 Nov 2026 (host apps plan, decision 14: moved, not copied).
export * from '@orbit/mobile/signin';

// The sign-in sheet's title over the questions after signing in (Take 1, owner, 25 Nov 2026): "You’re in" for an
// account About you just made, "Welcome back" for one they had, with the first name when there is one.
export function welcomeOf(name: string | null, made: boolean) {
  const first = name?.trim().split(/\s+/)[0];
  return `${made ? 'You’re in' : 'Welcome back'}${first ? `, ${first}` : ''}`;
}
