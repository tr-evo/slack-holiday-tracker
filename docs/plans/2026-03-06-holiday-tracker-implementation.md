# Holiday Tracker Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Slack bot that lets a team request, approve, and track holiday allowances with half-day support and English/German i18n.

**Architecture:** Node.js/TypeScript app using Slack Bolt in Socket Mode (outbound websocket, no HTTP server). SQLite for persistence via better-sqlite3. Dockerized for deployment on IONOS VM.

**Tech Stack:** TypeScript, @slack/bolt, better-sqlite3, vitest (testing), tsx (dev runner), Docker

**Design doc:** `docs/plans/2026-03-06-holiday-tracker-bot-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/app.ts` (entry point stub)
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize project and install dependencies**

Run:
```bash
npm init -y
npm install @slack/bolt better-sqlite3 dotenv
npm install -D typescript @types/node @types/better-sqlite3 vitest tsx
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
*.db
.env
```

**Step 4: Create .env.example**

```
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token
SLACK_SIGNING_SECRET=your-signing-secret
DB_PATH=./data/holidays.db
DEFAULT_ALLOWANCE=30
```

**Step 5: Create src/app.ts stub**

```typescript
import { App } from "@slack/bolt";
import "dotenv/config";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

(async () => {
  await app.start();
  console.log("Holiday Tracker bot is running!");
})();
```

**Step 6: Add scripts to package.json**

Add to `package.json` scripts:
```json
{
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with TypeScript, Bolt, SQLite"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/connection.ts`
- Create: `src/db/seed.ts`
- Test: `src/db/__tests__/schema.test.ts`

**Step 1: Write the failing test**

Create `src/db/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../schema.js";

describe("database schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  it("creates users table", () => {
    const info = db.prepare("PRAGMA table_info(users)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("slack_id");
    expect(columns).toContain("name");
    expect(columns).toContain("annual_allowance");
    expect(columns).toContain("language");
    expect(columns).toContain("is_admin");
  });

  it("creates holiday_requests table", () => {
    const info = db.prepare("PRAGMA table_info(holiday_requests)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("id");
    expect(columns).toContain("user_id");
    expect(columns).toContain("start_date");
    expect(columns).toContain("end_date");
    expect(columns).toContain("half_day_start");
    expect(columns).toContain("half_day_end");
    expect(columns).toContain("status");
    expect(columns).toContain("approved_by");
    expect(columns).toContain("reason");
    expect(columns).toContain("reviewer_comment");
    expect(columns).toContain("created_at");
  });

  it("creates public_holidays table", () => {
    const info = db.prepare("PRAGMA table_info(public_holidays)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("date");
    expect(columns).toContain("name");
    expect(columns).toContain("name_de");
  });

  it("creates settings table", () => {
    const info = db.prepare("PRAGMA table_info(settings)").all();
    const columns = info.map((col: any) => col.name);
    expect(columns).toContain("key");
    expect(columns).toContain("value");
  });

  it("inserts default settings", () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("default_allowance") as any;
    expect(row.value).toBe("30");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/schema.test.ts`
Expected: FAIL — cannot find module `../schema.js`

**Step 3: Write schema implementation**

Create `src/db/schema.ts`:

```typescript
import Database from "better-sqlite3";

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      slack_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      annual_allowance INTEGER NOT NULL DEFAULT 30,
      language TEXT NOT NULL DEFAULT 'en',
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS holiday_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(slack_id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      half_day_start INTEGER NOT NULL DEFAULT 0,
      half_day_end INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT,
      reason TEXT,
      reviewer_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS public_holidays (
      date TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_de TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('default_allowance', '30');
  `);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/schema.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Write connection module**

Create `src/db/connection.ts`:

```typescript
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { initializeSchema } from "./schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || "./data/holidays.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  return db;
}

export function getTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initializeSchema(testDb);
  return testDb;
}
```

**Step 6: Commit**

```bash
git add src/db/
git commit -m "feat: database schema and connection layer"
```

---

### Task 3: Internationalization (i18n)

**Files:**
- Create: `src/i18n/en.json`
- Create: `src/i18n/de.json`
- Create: `src/i18n/t.ts`
- Test: `src/i18n/__tests__/t.test.ts`

**Step 1: Write the failing test**

Create `src/i18n/__tests__/t.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { t } from "../t.js";

describe("i18n", () => {
  it("returns English text by default", () => {
    expect(t("balance.title", "en")).toBe("Holiday Balance");
  });

  it("returns German text when language is de", () => {
    expect(t("balance.title", "de")).toBe("Urlaubskonto");
  });

  it("supports interpolation", () => {
    expect(t("balance.remaining", "en", { days: "15" })).toBe("You have 15 days remaining");
  });

  it("falls back to English for missing German keys", () => {
    // If a key exists in English but not German, return English
    expect(t("__test_only_en__", "de")).toBe(t("__test_only_en__", "en"));
  });

  it("returns the key itself if not found in any language", () => {
    expect(t("nonexistent.key", "en")).toBe("nonexistent.key");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/i18n/__tests__/t.test.ts`
Expected: FAIL

**Step 3: Create translation files**

Create `src/i18n/en.json`:

```json
{
  "balance.title": "Holiday Balance",
  "balance.remaining": "You have {days} days remaining",
  "balance.used": "Used: {days} days",
  "balance.total": "Total allowance: {days} days",
  "request.title": "Request Holiday",
  "request.start_date": "Start Date",
  "request.end_date": "End Date",
  "request.half_day_start": "Half day (start)",
  "request.half_day_end": "Half day (end)",
  "request.reason": "Reason (optional)",
  "request.submit": "Submit Request",
  "request.submitted": "Your holiday request has been submitted for approval",
  "request.invalid_dates": "End date must be on or after start date",
  "request.insufficient_days": "You don't have enough remaining days ({remaining} available, {requested} requested)",
  "approval.new_request": "New holiday request from {name}",
  "approval.dates": "{start} to {end}",
  "approval.days": "{count} day(s)",
  "approval.approve": "Approve",
  "approval.reject": "Reject",
  "approval.approved": "Your holiday request ({start} to {end}) has been approved",
  "approval.rejected": "Your holiday request ({start} to {end}) has been rejected",
  "approval.comment": "Comment: {comment}",
  "list.title": "Your Holiday Requests",
  "list.empty": "You have no holiday requests",
  "list.status.pending": "Pending",
  "list.status.approved": "Approved",
  "list.status.rejected": "Rejected",
  "menu.title": "Holiday Tracker",
  "menu.request": "Request Holiday",
  "menu.balance": "View Balance",
  "menu.list": "My Requests",
  "menu.admin": "Admin Panel",
  "menu.language": "Language",
  "admin.title": "Admin Panel",
  "admin.set_allowance": "Set Allowance",
  "admin.toggle_admin": "Toggle Admin",
  "admin.pending_requests": "Pending Requests",
  "admin.not_admin": "You don't have admin permissions",
  "language.changed": "Language changed to English",
  "error.generic": "Something went wrong. Please try again.",
  "__test_only_en__": "test"
}
```

Create `src/i18n/de.json`:

```json
{
  "balance.title": "Urlaubskonto",
  "balance.remaining": "Du hast noch {days} Tage übrig",
  "balance.used": "Genommen: {days} Tage",
  "balance.total": "Jahresurlaub: {days} Tage",
  "request.title": "Urlaub beantragen",
  "request.start_date": "Startdatum",
  "request.end_date": "Enddatum",
  "request.half_day_start": "Halber Tag (Anfang)",
  "request.half_day_end": "Halber Tag (Ende)",
  "request.reason": "Grund (optional)",
  "request.submit": "Antrag absenden",
  "request.submitted": "Dein Urlaubsantrag wurde zur Genehmigung eingereicht",
  "request.invalid_dates": "Das Enddatum muss gleich oder nach dem Startdatum liegen",
  "request.insufficient_days": "Du hast nicht genug Resturlaub ({remaining} verfügbar, {requested} beantragt)",
  "approval.new_request": "Neuer Urlaubsantrag von {name}",
  "approval.dates": "{start} bis {end}",
  "approval.days": "{count} Tag(e)",
  "approval.approve": "Genehmigen",
  "approval.reject": "Ablehnen",
  "approval.approved": "Dein Urlaubsantrag ({start} bis {end}) wurde genehmigt",
  "approval.rejected": "Dein Urlaubsantrag ({start} bis {end}) wurde abgelehnt",
  "approval.comment": "Kommentar: {comment}",
  "list.title": "Deine Urlaubsanträge",
  "list.empty": "Du hast keine Urlaubsanträge",
  "list.status.pending": "Ausstehend",
  "list.status.approved": "Genehmigt",
  "list.status.rejected": "Abgelehnt",
  "menu.title": "Urlaubstracker",
  "menu.request": "Urlaub beantragen",
  "menu.balance": "Urlaubskonto",
  "menu.list": "Meine Anträge",
  "menu.admin": "Admin-Bereich",
  "menu.language": "Sprache",
  "admin.title": "Admin-Bereich",
  "admin.set_allowance": "Urlaubstage festlegen",
  "admin.toggle_admin": "Admin umschalten",
  "admin.pending_requests": "Offene Anträge",
  "admin.not_admin": "Du hast keine Admin-Berechtigungen",
  "language.changed": "Sprache auf Deutsch geändert",
  "error.generic": "Etwas ist schiefgelaufen. Bitte versuche es erneut."
}
```

**Step 4: Write i18n function**

Create `src/i18n/t.ts`:

```typescript
import en from "./en.json" with { type: "json" };
import de from "./de.json" with { type: "json" };

const translations: Record<string, Record<string, string>> = { en, de };

export function t(
  key: string,
  lang: string = "en",
  params?: Record<string, string>
): string {
  let text = translations[lang]?.[key] ?? translations["en"]?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, v);
    }
  }

  return text;
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/i18n/__tests__/t.test.ts`
Expected: PASS (all 5 tests)

**Step 6: Commit**

```bash
git add src/i18n/
git commit -m "feat: i18n system with English and German translations"
```

---

### Task 4: User Repository

**Files:**
- Create: `src/db/repositories/userRepo.ts`
- Test: `src/db/repositories/__tests__/userRepo.test.ts`

**Step 1: Write the failing test**

Create `src/db/repositories/__tests__/userRepo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createUserRepo, UserRepo } from "../userRepo.js";

describe("userRepo", () => {
  let db: Database.Database;
  let repo: UserRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    repo = createUserRepo(db);
  });

  it("creates and finds a user", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    const user = repo.findById("U123");
    expect(user).toMatchObject({
      slackId: "U123",
      name: "Alice",
      annualAllowance: 30,
      language: "en",
      isAdmin: false,
    });
  });

  it("updates existing user on upsert", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.upsert({ slackId: "U123", name: "Alice Updated" });
    const user = repo.findById("U123");
    expect(user?.name).toBe("Alice Updated");
  });

  it("sets admin status", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setAdmin("U123", true);
    expect(repo.findById("U123")?.isAdmin).toBe(true);
  });

  it("sets annual allowance", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setAllowance("U123", 25);
    expect(repo.findById("U123")?.annualAllowance).toBe(25);
  });

  it("sets language", () => {
    repo.upsert({ slackId: "U123", name: "Alice" });
    repo.setLanguage("U123", "de");
    expect(repo.findById("U123")?.language).toBe("de");
  });

  it("returns all admins", () => {
    repo.upsert({ slackId: "U1", name: "Alice" });
    repo.upsert({ slackId: "U2", name: "Bob" });
    repo.setAdmin("U1", true);
    const admins = repo.getAdmins();
    expect(admins).toHaveLength(1);
    expect(admins[0].slackId).toBe("U1");
  });

  it("returns null for non-existent user", () => {
    expect(repo.findById("NONEXISTENT")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repositories/__tests__/userRepo.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/db/repositories/userRepo.ts`:

```typescript
import Database from "better-sqlite3";

export interface User {
  slackId: string;
  name: string;
  annualAllowance: number;
  language: string;
  isAdmin: boolean;
}

export interface UserRepo {
  upsert(user: { slackId: string; name: string }): void;
  findById(slackId: string): User | null;
  setAdmin(slackId: string, isAdmin: boolean): void;
  setAllowance(slackId: string, allowance: number): void;
  setLanguage(slackId: string, language: string): void;
  getAdmins(): User[];
  getAll(): User[];
}

function rowToUser(row: any): User {
  return {
    slackId: row.slack_id,
    name: row.name,
    annualAllowance: row.annual_allowance,
    language: row.language,
    isAdmin: Boolean(row.is_admin),
  };
}

export function createUserRepo(db: Database.Database): UserRepo {
  return {
    upsert({ slackId, name }) {
      db.prepare(
        `INSERT INTO users (slack_id, name) VALUES (?, ?)
         ON CONFLICT(slack_id) DO UPDATE SET name = excluded.name`
      ).run(slackId, name);
    },

    findById(slackId) {
      const row = db.prepare("SELECT * FROM users WHERE slack_id = ?").get(slackId);
      return row ? rowToUser(row) : null;
    },

    setAdmin(slackId, isAdmin) {
      db.prepare("UPDATE users SET is_admin = ? WHERE slack_id = ?").run(isAdmin ? 1 : 0, slackId);
    },

    setAllowance(slackId, allowance) {
      db.prepare("UPDATE users SET annual_allowance = ? WHERE slack_id = ?").run(allowance, slackId);
    },

    setLanguage(slackId, language) {
      db.prepare("UPDATE users SET language = ? WHERE slack_id = ?").run(language, slackId);
    },

    getAdmins() {
      return db.prepare("SELECT * FROM users WHERE is_admin = 1").all().map(rowToUser);
    },

    getAll() {
      return db.prepare("SELECT * FROM users").all().map(rowToUser);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repositories/__tests__/userRepo.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add src/db/repositories/
git commit -m "feat: user repository with CRUD operations"
```

---

### Task 5: Holiday Request Repository

**Files:**
- Create: `src/db/repositories/requestRepo.ts`
- Test: `src/db/repositories/__tests__/requestRepo.test.ts`

**Step 1: Write the failing test**

Create `src/db/repositories/__tests__/requestRepo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createRequestRepo, RequestRepo } from "../requestRepo.js";

describe("requestRepo", () => {
  let db: Database.Database;
  let repo: RequestRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    // Insert a test user first
    db.prepare("INSERT INTO users (slack_id, name) VALUES (?, ?)").run("U123", "Alice");
    repo = createRequestRepo(db);
  });

  it("creates a request and returns its id", () => {
    const id = repo.create({
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: false,
      halfDayEnd: false,
      reason: "Family trip",
    });
    expect(id).toBeGreaterThan(0);
  });

  it("finds a request by id", () => {
    const id = repo.create({
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: true,
      halfDayEnd: false,
      reason: null,
    });
    const req = repo.findById(id);
    expect(req).toMatchObject({
      id,
      userId: "U123",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      halfDayStart: true,
      halfDayEnd: false,
      status: "pending",
    });
  });

  it("lists requests for a user", () => {
    repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.create({ userId: "U123", startDate: "2026-05-01", endDate: "2026-05-02", halfDayStart: false, halfDayEnd: false, reason: null });
    const list = repo.listByUser("U123");
    expect(list).toHaveLength(2);
  });

  it("approves a request", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", "Enjoy!");
    const req = repo.findById(id);
    expect(req?.status).toBe("approved");
    expect(req?.approvedBy).toBe("ADMIN1");
    expect(req?.reviewerComment).toBe("Enjoy!");
  });

  it("rejects a request", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.reject(id, "ADMIN1", "Too busy");
    const req = repo.findById(id);
    expect(req?.status).toBe("rejected");
    expect(req?.reviewerComment).toBe("Too busy");
  });

  it("gets all pending requests", () => {
    const id1 = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.create({ userId: "U123", startDate: "2026-05-01", endDate: "2026-05-02", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id1, "ADMIN1", null);
    const pending = repo.getPending();
    expect(pending).toHaveLength(1);
  });

  it("gets approved requests for a user in a date range", () => {
    const id = repo.create({ userId: "U123", startDate: "2026-04-01", endDate: "2026-04-03", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id, "ADMIN1", null);
    // Request outside range
    const id2 = repo.create({ userId: "U123", startDate: "2026-07-01", endDate: "2026-07-05", halfDayStart: false, halfDayEnd: false, reason: null });
    repo.approve(id2, "ADMIN1", null);

    const approved = repo.getApprovedForUserInYear("U123", 2026);
    expect(approved).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repositories/__tests__/requestRepo.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/db/repositories/requestRepo.ts`:

```typescript
import Database from "better-sqlite3";

export interface HolidayRequest {
  id: number;
  userId: string;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  status: string;
  approvedBy: string | null;
  reason: string | null;
  reviewerComment: string | null;
  createdAt: string;
}

export interface CreateRequest {
  userId: string;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  reason: string | null;
}

export interface RequestRepo {
  create(req: CreateRequest): number;
  findById(id: number): HolidayRequest | null;
  listByUser(userId: string): HolidayRequest[];
  approve(id: number, approvedBy: string, comment: string | null): void;
  reject(id: number, rejectedBy: string, comment: string | null): void;
  getPending(): HolidayRequest[];
  getApprovedForUserInYear(userId: string, year: number): HolidayRequest[];
}

function rowToRequest(row: any): HolidayRequest {
  return {
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    halfDayStart: Boolean(row.half_day_start),
    halfDayEnd: Boolean(row.half_day_end),
    status: row.status,
    approvedBy: row.approved_by,
    reason: row.reason,
    reviewerComment: row.reviewer_comment,
    createdAt: row.created_at,
  };
}

export function createRequestRepo(db: Database.Database): RequestRepo {
  return {
    create(req) {
      const result = db.prepare(
        `INSERT INTO holiday_requests (user_id, start_date, end_date, half_day_start, half_day_end, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(req.userId, req.startDate, req.endDate, req.halfDayStart ? 1 : 0, req.halfDayEnd ? 1 : 0, req.reason);
      return Number(result.lastInsertRowid);
    },

    findById(id) {
      const row = db.prepare("SELECT * FROM holiday_requests WHERE id = ?").get(id);
      return row ? rowToRequest(row) : null;
    },

    listByUser(userId) {
      return db.prepare("SELECT * FROM holiday_requests WHERE user_id = ? ORDER BY start_date DESC").all(userId).map(rowToRequest);
    },

    approve(id, approvedBy, comment) {
      db.prepare("UPDATE holiday_requests SET status = 'approved', approved_by = ?, reviewer_comment = ? WHERE id = ?")
        .run(approvedBy, comment, id);
    },

    reject(id, rejectedBy, comment) {
      db.prepare("UPDATE holiday_requests SET status = 'rejected', approved_by = ?, reviewer_comment = ? WHERE id = ?")
        .run(rejectedBy, comment, id);
    },

    getPending() {
      return db.prepare("SELECT * FROM holiday_requests WHERE status = 'pending' ORDER BY created_at ASC").all().map(rowToRequest);
    },

    getApprovedForUserInYear(userId, year) {
      return db.prepare(
        `SELECT * FROM holiday_requests
         WHERE user_id = ? AND status = 'approved'
         AND strftime('%Y', start_date) = ?
         ORDER BY start_date ASC`
      ).all(userId, String(year)).map(rowToRequest);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repositories/__tests__/requestRepo.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add src/db/repositories/requestRepo.ts src/db/repositories/__tests__/requestRepo.test.ts
git commit -m "feat: holiday request repository"
```

---

### Task 6: Allowance Calculation Service

This is the core business logic — calculate how many days a request uses, and how many remain.

**Files:**
- Create: `src/services/allowance.ts`
- Test: `src/services/__tests__/allowance.test.ts`

**Step 1: Write the failing test**

Create `src/services/__tests__/allowance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { countBusinessDays, calculateRequestDays, calculateRemainingDays } from "../allowance.js";

describe("countBusinessDays", () => {
  it("counts weekdays only", () => {
    // Mon 2026-03-09 to Fri 2026-03-13 = 5 days
    expect(countBusinessDays("2026-03-09", "2026-03-13", [])).toBe(5);
  });

  it("excludes weekends", () => {
    // Mon 2026-03-09 to Sun 2026-03-15 = 5 weekdays
    expect(countBusinessDays("2026-03-09", "2026-03-15", [])).toBe(5);
  });

  it("handles single day (weekday)", () => {
    expect(countBusinessDays("2026-03-09", "2026-03-09", [])).toBe(1);
  });

  it("handles single day (weekend)", () => {
    expect(countBusinessDays("2026-03-14", "2026-03-14", [])).toBe(0);
    // 2026-03-14 is a Saturday
  });

  it("excludes public holidays", () => {
    // Mon-Fri but Wednesday is a public holiday
    expect(countBusinessDays("2026-03-09", "2026-03-13", ["2026-03-11"])).toBe(4);
  });

  it("handles two full weeks", () => {
    // Mon 2026-03-09 to Fri 2026-03-20 = 10 weekdays
    expect(countBusinessDays("2026-03-09", "2026-03-20", [])).toBe(10);
  });
});

describe("calculateRequestDays", () => {
  it("full days, no half days", () => {
    // Mon-Fri = 5 days
    expect(calculateRequestDays("2026-03-09", "2026-03-13", false, false, [])).toBe(5);
  });

  it("half day start", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", true, false, [])).toBe(4.5);
  });

  it("half day end", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", false, true, [])).toBe(4.5);
  });

  it("both half days", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-13", true, true, [])).toBe(4);
  });

  it("single day with half day start", () => {
    expect(calculateRequestDays("2026-03-09", "2026-03-09", true, false, [])).toBe(0.5);
  });

  it("returns 0 for weekend-only range", () => {
    expect(calculateRequestDays("2026-03-14", "2026-03-15", false, false, [])).toBe(0);
  });
});

describe("calculateRemainingDays", () => {
  it("subtracts approved request days from allowance", () => {
    const approvedRequests = [
      { startDate: "2026-03-09", endDate: "2026-03-13", halfDayStart: false, halfDayEnd: false },
      { startDate: "2026-04-06", endDate: "2026-04-08", halfDayStart: true, halfDayEnd: false },
    ];
    // 5 days + 2.5 days = 7.5 days used
    const remaining = calculateRemainingDays(30, approvedRequests, []);
    expect(remaining).toBe(22.5);
  });

  it("returns full allowance with no requests", () => {
    expect(calculateRemainingDays(30, [], [])).toBe(30);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/allowance.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/services/allowance.ts`:

```typescript
export function countBusinessDays(
  startDate: string,
  endDate: string,
  publicHolidays: string[]
): number {
  const holidaySet = new Set(publicHolidays);
  let count = 0;
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

  while (current <= end) {
    const day = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

export function calculateRequestDays(
  startDate: string,
  endDate: string,
  halfDayStart: boolean,
  halfDayEnd: boolean,
  publicHolidays: string[]
): number {
  let days = countBusinessDays(startDate, endDate, publicHolidays);
  if (halfDayStart && days > 0) days -= 0.5;
  if (halfDayEnd && days > 0) days -= 0.5;
  return Math.max(0, days);
}

interface ApprovedRequest {
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
}

export function calculateRemainingDays(
  annualAllowance: number,
  approvedRequests: ApprovedRequest[],
  publicHolidays: string[]
): number {
  let used = 0;
  for (const req of approvedRequests) {
    used += calculateRequestDays(
      req.startDate,
      req.endDate,
      req.halfDayStart,
      req.halfDayEnd,
      publicHolidays
    );
  }
  return annualAllowance - used;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/allowance.test.ts`
Expected: PASS (all 12 tests)

**Step 5: Commit**

```bash
git add src/services/
git commit -m "feat: allowance calculation service with half-day and public holiday support"
```

---

### Task 7: Public Holiday Repository

**Files:**
- Create: `src/db/repositories/publicHolidayRepo.ts`
- Test: `src/db/repositories/__tests__/publicHolidayRepo.test.ts`

**Step 1: Write the failing test**

Create `src/db/repositories/__tests__/publicHolidayRepo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../schema.js";
import { createPublicHolidayRepo, PublicHolidayRepo } from "../publicHolidayRepo.js";

describe("publicHolidayRepo", () => {
  let db: Database.Database;
  let repo: PublicHolidayRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    repo = createPublicHolidayRepo(db);
  });

  it("adds and retrieves a public holiday", () => {
    repo.add({ date: "2026-12-25", name: "Christmas Day", nameDe: "Weihnachtstag" });
    const holidays = repo.getForYear(2026);
    expect(holidays).toHaveLength(1);
    expect(holidays[0]).toMatchObject({ date: "2026-12-25", name: "Christmas Day", nameDe: "Weihnachtstag" });
  });

  it("returns dates only for a year", () => {
    repo.add({ date: "2026-01-01", name: "New Year", nameDe: "Neujahr" });
    repo.add({ date: "2026-12-25", name: "Christmas", nameDe: "Weihnachten" });
    repo.add({ date: "2027-01-01", name: "New Year", nameDe: "Neujahr" });
    const dates = repo.getDatesForYear(2026);
    expect(dates).toEqual(["2026-01-01", "2026-12-25"]);
  });

  it("removes a public holiday", () => {
    repo.add({ date: "2026-12-25", name: "Christmas", nameDe: "Weihnachten" });
    repo.remove("2026-12-25");
    expect(repo.getForYear(2026)).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/repositories/__tests__/publicHolidayRepo.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/db/repositories/publicHolidayRepo.ts`:

```typescript
import Database from "better-sqlite3";

export interface PublicHoliday {
  date: string;
  name: string;
  nameDe: string;
}

export interface PublicHolidayRepo {
  add(holiday: PublicHoliday): void;
  remove(date: string): void;
  getForYear(year: number): PublicHoliday[];
  getDatesForYear(year: number): string[];
}

export function createPublicHolidayRepo(db: Database.Database): PublicHolidayRepo {
  return {
    add(holiday) {
      db.prepare(
        "INSERT OR REPLACE INTO public_holidays (date, name, name_de) VALUES (?, ?, ?)"
      ).run(holiday.date, holiday.name, holiday.nameDe);
    },

    remove(date) {
      db.prepare("DELETE FROM public_holidays WHERE date = ?").run(date);
    },

    getForYear(year) {
      return db.prepare(
        "SELECT * FROM public_holidays WHERE strftime('%Y', date) = ? ORDER BY date"
      ).all(String(year)).map((row: any) => ({
        date: row.date,
        name: row.name,
        nameDe: row.name_de,
      }));
    },

    getDatesForYear(year) {
      return db.prepare(
        "SELECT date FROM public_holidays WHERE strftime('%Y', date) = ? ORDER BY date"
      ).all(String(year)).map((row: any) => row.date);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/repositories/__tests__/publicHolidayRepo.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add src/db/repositories/publicHolidayRepo.ts src/db/repositories/__tests__/publicHolidayRepo.test.ts
git commit -m "feat: public holiday repository"
```

---

### Task 8: Slash Command Handler and Main Menu Modal

**Files:**
- Create: `src/handlers/holiday.ts`
- Create: `src/modals/mainMenu.ts`
- Modify: `src/app.ts`

**Step 1: Create main menu modal builder**

Create `src/modals/mainMenu.ts`:

```typescript
import { t } from "../i18n/t.js";

export function buildMainMenuModal(lang: string, isAdmin: boolean) {
  const buttons: any[] = [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.request", lang) },
          action_id: "open_request_modal",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.balance", lang) },
          action_id: "show_balance",
        },
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.list", lang) },
          action_id: "show_list",
        },
      ],
    },
  ];

  if (isAdmin) {
    buttons.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: t("menu.admin", lang) },
          action_id: "open_admin_panel",
        },
      ],
    });
  }

  buttons.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: `${t("menu.language", lang)}: ${lang === "en" ? "Deutsch" : "English"}` },
        action_id: "toggle_language",
      },
    ],
  });

  return {
    type: "modal" as const,
    title: { type: "plain_text" as const, text: t("menu.title", lang) },
    close: { type: "plain_text" as const, text: "Close" },
    blocks: buttons,
  };
}
```

**Step 2: Create holiday request modal builder**

Create `src/modals/requestModal.ts`:

```typescript
import { t } from "../i18n/t.js";

export function buildRequestModal(lang: string) {
  return {
    type: "modal" as const,
    callback_id: "submit_holiday_request",
    title: { type: "plain_text" as const, text: t("request.title", lang) },
    submit: { type: "plain_text" as const, text: t("request.submit", lang) },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "start_date_block",
        element: {
          type: "datepicker",
          action_id: "start_date",
          placeholder: { type: "plain_text", text: t("request.start_date", lang) },
        },
        label: { type: "plain_text", text: t("request.start_date", lang) },
      },
      {
        type: "input",
        block_id: "end_date_block",
        element: {
          type: "datepicker",
          action_id: "end_date",
        },
        label: { type: "plain_text", text: t("request.end_date", lang) },
      },
      {
        type: "actions",
        block_id: "half_days_block",
        elements: [
          {
            type: "checkboxes",
            action_id: "half_days",
            options: [
              {
                text: { type: "plain_text", text: t("request.half_day_start", lang) },
                value: "half_day_start",
              },
              {
                text: { type: "plain_text", text: t("request.half_day_end", lang) },
                value: "half_day_end",
              },
            ],
          },
        ],
      },
      {
        type: "input",
        block_id: "reason_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "reason",
          multiline: true,
          placeholder: { type: "plain_text", text: t("request.reason", lang) },
        },
        label: { type: "plain_text", text: t("request.reason", lang) },
      },
    ],
  };
}
```

**Step 3: Create slash command handler**

Create `src/handlers/holiday.ts`:

```typescript
import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { t } from "../i18n/t.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRemainingDays, calculateRequestDays } from "../services/allowance.js";

function ensureUser(slackId: string, name: string) {
  const db = getDb();
  const userRepo = createUserRepo(db);
  userRepo.upsert({ slackId, name });
  return userRepo.findById(slackId)!;
}

export function registerHolidayHandlers(app: App) {
  // Main slash command
  app.command("/holiday", async ({ command, ack, client }) => {
    await ack();
    const subcommand = command.text.trim().toLowerCase();
    const user = ensureUser(command.user_id, command.user_name);

    if (subcommand === "request") {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildRequestModal(user.language),
      });
      return;
    }

    if (subcommand === "balance") {
      const db = getDb();
      const requestRepo = createRequestRepo(db);
      const publicHolidayRepo = createPublicHolidayRepo(db);
      const year = new Date().getFullYear();
      const approved = requestRepo.getApprovedForUserInYear(user.slackId, year);
      const publicHolidays = publicHolidayRepo.getDatesForYear(year);
      const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays);
      const used = user.annualAllowance - remaining;

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: [
          `*${t("balance.title", user.language)}*`,
          t("balance.total", user.language, { days: String(user.annualAllowance) }),
          t("balance.used", user.language, { days: String(used) }),
          t("balance.remaining", user.language, { days: String(remaining) }),
        ].join("\n"),
      });
      return;
    }

    if (subcommand === "list") {
      const db = getDb();
      const requestRepo = createRequestRepo(db);
      const requests = requestRepo.listByUser(user.slackId);

      if (requests.length === 0) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: t("list.empty", user.language),
        });
        return;
      }

      const lines = requests.map((r) => {
        const statusKey = `list.status.${r.status}` as const;
        const status = t(statusKey, user.language);
        const halfDayInfo = [
          r.halfDayStart ? `(${t("request.half_day_start", user.language)})` : "",
          r.halfDayEnd ? `(${t("request.half_day_end", user.language)})` : "",
        ].filter(Boolean).join(" ");
        return `• ${r.startDate} → ${r.endDate} ${halfDayInfo} — *${status}*`;
      });

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `*${t("list.title", user.language)}*\n${lines.join("\n")}`,
      });
      return;
    }

    // Default: open main menu modal
    await client.views.open({
      trigger_id: command.trigger_id,
      view: buildMainMenuModal(user.language, user.isAdmin),
    });
  });
}
```

**Step 4: Commit**

```bash
git add src/handlers/ src/modals/
git commit -m "feat: slash command handler and modal builders"
```

---

### Task 9: Request Submission and Approval Flow

**Files:**
- Create: `src/handlers/actions.ts`
- Create: `src/handlers/submissions.ts`

**Step 1: Create request submission handler**

Create `src/handlers/submissions.ts`:

```typescript
import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { createPublicHolidayRepo } from "../db/repositories/publicHolidayRepo.js";
import { calculateRequestDays, calculateRemainingDays } from "../services/allowance.js";
import { t } from "../i18n/t.js";

export function registerSubmissionHandlers(app: App) {
  app.view("submit_holiday_request", async ({ ack, body, view, client }) => {
    const db = getDb();
    const userRepo = createUserRepo(db);
    const requestRepo = createRequestRepo(db);
    const publicHolidayRepo = createPublicHolidayRepo(db);

    const userId = body.user.id;
    const user = userRepo.findById(userId);
    if (!user) {
      await ack({ response_action: "errors", errors: {} });
      return;
    }

    const values = view.state.values;
    const startDate = values.start_date_block.start_date.selected_date!;
    const endDate = values.end_date_block.end_date.selected_date!;
    const halfDays = values.half_days_block?.half_days?.selected_options ?? [];
    const halfDayStart = halfDays.some((o: any) => o.value === "half_day_start");
    const halfDayEnd = halfDays.some((o: any) => o.value === "half_day_end");
    const reason = values.reason_block?.reason?.value ?? null;

    // Validate dates
    if (endDate < startDate) {
      await ack({
        response_action: "errors",
        errors: { end_date_block: t("request.invalid_dates", user.language) },
      });
      return;
    }

    // Check remaining allowance
    const year = new Date().getFullYear();
    const publicHolidays = publicHolidayRepo.getDatesForYear(year);
    const requestedDays = calculateRequestDays(startDate, endDate, halfDayStart, halfDayEnd, publicHolidays);
    const approved = requestRepo.getApprovedForUserInYear(userId, year);
    const remaining = calculateRemainingDays(user.annualAllowance, approved, publicHolidays);

    if (requestedDays > remaining) {
      await ack({
        response_action: "errors",
        errors: {
          end_date_block: t("request.insufficient_days", user.language, {
            remaining: String(remaining),
            requested: String(requestedDays),
          }),
        },
      });
      return;
    }

    await ack();

    // Create the request
    const requestId = requestRepo.create({
      userId,
      startDate,
      endDate,
      halfDayStart,
      halfDayEnd,
      reason,
    });

    // Notify user
    await client.chat.postMessage({
      channel: userId,
      text: t("request.submitted", user.language),
    });

    // Notify admins
    const admins = userRepo.getAdmins();
    const daysText = t("approval.days", user.language, { count: String(requestedDays) });
    for (const admin of admins) {
      const adminLang = admin.language;
      await client.chat.postMessage({
        channel: admin.slackId,
        text: t("approval.new_request", adminLang, { name: user.name }),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*${t("approval.new_request", adminLang, { name: user.name })}*`,
                t("approval.dates", adminLang, { start: startDate, end: endDate }),
                daysText,
                reason ? `> ${reason}` : "",
              ].filter(Boolean).join("\n"),
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: t("approval.approve", adminLang) },
                style: "primary",
                action_id: "approve_request",
                value: String(requestId),
              },
              {
                type: "button",
                text: { type: "plain_text", text: t("approval.reject", adminLang) },
                style: "danger",
                action_id: "reject_request",
                value: String(requestId),
              },
            ],
          },
        ],
      });
    }
  });
}
```

**Step 2: Create action handlers (approve/reject, menu buttons, language toggle)**

Create `src/handlers/actions.ts`:

```typescript
import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { buildMainMenuModal } from "../modals/mainMenu.js";
import { buildRequestModal } from "../modals/requestModal.js";
import { t } from "../i18n/t.js";

export function registerActionHandlers(app: App) {
  const db = getDb();
  const userRepo = createUserRepo(db);
  const requestRepo = createRequestRepo(db);

  // Approve request
  app.action("approve_request", async ({ ack, action, body, client }) => {
    await ack();
    const requestId = Number((action as any).value);
    const adminId = body.user.id;
    const admin = userRepo.findById(adminId);

    requestRepo.approve(requestId, adminId, null);
    const request = requestRepo.findById(requestId)!;
    const requester = userRepo.findById(request.userId);

    if (requester) {
      await client.chat.postMessage({
        channel: requester.slackId,
        text: t("approval.approved", requester.language, {
          start: request.startDate,
          end: request.endDate,
        }),
      });
    }

    // Update the admin's message to show it's been handled
    await client.chat.update({
      channel: (body as any).channel?.id ?? body.user.id,
      ts: (body as any).message?.ts ?? "",
      text: `Approved: ${request.startDate} → ${request.endDate} for <@${request.userId}>`,
      blocks: [],
    });
  });

  // Reject request
  app.action("reject_request", async ({ ack, action, body, client }) => {
    await ack();
    const requestId = Number((action as any).value);
    const adminId = body.user.id;

    requestRepo.reject(requestId, adminId, null);
    const request = requestRepo.findById(requestId)!;
    const requester = userRepo.findById(request.userId);

    if (requester) {
      await client.chat.postMessage({
        channel: requester.slackId,
        text: t("approval.rejected", requester.language, {
          start: request.startDate,
          end: request.endDate,
        }),
      });
    }

    await client.chat.update({
      channel: (body as any).channel?.id ?? body.user.id,
      ts: (body as any).message?.ts ?? "",
      text: `Rejected: ${request.startDate} → ${request.endDate} for <@${request.userId}>`,
      blocks: [],
    });
  });

  // Menu: open request modal
  app.action("open_request_modal", async ({ ack, body, client }) => {
    await ack();
    const user = userRepo.findById(body.user.id);
    const lang = user?.language ?? "en";
    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildRequestModal(lang),
    });
  });

  // Menu: toggle language
  app.action("toggle_language", async ({ ack, body, client }) => {
    await ack();
    const user = userRepo.findById(body.user.id);
    if (!user) return;
    const newLang = user.language === "en" ? "de" : "en";
    userRepo.setLanguage(user.slackId, newLang);

    // Update the modal with new language
    await client.views.update({
      view_id: (body as any).view?.id,
      view: buildMainMenuModal(newLang, user.isAdmin),
    });
  });

  // Acknowledge other menu actions (balance and list are handled via slash commands,
  // but we need ack for the button actions in the modal)
  app.action("show_balance", async ({ ack }) => {
    await ack();
    // Balance is shown via /holiday balance — from modal we just close
  });

  app.action("show_list", async ({ ack }) => {
    await ack();
    // List is shown via /holiday list — from modal we just close
  });

  app.action("open_admin_panel", async ({ ack }) => {
    await ack();
    // Admin panel — Task 10
  });

  // Acknowledge half_days checkboxes action
  app.action("half_days", async ({ ack }) => {
    await ack();
  });
}
```

**Step 3: Commit**

```bash
git add src/handlers/
git commit -m "feat: request submission, approval/rejection, and action handlers"
```

---

### Task 10: Admin Panel

**Files:**
- Create: `src/modals/adminPanel.ts`
- Create: `src/handlers/admin.ts`

**Step 1: Create admin panel modal**

Create `src/modals/adminPanel.ts`:

```typescript
import { t } from "../i18n/t.js";
import type { HolidayRequest } from "../db/repositories/requestRepo.js";
import type { User } from "../db/repositories/userRepo.js";

export function buildAdminPanelModal(lang: string, pendingRequests: HolidayRequest[], users: User[]) {
  const blocks: any[] = [];

  // Pending requests section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.pending_requests", lang) },
  });

  if (pendingRequests.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No pending requests_" },
    });
  } else {
    for (const req of pendingRequests) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<@${req.userId}> — ${req.startDate} → ${req.endDate}${req.reason ? `\n> ${req.reason}` : ""}`,
        },
        accessory: {
          type: "overflow",
          action_id: `admin_request_action_${req.id}`,
          options: [
            { text: { type: "plain_text", text: t("approval.approve", lang) }, value: `approve_${req.id}` },
            { text: { type: "plain_text", text: t("approval.reject", lang) }, value: `reject_${req.id}` },
          ],
        },
      });
    }
  }

  blocks.push({ type: "divider" });

  // User management section
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: t("admin.set_allowance", lang) },
  });

  blocks.push({
    type: "input",
    block_id: "user_select_block",
    element: {
      type: "users_select",
      action_id: "admin_user_select",
      placeholder: { type: "plain_text", text: "Select a user" },
    },
    label: { type: "plain_text", text: "User" },
  });

  blocks.push({
    type: "input",
    block_id: "allowance_block",
    element: {
      type: "number_input",
      action_id: "admin_allowance",
      is_decimal_allowed: false,
      min_value: "0",
      max_value: "365",
      placeholder: { type: "plain_text", text: "30" },
    },
    label: { type: "plain_text", text: t("admin.set_allowance", lang) },
  });

  return {
    type: "modal" as const,
    callback_id: "admin_panel_submit",
    title: { type: "plain_text" as const, text: t("admin.title", lang) },
    submit: { type: "plain_text" as const, text: t("admin.set_allowance", lang) },
    close: { type: "plain_text" as const, text: "Close" },
    blocks,
  };
}
```

**Step 2: Create admin handlers**

Create `src/handlers/admin.ts`:

```typescript
import type { App } from "@slack/bolt";
import { getDb } from "../db/connection.js";
import { createUserRepo } from "../db/repositories/userRepo.js";
import { createRequestRepo } from "../db/repositories/requestRepo.js";
import { buildAdminPanelModal } from "../modals/adminPanel.js";
import { t } from "../i18n/t.js";

export function registerAdminHandlers(app: App) {
  const db = getDb();
  const userRepo = createUserRepo(db);
  const requestRepo = createRequestRepo(db);

  // Open admin panel from menu
  app.action("open_admin_panel", async ({ ack, body, client }) => {
    await ack();
    const user = userRepo.findById(body.user.id);
    if (!user?.isAdmin) return;

    const pending = requestRepo.getPending();
    const users = userRepo.getAll();

    await client.views.push({
      trigger_id: (body as any).trigger_id,
      view: buildAdminPanelModal(user.language, pending, users),
    });
  });

  // Admin panel submit — set allowance
  app.view("admin_panel_submit", async ({ ack, body, view, client }) => {
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) {
      await ack();
      return;
    }

    const values = view.state.values;
    const selectedUserId = values.user_select_block.admin_user_select.selected_user!;
    const newAllowance = Number(values.allowance_block.admin_allowance.value);

    // Ensure selected user exists in our DB
    userRepo.upsert({ slackId: selectedUserId, name: selectedUserId });
    userRepo.setAllowance(selectedUserId, newAllowance);

    await ack();
  });

  // Admin overflow menu actions on pending requests
  app.action(/^admin_request_action_\d+$/, async ({ ack, action, body, client }) => {
    await ack();
    const admin = userRepo.findById(body.user.id);
    if (!admin?.isAdmin) return;

    const selectedValue = (action as any).selected_option?.value as string;
    if (!selectedValue) return;

    const [actionType, requestIdStr] = selectedValue.split("_");
    const requestId = Number(requestIdStr);
    const adminId = body.user.id;

    if (actionType === "approve") {
      requestRepo.approve(requestId, adminId, null);
    } else if (actionType === "reject") {
      requestRepo.reject(requestId, adminId, null);
    }

    const request = requestRepo.findById(requestId);
    if (request) {
      const requester = userRepo.findById(request.userId);
      if (requester) {
        const key = actionType === "approve" ? "approval.approved" : "approval.rejected";
        await client.chat.postMessage({
          channel: requester.slackId,
          text: t(key, requester.language, {
            start: request.startDate,
            end: request.endDate,
          }),
        });
      }
    }
  });
}
```

**Step 3: Commit**

```bash
git add src/modals/adminPanel.ts src/handlers/admin.ts
git commit -m "feat: admin panel with allowance management and request approval"
```

---

### Task 11: Wire Everything Into app.ts

**Files:**
- Modify: `src/app.ts`

**Step 1: Update app.ts to register all handlers**

Replace `src/app.ts` with:

```typescript
import { App } from "@slack/bolt";
import "dotenv/config";
import { getDb } from "./db/connection.js";
import { registerHolidayHandlers } from "./handlers/holiday.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerSubmissionHandlers } from "./handlers/submissions.js";
import { registerAdminHandlers } from "./handlers/admin.js";

// Initialize database on startup
getDb();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

registerHolidayHandlers(app);
registerActionHandlers(app);
registerSubmissionHandlers(app);
registerAdminHandlers(app);

(async () => {
  await app.start();
  console.log("Holiday Tracker bot is running!");
})();
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat: wire all handlers into app entry point"
```

---

### Task 12: Docker Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

**Step 1: Create .dockerignore**

```
node_modules
dist
*.db
.env
.git
```

**Step 2: Create Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
CMD ["node", "dist/app.js"]
```

**Step 3: Create docker-compose.yml**

```yaml
services:
  holiday-bot:
    build: .
    container_name: holiday-tracker-bot
    restart: unless-stopped
    env_file: .env
    volumes:
      - bot-data:/app/data
    environment:
      - DB_PATH=/app/data/holidays.db

volumes:
  bot-data:
```

**Step 4: Verify Docker build**

Run: `docker build -t holiday-tracker-bot .`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: Docker setup for deployment"
```

---

### Task 13: Slack App Configuration Guide

**Files:**
- Create: `docs/SETUP.md`

**Step 1: Write setup guide**

Create `docs/SETUP.md` with instructions for:

1. Create a new Slack app at api.slack.com/apps
2. Enable Socket Mode (under "Socket Mode") — generate an App-Level Token with `connections:write` scope
3. Add Bot Token Scopes under "OAuth & Permissions":
   - `chat:write` — send messages
   - `commands` — slash commands
   - `im:write` — DM users
   - `users:read` — read user info
4. Create the `/holiday` slash command under "Slash Commands"
5. Enable Interactivity under "Interactivity & Shortcuts"
6. Install the app to your workspace
7. Copy tokens to `.env`:
   - `SLACK_BOT_TOKEN` = Bot User OAuth Token (`xoxb-...`)
   - `SLACK_APP_TOKEN` = App-Level Token (`xapp-...`)
   - `SLACK_SIGNING_SECRET` = Signing Secret from Basic Information
8. Set the first admin: `sqlite3 data/holidays.db "UPDATE users SET is_admin = 1 WHERE slack_id = 'UXXXXXXXX';"`

**Step 2: Commit**

```bash
git add docs/SETUP.md
git commit -m "docs: Slack app setup guide"
```

---

### Task 14: Run Full Test Suite and Manual Smoke Test

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (schema, userRepo, requestRepo, publicHolidayRepo, allowance, i18n)

**Step 2: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Verify Docker builds**

Run: `docker build -t holiday-tracker-bot .`
Expected: Build succeeds

**Step 4: Manual smoke test (if Slack tokens are configured)**

1. Copy `.env.example` to `.env` and fill in tokens
2. Run: `npx tsx src/app.ts`
3. In Slack, run `/holiday` — should open main menu modal
4. Run `/holiday balance` — should show 30 days remaining
5. Run `/holiday request` — should open request form

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during testing"
```
