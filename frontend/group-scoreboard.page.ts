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
  cells: HTMLCollectionOf<HTMLTableCellElement>;
  row: HTMLTableRowElement;
}

/**
 * Plain-text row used for export (CSV / HTML).
 * `extraCells` contains the text content of every column after rank and name.
 */
interface TeamExportRow {
  rank: number;
  teamName: string;
  memberCount: number;
  teamId: string;
  /** Text content of every column that is neither rank nor name. */
  extraCells: string[];
}

// ----------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------

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

function extractUidFromRow(row: HTMLTableRowElement): number | null {
  const attrUid = row.getAttribute('data-uid') ?? row.getAttribute('data-user-id');
  if (attrUid) {
    const n = parseInt(attrUid, 10);
    if (!Number.isNaN(n)) return n;
  }
  for (const link of row.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const m = link.getAttribute('href')?.match(/\/user\/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function extractRankFromRow(row: HTMLTableRowElement): number {
  const firstCell = row.querySelector<HTMLTableCellElement>('td:first-child');
  const n = parseInt(firstCell?.textContent?.trim() ?? '', 10);
  return Number.isNaN(n) ? Infinity : n;
}

function buildUserTeamMap(entries: TeamEntry[]): Map<number, TeamEntry> {
  const map = new Map<number, TeamEntry>();
  for (const entry of entries) {
    for (const uid of entry.participants) map.set(uid, entry);
  }
  return map;
}

function collectTeamSnapshots(
  tbody: HTMLElement,
  userTeamMap: Map<number, TeamEntry>,
): Map<string, MemberRowSnapshot> {
  const best = new Map<string, MemberRowSnapshot>();
  for (const row of tbody.querySelectorAll<HTMLTableRowElement>('tr')) {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------
// Export helpers
// ----------------------------------------------------------------

/** Wraps a cell value for RFC 4180 CSV (quotes if needed). */
function csvCell(value: string): string {
  const s = value.replace(/\r?\n/g, ' ').trim();
  return s.includes(',') || s.includes('"')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function buildCsv(headers: string[], rows: TeamExportRow[]): string {
  const headerLine = headers.map(csvCell).join(',');
  const dataLines = rows.map((r) =>
    [
      csvCell(String(r.rank)),
      csvCell(r.teamName),
      csvCell(String(r.memberCount)),
      ...r.extraCells.map(csvCell),
    ].join(','),
  );
  return [headerLine, ...dataLines].join('\r\n');
}

function buildExportHtml(
  contestTitle: string,
  headers: string[],
  rows: TeamExportRow[],
): string {
  const ths = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = rows.map((r) => {
    const tds = [
      `<td>${r.rank}</td>`,
      `<td>${escapeHtml(r.teamName)}</td>`,
      `<td>${r.memberCount}</td>`,
      ...r.extraCells.map((c) => `<td>${escapeHtml(c)}</td>`),
    ].join('');
    return `<tr>${tds}</tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>${escapeHtml(contestTitle)} – 隊伍排行榜</title>
<style>
  body{font-family:sans-serif;margin:2em}
  h1{font-size:1.4em}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:.4em .8em;text-align:left}
  thead{background:#f5f5f5;font-weight:bold}
  tr:nth-child(even){background:#fafafa}
</style>
</head>
<body>
<h1>${escapeHtml(contestTitle)} – 隊伍排行榜</h1>
<table>
  <thead><tr>${ths}</tr></thead>
  <tbody>
${trs}
  </tbody>
</table>
</body>
</html>`;
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Maximum characters taken from the contest title when building the export filename. */
const MAX_EXPORT_FILENAME_TITLE_LENGTH = 40;

// ----------------------------------------------------------------
// Panel injection
// ----------------------------------------------------------------

function injectTeamScoreboardPanel(
  entries: TeamEntry[],
  teamSnapshots: Map<string, MemberRowSnapshot>,
  anchorTable: HTMLTableElement,
): void {
  const existingThead = anchorTable.querySelector<HTMLElement>('thead');
  const headerCells = existingThead
    ? Array.from(existingThead.querySelectorAll<HTMLElement>('th'))
    : [];

  // Identify which column index holds the participant name
  const nameColIndex = headerCells.findIndex((th) =>
    /user|name|名|選手|contestant/i.test(th.textContent ?? ''),
  );

  // Sort teams by best-member rank
  const sortedEntries = [...entries].sort((a, b) => {
    const rA = teamSnapshots.get(a.teamId)?.rank ?? Infinity;
    const rB = teamSnapshots.get(b.teamId)?.rank ?? Infinity;
    return rA - rB;
  });

  // Column headers: 名次 | 隊伍名稱 | 成員數 | <extra columns>
  const extraHeaderLabels = headerCells
    .filter((_, i) => i !== 0 && i !== nameColIndex)
    .map((th) => th.textContent?.trim() ?? '');
  const displayHeaders = ['名次', '隊伍名稱', '成員數', ...extraHeaderLabels];

  // Build export rows (plain-text, used for CSV and HTML export)
  const exportRows: TeamExportRow[] = [];
  for (let idx = 0; idx < sortedEntries.length; idx++) {
    const entry = sortedEntries[idx];
    const snap = teamSnapshots.get(entry.teamId);
    if (!snap) continue;
    const extraCells = Array.from(snap.cells)
      .filter((_, i) => i !== 0 && i !== nameColIndex)
      .map((td) => td.textContent?.trim() ?? '');
    exportRows.push({
      rank: idx + 1,
      teamName: entry.teamName,
      memberCount: entry.participants.length,
      teamId: entry.teamId,
      extraCells,
    });
  }

  // Build the display table HTML (rich inner HTML copied from original scoreboard)
  const thHtml = displayHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const tbodyHtml = exportRows.length
    ? exportRows.map((r) => {
      const snap = teamSnapshots.get(r.teamId)!;
      const extraTds = Array.from(snap.cells)
        .filter((_, i) => i !== 0 && i !== nameColIndex)
        .map((td) => `<td>${td.innerHTML}</td>`)
        .join('');
      return `<tr data-group-team-id="${escapeHtml(r.teamId)}">
        <td>${r.rank}</td>
        <td><strong>${escapeHtml(r.teamName)}</strong></td>
        <td>${r.memberCount}</td>
        ${extraTds}
      </tr>`;
    }).join('')
    : '<tr><td colspan="99" style="text-align:center;color:#aaa;">尚無隊伍完成報名</td></tr>';

  // Create panel DOM
  const panel = document.createElement('div');
  panel.id = 'group-team-scoreboard';
  panel.className = 'section';
  panel.innerHTML = `
    <div class="section__header">
      <h1 class="section__title">🏆 隊伍排行榜</h1>
      <div class="section__header-actions">
        <button id="group-export-csv"  class="button small">匯出 CSV</button>
        <button id="group-export-html" class="button small" style="margin-left:.5em;">匯出 HTML</button>
      </div>
    </div>
    <div class="section__body">
      <p style="color:#888;font-size:.875em;margin-bottom:.5em;">
        每支隊伍以最高排名成員的成績代表出賽；個人排行榜請見下方。
      </p>
      <div class="table-responsive-sm">
        <table id="group-team-table" class="data-table">
          ${headerCells.length ? `<thead><tr>${thHtml}</tr></thead>` : ''}
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    </div>`;

  const tableContainer = anchorTable.closest<HTMLElement>('.section, .typo, main')
    ?? anchorTable.parentElement;
  if (tableContainer?.parentElement) {
    tableContainer.parentElement.insertBefore(panel, tableContainer);
  } else if (anchorTable.parentElement) {
    anchorTable.parentElement.insertBefore(panel, anchorTable);
  } else {
    console.warn('[group-scoreboard] Could not find a parent element to insert the team scoreboard panel.');
  }

  // Wire up export buttons
  const contestTitle =
    document.querySelector<HTMLElement>('h1.page-title, h1, title')
      ?.textContent?.trim() ?? '比賽';
  const baseName = `team-scoreboard-${contestTitle.replace(/\s+/g, '_').slice(0, MAX_EXPORT_FILENAME_TITLE_LENGTH)}`;

  const csvBtn = panel.querySelector('#group-export-csv');
  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      const csv = buildCsv(displayHeaders, exportRows);
      triggerDownload(`${baseName}.csv`, csv, 'text/csv;charset=utf-8;');
    });
  } else {
    console.warn('[group-scoreboard] CSV export button (#group-export-csv) not found in panel.');
  }

  const htmlBtn = panel.querySelector('#group-export-html');
  if (htmlBtn) {
    htmlBtn.addEventListener('click', () => {
      const html = buildExportHtml(contestTitle, displayHeaders, exportRows);
      triggerDownload(`${baseName}.html`, html, 'text/html;charset=utf-8;');
    });
  } else {
    console.warn('[group-scoreboard] HTML export button (#group-export-html) not found in panel.');
  }
}

// ----------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------

addPage(new NamedPage(['contest_scoreboard'], async () => {
  const contestId = getContestIdFromUrl();
  if (!contestId) {
    console.warn('[group-scoreboard] Could not extract contest ID from URL:', window.location.pathname);
    return;
  }

  const data = await fetchEntries(contestId);
  if (!data?.entries?.length) {
    console.warn('[group-scoreboard] No team entries returned for contest:', contestId);
    return;
  }

  const userTeamMap = buildUserTeamMap(data.entries);
  if (!userTeamMap.size) {
    console.warn('[group-scoreboard] Team entries exist but no participant UIDs were found.');
    return;
  }

  // Locate the existing individual scoreboard table — do NOT modify it
  const table = document.querySelector<HTMLTableElement>(
    'table.contest__rank-table, table[class*="rank"], table[class*="scoreboard"], .typo table, table',
  );
  if (!table) {
    console.warn('[group-scoreboard] Could not find a scoreboard table in the DOM.');
    return;
  }
  const tbody = table.querySelector<HTMLElement>('tbody');
  if (!tbody) {
    console.warn('[group-scoreboard] Scoreboard table has no <tbody>.');
    return;
  }

  const teamSnapshots = collectTeamSnapshots(tbody, userTeamMap);
  injectTeamScoreboardPanel(data.entries, teamSnapshots, table);
}));
