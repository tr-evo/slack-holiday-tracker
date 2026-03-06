import { App } from "@slack/bolt";
import "dotenv/config";
import { getDb } from "./db/connection.js";
import { registerHolidayHandlers } from "./handlers/holiday.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerSubmissionHandlers } from "./handlers/submissions.js";

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

(async () => {
  await app.start();
  console.log("Holiday Tracker bot is running!");
})();
