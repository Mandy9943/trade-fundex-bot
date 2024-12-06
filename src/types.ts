export interface CommandPayload {
  token: string;
  amount?: number;
}

export type CommandType = "buy" | "sell";

export interface SwapParams {
  address: string;
  tokenToReceive: string;
  tokenToSend: string;
  minAmountToReceive: number;
  amountToSend: number;
}
