/**
 * Cached, fully paginated workspace member directory.
 *
 * Every user picker is an external_select with `min_query_length: 0`, so its
 * options handler fired on open and again on each keystroke — each time calling
 * `users.list`, a rate-limited endpoint, from inside the interaction path. That
 * made the pickers feel slow and could exhaust the quota with two admins typing.
 * The list also went unpaginated, silently losing everyone past the first page.
 */

export interface Member {
  id: string;
  name: string;
}

const TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 200;

let cache: { members: Member[]; fetchedAt: number } | null = null;
let inFlight: Promise<Member[]> | null = null;

function isUsable(m: any): boolean {
  return !m.is_bot && m.id !== "USLACKBOT" && !m.deleted && !m.is_restricted && !m.is_ultra_restricted;
}

async function fetchAll(client: any): Promise<Member[]> {
  const members: Member[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.users.list({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    for (const m of page.members ?? []) {
      if (isUsable(m)) members.push({ id: m.id, name: m.real_name || m.name });
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  members.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}

export async function getMembers(client: any): Promise<Member[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.members;

  // Collapse concurrent misses into a single API sweep
  if (!inFlight) {
    inFlight = fetchAll(client)
      .then((members) => {
        cache = { members, fetchedAt: Date.now() };
        return members;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return await inFlight;
  } catch (err) {
    console.error("[members] users.list failed:", err);
    return cache?.members ?? []; // stale beats empty
  }
}

export async function searchMembers(client: any, query: string, limit = 100): Promise<Member[]> {
  const members = await getMembers(client);
  const q = query.trim().toLowerCase();
  const matched = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
  return matched.slice(0, limit);
}

export function findMemberName(members: Member[], id: string): string | undefined {
  return members.find((m) => m.id === id)?.name;
}

/** Test seam / manual refresh. */
export function clearMemberCache(): void {
  cache = null;
}
