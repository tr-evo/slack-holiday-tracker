import { App } from "@slack/bolt";
import "dotenv/config";
import { getDb } from "./db/connection.js";
import { registerHolidayHandlers } from "./handlers/holiday.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerSubmissionHandlers } from "./handlers/submissions.js";
import { registerAdminHandlers } from "./handlers/admin.js";
import { registerHomeHandlers } from "./handlers/views.js";

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
registerHomeHandlers(app);

// A thrown listener would otherwise surface as an unhandled rejection, which
// Node turns into a process exit — one bad interaction killing the whole bot.
app.error(async (error) => {
  console.error("[bolt] unhandled listener error:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection:", reason);
});

(async () => {
  await app.start();
  console.log("Holiday Tracker bot is running!");
})();
