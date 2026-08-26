/**
 * Rules for who may cancel a holiday request and when.
 *
 * Employees may withdraw a request that is still pending, or cancel an approved
 * holiday that has not started yet. Anything already under way or in the past
 * stays with the admins — self-serve edits to history would silently rewrite
 * balances for periods that have already been reported on.
 */

export type CancelBlockedReason = "already_cancelled" | "rejected" | "started";

export type CancelEligibility =
  | { allowed: true }
  | { allowed: false; reason: CancelBlockedReason };

export interface CancellableRequest {
  status: string;
  startDate: string;
}

export function canUserCancel(
  request: CancellableRequest,
  today: string
): CancelEligibility {
  if (request.status === "cancelled") {
    return { allowed: false, reason: "already_cancelled" };
  }
  if (request.status === "rejected") {
    return { allowed: false, reason: "rejected" };
  }
  if (request.status === "pending") {
    return { allowed: true };
  }
  // Approved: only cancellable while the whole holiday is still in the future.
  // ISO dates compare correctly as strings.
  if (request.startDate <= today) {
    return { allowed: false, reason: "started" };
  }
  return { allowed: true };
}
