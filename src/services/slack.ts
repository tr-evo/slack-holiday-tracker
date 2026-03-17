/**
 * Send a DM to a user reliably.
 * Uses conversations.open first to ensure a DM channel exists,
 * which is required from slash command context and safest everywhere.
 */
export async function sendDM(client: any, userId: string, text: string) {
  const res = await client.conversations.open({ users: userId });
  await client.chat.postMessage({ channel: res.channel.id, text });
}
