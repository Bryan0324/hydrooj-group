import { addPage, NamedPage } from '@hydrooj/ui-default';

interface TeamEntry {
  teamId: string;
  teamName: string;
  participants: number[];
}

interface ContestEntriesResponse {
  entries: TeamEntry[];
}

/** Row data cloned from the individual scoreboard for one team member. */
interface MemberRowSnapshot {
  uid: number;
  /** The numeric rank read from the first cell (or Infinity if not found). */
  rank: number;
  /** Full HTML of the row — used to clone cells into the team table. */
  cells: HTMLCollectionOf<HTMLTableCellElement>;
  row: HTMLTableRowElement;
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

function extractRankFromRow(row: HTMLTableRowElement): number {
  const firstCell = row.querySelector<HTMLTableCellElement>('td:first-child');
  if (!firstCell) return Infinity;
  const n = parseInt(firstCell.textContent?.trim() ?? '', 10);
  return Number.isNaN(n) ? Infinity : n;
}

/**
 * Builds a map from userId → TeamEntry in O(participants_total).
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
 * Reads all rows from the existing individual scoreboard table and returns
 * a team → best-ranked member snapshot map.
 * The individual scoreboard is NOT modified.
 */
function collectTeamSnapshots(
  tbody: HTMLElement,
  userTeamMap: Map<number, TeamEntry>,
): Map<string, MemberRowSnapshot> {
  const best = new Map<string, MemberRowSnapshot>();
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));

  for (const row of rows) {
    const uid = extractUidFromRow(row);
    if (uid === null) continue;
    const entry = userTeamMap.get(uid);
    if (!entry) continue;

    const rank = extractRankFromRow(row);
    const existing = best.get(entry.teamId);
    if (!existing || rank < existing.rank) {
      best.set(entry.teamId, { uid, rank, cells: row.cells, row });
    }
  }
  return best;
}

/**
 * Escapes HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds and injects a standalone "隊伍排行榜" section above the existing
 * individual scoreboard.  The individual scoreboard is left completely intact.
 */
function injectTeamScoreboardPanel(
  entries: TeamEntry[],
  teamSnapshots: Map<string, MemberRowSnapshot>,
  anchorTable: HTMLTableElement,
): void {
  // Sort teams by best-member rank (ascending)
  const sortedEntries = [...entries].sort((a, b) => {
    const rankA = teamSnapshots.get(a.teamId)?.rank ?? Infinity;
    const rankB = teamSnapshots.get(b.teamId)?.rank ?? Infinity;
    return rankA - rankB;
  });

  // Determine column headers from the existing table
  const existingThead = anchorTable.querySelector<HTMLElement>('thead');
  const headerCells = existingThead
    ? Array.from(existingThead.querySelectorAll<HTMLElement>('th'))
    : [];

  // Build header row: replace the "user/name" column header with "隊伍名稱"
  const nameColIndex = headerCells.findIndex((th) =>
    /user|name|名|選手|contestant/i.test(th.textContent ?? ''),
  );

  const thHtml = headerCells.map((th, i) => {
    const label = i === nameColIndex ? '隊伍名稱' : (th.textContent?.trim() ?? '');
    return `<th>${escapeHtml(label)}</th>`;
  }).join('');

  // Build body rows
  const tbodyRows = sortedEntries.map((entry, idx) => {
    const snap = teamSnapshots.get(entry.teamId);
    if (!snap) return '';

    // Clone cells from the best-ranked member row; replace the name cell
    const cellsHtml = Array.from(snap.cells).map((td, i) => {
      if (i === 0) {
        // Rank column — renumber sequentially
        return `<td>${idx + 1}</td>`;
      }
      if (i === nameColIndex) {
        // Name column — show team name (bold) + member count
        return `<td><strong>${escapeHtml(entry.teamName)}</strong> <small>(${entry.participants.length} 人)</small></td>`;
      }
      // All other columns (score, penalty, problem cells …) — copy as-is
      return `<td>${td.innerHTML}</td>`;
    }).join('');

    return `<tr data-group-team-id="${escapeHtml(entry.teamId)}">${cellsHtml}</tr>`;
  }).filter(Boolean).join('');

  const panel = document.createElement('div');
  panel.id = 'group-team-scoreboard';
  panel.className = 'section';
  panel.innerHTML = `
    <div class="section__header">
      <h1 class="section__title">🏆 隊伍排行榜</h1>
    </div>
    <div class="section__body">
      <p style="color:#888;font-size:.875em;margin-bottom:.5em;">
        每支隊伍以最高排名成員的成績代表出賽；個人排行榜請見下方。
      </p>
      <div class="table-responsive-sm">
        <table class="data-table">
          ${headerCells.length ? `<thead><tr>${thHtml}</tr></thead>` : ''}
          <tbody>${tbodyRows || '<tr><td colspan="99" style="text-align:center;color:#aaa;">尚無隊伍完成報名</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;

  // Insert the panel before the container that holds the individual table
  const tableContainer = anchorTable.closest<HTMLElement>('.section, .typo, main')
    ?? anchorTable.parentElement;
  if (tableContainer?.parentElement) {
    tableContainer.parentElement.insertBefore(panel, tableContainer);
  } else {
    anchorTable.parentElement?.insertBefore(panel, anchorTable);
  }
}

addPage(new NamedPage(['contest_scoreboard'], async () => {
  const contestId = getContestIdFromUrl();
  if (!contestId) return;

  const data = await fetchEntries(contestId);
  if (!data?.entries?.length) return;

  const userTeamMap = buildUserTeamMap(data.entries);
  if (!userTeamMap.size) return;

  // Locate the existing individual scoreboard table — do NOT modify it
  const table = document.querySelector<HTMLTableElement>(
    'table.contest__rank-table, table[class*="rank"], table[class*="scoreboard"], .typo table, table',
  );
  if (!table) return;
  const tbody = table.querySelector<HTMLElement>('tbody');
  if (!tbody) return;

  const teamSnapshots = collectTeamSnapshots(tbody, userTeamMap);
  injectTeamScoreboardPanel(data.entries, teamSnapshots, table);
}));
