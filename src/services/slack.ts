/**
 * Slack messaging helpers.
 *
 * DM channel ids are stable per user, so `conversations.open` is called once
 * and remembered — it used to run on every single notification.
 */

const dmChannels = new Map<string, string>();

async function dmChannelFor(client: any, userId: string): Promise<string> {
  const cached = dmChannels.get(userId);
  if (cached) return cached;

  const res = await client.conversations.open({ users: userId });
  const channelId = res.channel.id;
  dmChannels.set(userId, channelId);
  return channelId;
}

/**
 * Send a DM to a user reliably.
 * Uses conversations.open first to ensure a DM channel exists,
 * which is required from slash command context and safest everywhere.
 */
export async function sendDM(client: any, userId: string, text: string, blocks?: any[]) {
  const channel = await dmChannelFor(client, userId);
  await client.chat.postMessage({ channel, text, ...(blocks ? { blocks } : {}) });
}

/**
 * Fan out the same notification to several people at once. Sequential awaits
 * here meant a request with five admins spent ten round trips before settling.
 * One failed recipient must not silently swallow the rest.
 */
export async function sendDMs(
  client: any,
  recipients: { userId: string; text: string; blocks?: any[] }[]
): Promise<void> {
  const results = await Promise.allSettled(
    recipients.map((r) => sendDM(client, r.userId, r.text, r.blocks))
  );
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(`[slack] DM to ${recipients[i].userId} failed:`, result.reason);
    }
  }
}
