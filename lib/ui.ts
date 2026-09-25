/** Shared constants that are safe to import from both server and client code. */

/** Brand palette: warm cream ground, signal red accent. */
export const CREAM = '#e0dace';
export const RED = '#de2c00';

/** Team accents — red leads, the rest are muted tones that sit well on cream. */
export const TEAM_COLORS = [RED, '#1f5673', '#4a7c3f', '#b07d18', '#6b4c9a', '#0f7a75'];
export const CATEGORY_COLORS = [RED, '#1f5673', '#4a7c3f', '#b07d18', '#6b4c9a', '#0f7a75'];
export const DEFAULT_TEAMS = ['Red Team', 'Blue Team'];
export const DURATION_PRESETS = [30, 60, 90, 120, 180];
export const MIN_DURATION = 15;
export const MAX_DURATION = 600;

export const teamColor = (teams: string[], team: string) =>
  TEAM_COLORS[Math.max(0, teams.indexOf(team)) % TEAM_COLORS.length];

/**
 * Hype for a team on a run of correct answers. A skip resets the run. Past the
 * last tier the label stays at the top one.
 */
export const STREAK_TIERS = [
  { at: 3, label: 'On Fire!', emoji: '🔥' },
  { at: 5, label: 'Unstoppable!', emoji: '⚡' },
  { at: 8, label: 'Legendary!', emoji: '👑' },
  { at: 12, label: 'Godlike!', emoji: '🌟' },
] as const;

export function streakTier(streak: number) {
  let tier: (typeof STREAK_TIERS)[number] | null = null;
  for (const t of STREAK_TIERS) if (streak >= t.at) tier = t;
  return tier;
}

/** The tier a team just stepped into on this answer, if it crossed one. */
export function streakMilestone(streak: number) {
  return STREAK_TIERS.find((t) => t.at === streak) ?? null;
}
