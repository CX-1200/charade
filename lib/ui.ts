/** Shared constants that are safe to import from both server and client code. */
export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6'];
export const CATEGORY_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#0ea5e9'];
export const DEFAULT_TEAMS = ['红队', '蓝队'];
export const DURATION_PRESETS = [30, 60, 90, 120, 180];
export const MIN_DURATION = 15;
export const MAX_DURATION = 600;

export const teamColor = (teams: string[], team: string) =>
  TEAM_COLORS[Math.max(0, teams.indexOf(team)) % TEAM_COLORS.length];
