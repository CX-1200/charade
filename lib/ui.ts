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
