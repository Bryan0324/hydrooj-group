import { addPage, NamedPage } from '@hydrooj/ui-default';

interface TeamEntry {
  teamId: string;
  teamName: string;
  participants: number[];
}

interface ContestEntriesResponse {
  entries: TeamEntry[];
}

/**
 * Extracts the contest tid from the current URL.
 * Supports /contest/:tid and /d/:domainId/contest/:tid.
 */
function getContestIdFromUrl(): string | null {
  const match = window.location.pathname.match(/\/contest\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

async function fetchEntries(contestId: string): Promise<ContestEntriesResponse | null> {
  try {
    const res = await fetch(`/group/api/contest/${contestId}/entries`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.json() as ContestEntriesResponse;
  } catch {
    return null;
  }
}

/**
 * Tries to extract a user ID from a scoreboard table row by inspecting:
 *   1. data-uid attribute on the <tr>
 *   2. href of a /user/:uid link inside the row
 */
function extractUidFromRow(row: HTMLTableRowElement): number | null {
  const attrUid = row.getAttribute('data-uid') ?? row.getAttribute('data-user-id');
  if (attrUid) {
    const n = parseInt(attrUid, 10);
    if (!Number.isNaN(n)) return n;
  }
  const links = row.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const link of links) {
    const m = link.getAttribute('href')?.match(/\/user\/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Builds a map from userId → TeamEntry so we can look up which team each
 * scoreboard row belongs to in O(1).
 */
function buildUserTeamMap(entries: TeamEntry[]): Map<number, TeamEntry> {
  const map = new Map<number, TeamEntry>();
  for (const entry of entries) {
    for (const uid of entry.participants) {
      map.set(uid, entry);
    }
  }
  return map;
}

/**
 * Replaces the user name / link cell in a row with a plain team-name label.
 */
function replaceWithTeamName(row: HTMLTableRowElement, teamName: string): void {
  const userLink = row.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
  if (userLink) {
    const span = document.createElement('span');
    span.textContent = teamName;
    span.style.fontWeight = 'bold';
    userLink.replaceWith(span);
    return;
  }
  // Fallback: look for a cell with a known class
  const nameCell = row.querySelector<HTMLElement>(
    '.user-profile-name, [class*="username"], [class*="user-name"]',
  );
  if (nameCell) {
    nameCell.textContent = teamName;
    nameCell.style.fontWeight = 'bold';
  }
}

/**
 * Re-numbers the rank column for all visible rows sequentially.
 * Looks for the first <td> in each row that contains only a number.
 */
function renumberRanks(tbody: HTMLElement): void {
  const visibleRows = Array.from(
    tbody.querySelectorAll<HTMLTableRowElement>('tr'),
  ).filter((r) => r.style.display !== 'none');

  let rank = 1;
  for (const row of visibleRows) {
    const firstCell = row.querySelector<HTMLTableCellElement>('td:first-child');
    if (firstCell && /^\s*\d+\s*$/.test(firstCell.textContent ?? '')) {
      firstCell.textContent = String(rank);
    }
    rank++;
  }
}

/**
 * Main DOM-manipulation entry point.
 *
 * For every team that has registered for this contest:
 *   - The highest-ranked member row is kept and relabelled with the team name.
 *   - All other member rows belonging to the same team are hidden.
 * Individual participants (no team) are left untouched.
 */
function applyTeamGrouping(userTeamMap: Map<number, TeamEntry>): void {
  // Locate the scoreboard table — try several common selectors used by HydroOJ
  const table = document.querySelector<HTMLTableElement>(
    'table.contest__rank-table, table[class*="rank"], table[class*="scoreboard"], .typo table, table',
  );
  if (!table) return;
  const tbody = table.querySelector<HTMLElement>('tbody');
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));

  // First pass: build team → [rows in rank order] map
  const teamRowsMap = new Map<string, HTMLTableRowElement[]>();
  const rowToEntry = new Map<HTMLTableRowElement, TeamEntry>();

  for (const row of rows) {
    const uid = extractUidFromRow(row);
    if (uid === null) continue;
    const entry = userTeamMap.get(uid);
    if (!entry) continue;

    rowToEntry.set(row, entry);
    if (!teamRowsMap.has(entry.teamId)) teamRowsMap.set(entry.teamId, []);
    teamRowsMap.get(entry.teamId)!.push(row);
  }

  // Second pass: keep first row per team, rename it, hide the rest
  for (const memberRows of teamRowsMap.values()) {
    if (!memberRows.length) continue;
    const entry = rowToEntry.get(memberRows[0])!;

    // Label the top-ranked row with the team name
    replaceWithTeamName(memberRows[0], entry.teamName);
    memberRows[0].setAttribute('data-group-team-id', entry.teamId);
    memberRows[0].title = `隊伍: ${entry.teamName}`;

    // Hide the remaining member rows
    for (let i = 1; i < memberRows.length; i++) {
      memberRows[i].style.display = 'none';
    }
  }

  // Re-number ranks to close the gaps left by hidden rows
  renumberRanks(tbody);
}

addPage(new NamedPage(['contest_scoreboard'], async () => {
  const contestId = getContestIdFromUrl();
  if (!contestId) return;

  const data = await fetchEntries(contestId);
  if (!data?.entries?.length) return;

  const userTeamMap = buildUserTeamMap(data.entries);
  if (!userTeamMap.size) return;

  applyTeamGrouping(userTeamMap);
}));
