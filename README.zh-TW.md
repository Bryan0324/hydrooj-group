# hydrooj-group

HydroOJ 隊伍管理外掛，提供隊伍建立、邀請成員、以及以隊伍身分參加競賽等功能。

[English](./README.md) | **繁體中文**

---

## 目錄

1. [功能概覽](#功能概覽)
2. [安裝方式](#安裝方式)
3. [資料結構](#資料結構)
4. [HTTP API 使用說明](#http-api-使用說明)
   - [建立隊伍](#建立隊伍)
   - [邀請成員](#邀請成員)
   - [回應邀請](#回應邀請)
   - [以隊伍身分報名競賽](#以隊伍身分報名競賽)
5. [程式模型 API](#程式模型-api)
6. [身分識別抽象層](#身分識別抽象層)
7. [MongoDB 集合說明](#mongodb-集合說明)
8. [開發與建置](#開發與建置)

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| 建立隊伍 | 登入使用者可建立新隊伍，建立者自動成為隊長 |
| 邀請成員 | 隊長可邀請其他使用者加入隊伍 |
| 回應邀請 | 被邀請者可接受或拒絕邀請 |
| 隊伍報名競賽 | 隊伍成員可以隊伍身分報名競賽，所有成員皆為參賽者 |
| 身分識別抽象 | 提供 `resolveIdentity()` 讓競賽邏輯統一處理個人與隊伍兩種身分 |

---

## 安裝方式

1. 將本外掛複製至 HydroOJ 的外掛目錄，或以 npm 套件形式安裝：

   ```bash
   # 於 HydroOJ 根目錄
   yarn add hydrooj-group
   # 或
   npm install hydrooj-group
   ```

2. 在 HydroOJ 的外掛設定中啟用 `hydrooj-group`。

3. 重新啟動 HydroOJ，外掛會自動向 Hydro 核心註冊路由與模型。

> **注意：** 本外掛需要 Node.js ≥ 18 及 HydroOJ 正式版本。

---

## 資料結構

### TeamDoc（隊伍文件）

儲存於 MongoDB 集合 `group_teams`。

| 欄位 | 類型 | 說明 |
|------|------|------|
| `_id` | `string` | 隊伍唯一 ID（UUID 去除連字號） |
| `ownerId` | `number` | 隊長的使用者 ID |
| `name` | `string` | 隊伍名稱（不可為空） |
| `state` | `"active"` | 隊伍狀態（目前僅有 `active`） |
| `members` | `number[]` | 成員使用者 ID 列表（必包含隊長） |
| `createdAt` | `Date` | 建立時間 |
| `updatedAt` | `Date` | 最後更新時間 |

### InvitationDoc（邀請文件）

儲存於 MongoDB 集合 `group_invitations`。

| 欄位 | 類型 | 說明 |
|------|------|------|
| `_id` | `string` | 邀請唯一 ID |
| `teamId` | `string` | 目標隊伍 ID |
| `inviterId` | `number` | 邀請者（隊長）使用者 ID |
| `inviteeId` | `number` | 被邀請者使用者 ID |
| `status` | `string` | 邀請狀態（見下表） |
| `createdAt` | `Date` | 建立時間 |
| `updatedAt` | `Date` | 最後更新時間 |

**邀請狀態（`INVITATION_STATUS`）：**

| 值 | 說明 |
|----|------|
| `pending` | 等待回應 |
| `accepted` | 已接受 |
| `declined` | 已拒絕 |
| `canceled` | 已取消 |

### ContestEntryDoc（競賽報名文件）

儲存於 MongoDB 集合 `group_contest_entries`。

| 欄位 | 類型 | 說明 |
|------|------|------|
| `contestId` | `string` | 競賽 ID |
| `teamId` | `string` | 隊伍 ID |
| `identity` | `Identity` | 身分識別物件（見下方） |
| `participants` | `number[]` | 展開後的所有參賽者使用者 ID |
| `updatedAt` | `Date` | 最後更新時間 |

---

## HTTP API 使用說明

所有路由均需使用者已登入（需具備 `PRIV_USER_PROFILE` 權限）。  
請求與回應皆為 JSON 格式。

---

### 建立隊伍

```
POST /group/team/create
```

**請求參數（Body 或 URL 路徑參數）：**

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `name` | `string` | ✅ | 隊伍名稱（不可為空白） |

**範例請求：**

```http
POST /group/team/create
Content-Type: application/json

{
  "name": "熱血戰隊"
}
```

**成功回應（200）：**

```json
{
  "team": {
    "_id": "a1b2c3d4e5f6...",
    "ownerId": 1001,
    "name": "熱血戰隊",
    "state": "active",
    "members": [1001],
    "createdAt": "2026-04-20T10:00:00.000Z",
    "updatedAt": "2026-04-20T10:00:00.000Z"
  }
}
```

**錯誤情境：**

| 情境 | 回應 |
|------|------|
| `name` 為空 | `400 BadRequestError: name is required` |

---

### 邀請成員

隊長邀請其他使用者加入隊伍。

```
POST /group/team/:teamId/invite
```

**URL 路徑參數：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `teamId` | `string` | 目標隊伍 ID |

**請求參數（Body）：**

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `inviteeId` | `number` | ✅ | 被邀請者的使用者 ID（正整數） |

**範例請求：**

```http
POST /group/team/a1b2c3d4e5f6/invite
Content-Type: application/json

{
  "inviteeId": 1002
}
```

**成功回應（200）：**

```json
{
  "invitation": {
    "_id": "f7e8d9c0b1a2...",
    "teamId": "a1b2c3d4e5f6",
    "inviterId": 1001,
    "inviteeId": 1002,
    "status": "pending",
    "createdAt": "2026-04-20T10:05:00.000Z",
    "updatedAt": "2026-04-20T10:05:00.000Z"
  }
}
```

**錯誤情境：**

| 情境 | 回應 |
|------|------|
| 隊伍不存在 | `404 NotFoundError` |
| 發起者不是隊長 | `403 PermissionError: No permission to invite` |
| 被邀請者已是成員 | `403 PermissionError: No permission to invite` |
| 已有待處理邀請 | `400 BadRequestError: Invitation already pending` |
| `inviteeId` 非正整數 | `400 BadRequestError: inviteeId must be a valid positive integer` |

---

### 回應邀請

被邀請者接受或拒絕邀請。

```
POST /group/invitation/:invitationId/respond
```

**URL 路徑參數：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `invitationId` | `string` | 邀請 ID |

**請求參數（Body）：**

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `accept` | `boolean \| "true" \| "false" \| 0 \| 1` | 否 | `true` 接受，其他值視為拒絕 |

**範例請求（接受）：**

```http
POST /group/invitation/f7e8d9c0b1a2/respond
Content-Type: application/json

{
  "accept": true
}
```

**範例請求（拒絕）：**

```http
POST /group/invitation/f7e8d9c0b1a2/respond
Content-Type: application/json

{
  "accept": false
}
```

**成功回應（200）：**

```json
{
  "invitation": {
    "_id": "f7e8d9c0b1a2...",
    "teamId": "a1b2c3d4e5f6",
    "inviterId": 1001,
    "inviteeId": 1002,
    "status": "accepted",
    "createdAt": "2026-04-20T10:05:00.000Z",
    "updatedAt": "2026-04-20T10:10:00.000Z"
  }
}
```

> 當 `accept` 為 `true` 時，被邀請者會自動加入隊伍的 `members` 列表。

**錯誤情境：**

| 情境 | 回應 |
|------|------|
| 邀請不存在 | `404 NotFoundError` |
| 邀請狀態非 `pending` | `Error: Invitation is not pending` |
| 回應者不是被邀請者 | `Error: Only invitee can respond` |

---

### 以隊伍身分報名競賽

隊伍成員以隊伍身分報名指定競賽，所有隊員皆列為參賽者。

```
POST /group/contest/:contestId/team/:teamId/register
```

**URL 路徑參數：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `contestId` | `string` | 競賽 ID |
| `teamId` | `string` | 隊伍 ID |

**範例請求：**

```http
POST /group/contest/contest-2026-spring/team/a1b2c3d4e5f6/register
```

**成功回應（200）：**

```json
{
  "entry": {
    "contestId": "contest-2026-spring",
    "teamId": "a1b2c3d4e5f6",
    "identity": {
      "kind": "team",
      "id": "a1b2c3d4e5f6",
      "ownerId": 1001,
      "memberIds": [1001, 1002]
    },
    "participants": [1001, 1002],
    "updatedAt": "2026-04-20T10:15:00.000Z"
  }
}
```

**錯誤情境：**

| 情境 | 回應 |
|------|------|
| 隊伍不存在 | `404 NotFoundError` |
| 操作者不是隊伍成員 | `403 PermissionError: Not a team member` |

---

## 程式模型 API

外掛啟動後，可透過 `global.Hydro.model.group` 在 HydroOJ 內部直接呼叫以下函式：

```ts
import { groupModel } from 'hydrooj-group';
// 或在 Hydro 外掛環境中：
const group = Hydro.model.group;
```

### `createTeam(ownerId, name)`

建立新隊伍。

```ts
const team = await group.createTeam(1001, '熱血戰隊');
```

### `inviteMember(teamId, inviterId, inviteeId)`

邀請成員加入隊伍（僅隊長可呼叫）。

```ts
const invitation = await group.inviteMember('a1b2c3d4', 1001, 1002);
```

### `respondInvitation(invitationId, userId, accept)`

被邀請者接受或拒絕邀請。

```ts
// 接受
const result = await group.respondInvitation('f7e8d9c0', 1002, true);
// 拒絕
const result = await group.respondInvitation('f7e8d9c0', 1002, false);
```

### `registerContestAsTeam(contestId, teamId, operatorId)`

以隊伍身分報名競賽。

```ts
const entry = await group.registerContestAsTeam('contest-2026', 'a1b2c3d4', 1001);
```

### `getTeamIdentity(teamId)`

取得隊伍的 `TeamIdentity` 物件。

```ts
const identity = await group.getTeamIdentity('a1b2c3d4');
```

### `getUserIdentity(userId)`

取得個人使用者的 `UserIdentity` 物件。

```ts
const identity = group.getUserIdentity(1001);
```

### `resolveIdentity(identity)`

將 `Identity`（隊伍或個人）展開為參賽者使用者 ID 陣列（去重）。

```ts
const userIds = group.resolveIdentity(identity);
// 例如：[1001, 1002]
```

---

## 身分識別抽象層

本外掛定義了 `Identity` 聯集型別，讓競賽邏輯能以一致的方式處理個人與隊伍：

```ts
type Identity = TeamIdentity | UserIdentity;
```

| 欄位 | TeamIdentity | UserIdentity |
|------|-------------|--------------|
| `kind` | `"team"` | `"user"` |
| `id` | 隊伍 ID (`string`) | 使用者 ID (`number`) |
| `ownerId` | 隊長使用者 ID | 使用者 ID |
| `memberIds` | 所有成員 ID 陣列 | 單一使用者 ID 陣列 |

**使用範例：**

```ts
import { resolveIdentity, createTeamIdentity, createUserIdentity } from 'hydrooj-group';

// 隊伍身分
const teamIdentity = createTeamIdentity(team);
const participants = resolveIdentity(teamIdentity); // [1001, 1002, ...]

// 個人身分（向下相容既有流程）
const userIdentity = createUserIdentity(1001);
const participants = resolveIdentity(userIdentity); // [1001]
```

競賽相關邏輯只需呼叫 `resolveIdentity(identity)`，即可取得具體的參賽者 ID 列表，無需關心是個人還是隊伍報名。

---

## MongoDB 集合說明

| 集合名稱 | 說明 |
|----------|------|
| `group_teams` | 儲存所有隊伍文件 |
| `group_invitations` | 儲存所有邀請記錄 |
| `group_contest_entries` | 儲存隊伍競賽報名記錄（以 `contestId + teamId` 為 upsert 鍵） |

---

## 開發與建置

**環境需求：**
- Node.js ≥ 18
- TypeScript ≥ 6

**安裝相依套件：**

```bash
npm install
```

**編譯 TypeScript：**

```bash
npm run build
```

**執行測試：**

```bash
npm test
```

> 測試指令會先編譯，再以 Node.js 內建測試框架執行 `dist/test/**/*.test.js`。

---

## 授權條款

MIT License
