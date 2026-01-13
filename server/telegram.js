import TelegramBot from "node-telegram-bot-api";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Telegram bot started");

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (text === "/start") {
    await bot.sendMessage(
      chatId,
      "🛡 Trade Guard активирован.\n\nЯ буду следить за лимитами и останавливать торговлю при нарушениях."
    );
    return;
  }

  if (text === "/ping") {
    await bot.sendMessage(chatId, "✅ Trade Guard online");
    return;
  }

  await bot.sendMessage(chatId, "Команда не распознана. Напиши /start");
});

