import { Schema, model } from "mongoose";
import { IWalletTransaction } from "./transaction.interface";

const transactionSchema = new Schema<IWalletTransaction>(
  {
    wallet: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: false,
    },
    amount: { 
      type: Number, 
      required: true,
    },
    fee: { 
      type: Number, 
      default: 0,
    },
    netAmount: { 
      type: Number,
    },
    type: {
      type: String,
      enum: ["topup", "withdraw", "send", "promotion", "payment"],
      required: true,
    },
    direction: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    reference: String,
    from: { type: Schema.Types.ObjectId, ref: "User" },
    to: { type: Schema.Types.ObjectId, ref: "User" },
    appointment: { type: Schema.Types.ObjectId, ref: "Appointment" },
    platform: { type: String, enum: ["ios", "android"] },
    productId: { type: String },
  },
  { timestamps: true }
);

// Indexes for high performance querying
transactionSchema.index({ wallet: 1, createdAt: -1 });
transactionSchema.index({ reference: 1 });
transactionSchema.index({ from: 1, to: 1 });

export const WalletTransaction = model<IWalletTransaction>(
  "WalletTransaction",
  transactionSchema
);
