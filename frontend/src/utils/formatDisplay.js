const TEAM_NAME_MAX_LENGTH = 10

/**
 * Abbreviate long team names for matchup cards; full name available in title.
 */
export function abbreviateTeamName(name) {
  if (!name || name.length <= TEAM_NAME_MAX_LENGTH) return name
  return name.slice(0, TEAM_NAME_MAX_LENGTH - 1) + '…'
}
