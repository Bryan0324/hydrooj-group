import { addPage, NamedPage } from '@hydrooj/ui-default';

interface TeamDoc {
  _id: string;
  name: string;
  ownerId: number;
  members: number[];
}

interface ContestEntryDoc {
  contestId: string;
  teamId: string;
  updatedAt: string;
}

interface TeamsApiResponse {
  teams: TeamDoc[];
  entryMap: Record<string, ContestEntryDoc>;
}

/**
 * Extracts the contest tid (hex string) from the current URL.
 * Supports both /contest/:tid and /d/:domainId/contest/:tid.
 */
function getContestIdFromUrl(): string | null {
  const match = window.location.pathname.match(/\/contest\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

/**
 * Fetches the current user's teams and their registration status for a given
 * contest from the plugin's JSON API.
 */
async function fetchTeams(contestId: string): Promise<TeamsApiResponse | null> {
  try {
    const res = await fetch(`/group/api/contest/${contestId}/teams`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return await res.json() as TeamsApiResponse;
  } catch {
    return null;
  }
}

/**
 * Builds the HTML for the team registration panel and appends it to the
 * contest detail page's main content column.
 */
function renderPanel(contestId: string, teams: TeamDoc[], entryMap: Record<string, ContestEntryDoc>): void {
  if (!teams.length) return;

  const rows = teams.map((team) => {
    const entry = entryMap[team._id];
    const registered = !!entry;
    const href = `/group/contest/${contestId}/team/${team._id}/register`;
    const btnClass = registered ? 'button small' : 'primary button small';
    const btnLabel = registered ? '重新報名' : '前往報名';
    const statusHtml = registered
      ? `<span style="color:#27ae60;">✔ 已報名</span>`
      : `<span style="color:#aaa;">尚未報名</span>`;

    return `<tr>
      <td><strong>${escapeHtml(team.name)}</strong></td>
      <td>${team.members.length}</td>
      <td>${statusHtml}</td>
      <td><a class="${btnClass}" href="${href}">${btnLabel}</a></td>
    </tr>`;
  }).join('');

  const section = document.createElement('div');
  section.className = 'section';
  section.id = 'group-contest-entry';
  section.innerHTML = `
    <div class="section__header">
      <h1 class="section__title">隊伍報名</h1>
    </div>
    <div class="section__body">
      <table class="data-table">
        <colgroup>
          <col style="width:40%">
          <col style="width:10%">
          <col style="width:20%">
          <col>
        </colgroup>
        <thead>
          <tr>
            <th>隊伍名稱</th>
            <th>成員數</th>
            <th>報名狀態</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Try common HydroOJ content containers in order of specificity.
  const container = document.querySelector<HTMLElement>('.main-content-column')
    ?? document.querySelector<HTMLElement>('.contest__detail')
    ?? document.querySelector<HTMLElement>('main .row > [class*="column"]')
    ?? document.querySelector<HTMLElement>('main');

  if (container) container.appendChild(section);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

addPage(new NamedPage(['contest_detail'], async () => {
  const contestId = getContestIdFromUrl();
  if (!contestId) return;

  const data = await fetchTeams(contestId);
  if (!data?.teams?.length) return;

  renderPanel(contestId, data.teams, data.entryMap);
}));
