import dotenv from "dotenv";
import { TradingBot } from "./bot";

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN must be provided!");
}

// Initialize the bot
const bot = new TradingBot(token);

console.log("Bot is running...");
