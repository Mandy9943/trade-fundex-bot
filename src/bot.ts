import type { AxiosInstance } from "axios";
import axios from "axios";
import BigNumber from "bignumber.js";
import TelegramBot from "node-telegram-bot-api";
import { World, e, envChain } from "xsuite";
import abi from "./master.abi.json";
import { CommandPayload, CommandType, SwapParams } from "./types";
import { scQuery } from "./utils";
export class TradingBot {
  private bot: TelegramBot;
  private api: AxiosInstance;
  private world: World;
  private authorizedChatIds: Set<number>;

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.api = axios.create({
      baseURL: "https://api.multiversx.com",
      timeout: 40000,
    });
    this.world = World.new({
      chainId: envChain.id(),
    });

    // Initialize authorized chat IDs from environment variable
    const chatIdsStr = process.env.TELEGRAM_CHATS_IDS || "";
    this.authorizedChatIds = new Set(
      chatIdsStr
        .split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id))
    );

    this.setupCommandHandlers();
  }

  private isAuthorized(chatId: number): boolean {
    if (this.authorizedChatIds.size === 0) {
      console.warn(
        "No authorized chat IDs configured. Bot is currently accessible to everyone."
      );
      return true;
    }
    return this.authorizedChatIds.has(chatId);
  }

  private setupCommandHandlers(): void {
    // Middleware to check authorization for all commands
    this.bot.on("message", (msg) => {
      if (!this.isAuthorized(msg.chat.id) && msg.text?.startsWith("/")) {
        this.bot.sendMessage(
          msg.chat.id,
          "⛔ Unauthorized access. This bot is private."
        );
        return;
      }
    });

    // Help command
    this.bot.onText(/\/help/, (msg) => {
      if (!this.isAuthorized(msg.chat.id)) return;
      const chatId = msg.chat.id;
      this.bot.sendMessage(
        chatId,
        `Available commands:
• /buy <token> [amount] - Buy tokens (amount optional)
• /sell <token> [amount] - Sell tokens (amount optional)

Examples:
/buy TOKEN-123 100
/sell TOKEN-abc`
      );
    });

    // Buy command validation
    this.bot.onText(/\/buy(.*)/, (msg, match) => {
      if (!this.isAuthorized(msg.chat.id)) return;
      if (!match || !match[1]) {
        this.sendUsageError(msg.chat.id, "buy");
        return;
      }

      const params = match[1].trim().split(/\s+/);
      if (params.length < 1) {
        this.sendUsageError(msg.chat.id, "buy");
        return;
      }

      const [token, amountStr] = params;
      const amount = amountStr ? parseFloat(amountStr) : undefined;

      if (amount !== undefined && isNaN(amount)) {
        this.bot.sendMessage(msg.chat.id, "❌ Invalid amount provided");
        return;
      }

      this.handleCommand("buy", msg, token, amount);
    });

    // Sell command validation
    this.bot.onText(/\/sell(.*)/, (msg, match) => {
      if (!this.isAuthorized(msg.chat.id)) return;
      if (!match || !match[1]) {
        this.sendUsageError(msg.chat.id, "sell");
        return;
      }

      const params = match[1].trim().split(/\s+/);
      if (params.length < 1) {
        this.sendUsageError(msg.chat.id, "sell");
        return;
      }

      const [token, amountStr] = params;
      const amount = amountStr ? parseFloat(amountStr) : undefined;

      if (amount !== undefined && isNaN(amount)) {
        this.bot.sendMessage(msg.chat.id, "❌ Invalid amount provided");
        return;
      }

      this.handleCommand("sell", msg, token, amount);
    });

    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      if (!this.isAuthorized(msg.chat.id)) return;
      const chatId = msg.chat.id;
      try {
        const wallet = this.loadWallet().toString();
        this.bot.sendMessage(
          chatId,
          `Welcome to the Trading Bot! 🤖

This bot allows you to buy and sell tokens using simple commands.
Your associated wallet address is: ${wallet}

Use /help to see available commands.
Use /address to see your current token balances.`
        );
      } catch (error) {
        this.bot.sendMessage(
          chatId,
          "Welcome to the Trading Bot! An error occurred while fetching your wallet address. Please try /address later."
        );
      }
    });

    // Address command
    this.bot.onText(/\/address/, async (msg) => {
      if (!this.isAuthorized(msg.chat.id)) return;
      const chatId = msg.chat.id;
      try {
        const wallet = this.loadWallet().toString();
        const response = await this.api.get<any[]>(
          `/accounts/${wallet}/tokens`
        );
        const balances = response.data
          .map(
            (token) =>
              `${token.identifier.split("-")[0]}: ${new BigNumber(token.balance)
                .div(10 ** token.decimals)
                .toFixed(2)}`
          )
          .join("\n");

        this.bot.sendMessage(
          chatId,
          `Wallet Address: ${wallet}\nBalances:\n${balances}`
        );
      } catch (error) {
        this.bot.sendMessage(chatId, "Error fetching address and balances.");
      }
    });
  }

  private sendUsageError(chatId: number, command: string): void {
    this.bot.sendMessage(
      chatId,
      `❌ Invalid command format. Usage:
/${command} <token> [amount]

Example:
/${command} TOKEN-123 100`
    );
  }

  private async handleCommand(
    command: CommandType,
    msg: TelegramBot.Message,
    token: string,
    amount?: number
  ): Promise<void> {
    const chatId = msg.chat.id;
    const payload: CommandPayload = { token, amount };

    try {
      switch (command) {
        case "buy":
          await this.handleBuy(chatId, payload);
          break;
        case "sell":
          await this.handleSell(chatId, payload);
          break;
      }
    } catch (error) {
      this.bot.sendMessage(
        chatId,
        `Error processing ${command} order: ${(error as Error).message}`
      );
    }
  }

  private loadWallet() {
    return this.world.newWalletFromFile_unsafe(
      "wallet.json",
      process.env.WALLET_PASSWORD!
    );
  }

  private async swapToken(params: SwapParams) {
    const wallet = await this.loadWallet();

    const result = await wallet.callContract({
      callee: params.address,
      gasLimit: 10_000_000,
      funcName: "swap",
      esdts: [
        {
          amount: Math.floor(params.amountToSend),
          nonce: 0,
          id: params.tokenToSend,
        },
      ],
      funcArgs: [e.Str(params.tokenToReceive), e.U(params.minAmountToReceive)],
    });

    return result;
  }

  private async findContractAddress(tokenId: string): Promise<string> {
    try {
      const result = await scQuery(
        "erd1qqqqqqqqqqqqqpgqg0sshhkwaxz8fxu47z4svrmp48mzydjlptzsdhxjpd",
        abi, // You'll need to import this
        "getAllBondingMetadata"
      );

      const data = result.firstValue?.valueOf().map((item: any) => ({
        ...item,
        address: item.address.bech32(),
      }));

      const matchingContract = data.find(
        (contract: any) => contract.first_token_id === tokenId
      );

      if (!matchingContract) {
        throw new Error(`No contract found for token ${tokenId}`);
      }

      return matchingContract.address;
    } catch (error) {
      console.error("Error finding contract address:", error);
      throw new Error(
        `Failed to find contract for token ${tokenId}: ${
          (error as Error).message
        }`
      );
    }
  }

  private async handleBuy(
    chatId: number,
    payload: CommandPayload
  ): Promise<void> {
    try {
      this.bot.sendMessage(
        chatId,
        `🔍 Processing buy order for token: ${payload.token}...`
      );

      // Find contract address for the token
      const contractAddress = await this.findContractAddress(payload.token);
      this.bot.sendMessage(
        chatId,
        `✅ Found trading contract: ${contractAddress.slice(
          0,
          8
        )}...${contractAddress.slice(-4)}`
      );

      const wallet = this.loadWallet().toString();
      const tokenToSend = "ONE-f9954f";

      // Get token balance
      const response = await this.api.get<any[]>(`/accounts/${wallet}/tokens`);
      const tokenBalance = response.data.find(
        (token) => token.identifier === tokenToSend
      );

      if (!tokenBalance) {
        throw new Error(`Token ${tokenToSend} not found in wallet`);
      }

      const amountToPay = payload.amount
        ? new BigNumber(payload.amount).times(10 ** 18)
        : new BigNumber(tokenBalance.balance).times(0.98);

      if (amountToPay.isNaN() || amountToPay.isLessThanOrEqualTo(0)) {
        throw new Error("Invalid amount calculated");
      }

      this.bot.sendMessage(
        chatId,
        `💫 Submitting transaction to blockchain...`
      );

      const result = await this.swapToken({
        address: contractAddress,
        tokenToSend,
        amountToSend: amountToPay.toNumber(),
        minAmountToReceive: new BigNumber(1).toNumber(),
        tokenToReceive: payload.token,
      });

      const txUrl =
        result.explorerUrl || "Transaction submitted (URL not available)";
      this.bot.sendMessage(
        chatId,
        `✅ Transaction successful!\n\nView on explorer: ${txUrl}`
      );
    } catch (error) {
      console.error("Error in buyToken:", (error as Error).message);
      this.bot.sendMessage(
        chatId,
        `❌ Transaction failed: ${(error as Error).message}`
      );
      throw error;
    }
  }

  private async handleSell(
    chatId: number,
    payload: CommandPayload
  ): Promise<void> {
    try {
      this.bot.sendMessage(
        chatId,
        `🔍 Processing sell order for token: ${payload.token}...`
      );

      // Find contract address for the token
      const contractAddress = await this.findContractAddress(payload.token);
      this.bot.sendMessage(
        chatId,
        `✅ Found trading contract: ${contractAddress.slice(
          0,
          8
        )}...${contractAddress.slice(-4)}`
      );

      const wallet = this.loadWallet().toString();

      // Get token balance
      const response = await this.api.get<any[]>(`/accounts/${wallet}/tokens`);
      const tokenBalance = response.data.find(
        (token) => token.identifier === payload.token
      );

      if (!tokenBalance) {
        throw new Error(`Token ${payload.token} not found in wallet`);
      }

      const amountToSell = payload.amount
        ? new BigNumber(payload.amount).times(10 ** tokenBalance.decimals)
        : new BigNumber(tokenBalance.balance).times(0.98);

      if (amountToSell.isNaN() || amountToSell.isLessThanOrEqualTo(0)) {
        throw new Error("Invalid amount calculated");
      }

      this.bot.sendMessage(
        chatId,
        `💫 Submitting transaction to blockchain...`
      );

      const result = await this.swapToken({
        address: contractAddress,
        tokenToSend: payload.token,
        amountToSend: amountToSell.toNumber(),
        minAmountToReceive: new BigNumber(1).toNumber(),
        tokenToReceive: "ONE-f9954f",
      });

      const txUrl =
        result.explorerUrl || "Transaction submitted (URL not available)";
      this.bot.sendMessage(
        chatId,
        `✅ Transaction successful!\n\nView on explorer: ${txUrl}`
      );
    } catch (error) {
      console.error("Error in sellToken:", (error as Error).message);
      this.bot.sendMessage(
        chatId,
        `❌ Transaction failed: ${(error as Error).message}`
      );
      throw error;
    }
  }

  // Add a new command to show current chat ID
  private setupAdditionalCommands(): void {
    this.bot.onText(/\/chatid/, (msg) => {
      this.bot.sendMessage(
        msg.chat.id,
        `Your Chat ID is: ${msg.chat.id}\n\nTo authorize this chat, add this ID to the TELEGRAM_CHATS_IDS environment variable.`
      );
    });
  }
}
