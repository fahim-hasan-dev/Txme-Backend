// transaction.interface.ts
import { Types } from "mongoose";

export interface IWalletTransaction {
  wallet?: Types.ObjectId;
  amount: number;
  type: "topup" | "withdraw" | "send" | "promotion" | "payment";
  direction: "credit" | "debit";
  status: "pending" | "success" | "failed";
  reference?: string;
  from?: Types.ObjectId;
  to?: Types.ObjectId;
  appointment?: Types.ObjectId;
  platform?: "ios" | "android";
  productId?: string;
  fee?: number;
  netAmount?: number;
}
