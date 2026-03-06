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
