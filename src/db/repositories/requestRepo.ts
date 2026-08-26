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
  cancel(id: number, cancelledBy: string): void;
  deleteById(id: number): void;
  getPending(): HolidayRequest[];
  getApprovedForUserInYear(userId: string, year: number): HolidayRequest[];
  getUpcomingApproved(fromDate: string): HolidayRequest[];
  getApprovedOverlapping(startDate: string, endDate: string, excludeUserId?: string): HolidayRequest[];
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

    cancel(id, cancelledBy) {
      db.prepare("UPDATE holiday_requests SET status = 'cancelled', approved_by = ? WHERE id = ?")
        .run(cancelledBy, id);
    },

    deleteById(id) {
      db.prepare("DELETE FROM holiday_requests WHERE id = ?").run(id);
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

    getUpcomingApproved(fromDate) {
      return db.prepare(
        `SELECT * FROM holiday_requests
         WHERE status = 'approved' AND end_date >= ?
         ORDER BY start_date ASC`
      ).all(fromDate).map(rowToRequest);
    },

    // Two ranges overlap when each starts on or before the other one ends.
    getApprovedOverlapping(startDate, endDate, excludeUserId) {
      return db.prepare(
        `SELECT * FROM holiday_requests
         WHERE status = 'approved'
         AND start_date <= ? AND end_date >= ?
         AND (? IS NULL OR user_id != ?)
         ORDER BY start_date ASC`
      ).all(endDate, startDate, excludeUserId ?? null, excludeUserId ?? null).map(rowToRequest);
    },
  };
}
