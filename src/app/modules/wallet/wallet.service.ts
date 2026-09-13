// wallet.service.ts
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import { Wallet } from "./wallet.model";
import { WalletTransaction } from "../transaction/transaction.model";
import { StripeService } from "../stripe/stripe.service";
import { User } from "../user/user.model";
import ApiError from "../../../errors/ApiErrors";
import { NotificationService } from "../notification/notification.service";
import { logger } from "../../../shared/logger";
import { Types } from "mongoose";
import { checkWalletSetting } from "../../../helpers/checkSetting";

import { delCache, getCache, setCache } from "../../../helpers/redisHelper";

const getOrCreateWallet = async (userId: string, session?: mongoose.ClientSession) => {
  let wallet = await Wallet.findOne({ user: userId }).session(session || null);
  if (!wallet) {
    const [newWallet] = await Wallet.create([{ user: userId }], { session });
    wallet = newWallet;
  }
  return wallet;
};

export const roundFinancial = (num: number): number => {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
};

const getmyWallet = async (userId: string) => {
  const cacheKey = `cache:wallet:${userId}`;
  const cachedWallet = await getCache<any>(cacheKey);
  if (cachedWallet) {
    if (typeof cachedWallet.balance === 'number') {
      cachedWallet.balance = roundFinancial(cachedWallet.balance);
    }
    return cachedWallet;
  }

  const wallet = await getOrCreateWallet(userId);
  const result = wallet.toObject ? wallet.toObject() : wallet;
  if (result && typeof result.balance === 'number') {
    result.balance = roundFinancial(result.balance);
  }
  await setCache(cacheKey, result, 300); 
  return result;
};

// TOP UP
const topUp = async (
  userId: string, 
  amount: number, 
  reference: string = "topup",
  meta?: { fee?: number; netAmount?: number }
) => {
  const roundedAmount = roundFinancial(amount);
  if (roundedAmount <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Amount must be greater than zero");
  }

  await checkWalletSetting('topUp');
  console.log(`[WalletService] topUp called. User: ${userId}, Main Amount: ${roundedAmount}`);

  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw new ApiError(StatusCodes.FORBIDDEN, "User account is not active or not found");
  }

  // Idempotency check for topUp webhook processing
  if (reference && reference !== "topup") {
    const existingTx = await WalletTransaction.findOne({ reference });
    if (existingTx) {
      console.log(`[WalletService] TopUp reference ${reference} already processed.`);
      return existingTx;
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await getOrCreateWallet(userId, session);

    if (wallet.status === 'blocked') {
      throw new ApiError(StatusCodes.FORBIDDEN, "Your wallet is blocked. Please contact support.");
    }

    const fee = meta?.fee !== undefined ? roundFinancial(meta.fee) : 0;
    const net = meta?.netAmount !== undefined ? roundFinancial(meta.netAmount) : roundedAmount;

    const tx = await WalletTransaction.create(
      [
        {
          wallet: wallet._id,
          amount: roundedAmount, // Main payment amount (e.g. 100)
          fee: fee,              // Fee (e.g. 4.18)
          netAmount: net,        // Net credited amount (e.g. 95.82)
          type: "topup",
          direction: "credit",
          status: "success",
          to: userId,
          reference: reference
        },
      ],
      { session }
    );

    wallet.balance = roundFinancial(wallet.balance + net);
    await wallet.save({ session });

    await session.commitTransaction();

    // Send Notification
    try {
      await NotificationService.insertNotification({
        title: "Wallet Top Up",
        message: `Successfully added €${Number(net).toFixed(2)} to your wallet.`,
        receiver: new Types.ObjectId(userId),
        screen: "WALLET",
        type: "USER",
        read: false
      });
    } catch (notificationError) {
      console.error('[WalletService] Failed to insert top-up notification:', notificationError);
    }

    await delCache([`cache:wallet:${userId.toString()}`, `cache:user:profile:${userId.toString()}`]);

    return tx[0];
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
};

// SEND MONEY
const sendMoney = async (
  senderId: string,
  receiverIdentifier: string,
  amount: number,
  reference?: string,
  type: "send" | "payment" = "send"
) => {
  if (amount <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Amount must be greater than zero");
  }

  await checkWalletSetting('moneySend');

  console.log(`[WalletService] sendMoney: Sender: ${senderId}, Input: "${receiverIdentifier}", Amount: ${amount}`);

  // Determine lookup strategy: Priority ID -> Email -> Phone
  let receiver = null;

  if (Types.ObjectId.isValid(receiverIdentifier)) {
    receiver = await User.findById(receiverIdentifier);
  }

  if (!receiver) {
    const cleanIdentifier = receiverIdentifier?.trim().toLowerCase();
    receiver = await User.findOne({
      $or: [
        { email: cleanIdentifier },
        { phone: receiverIdentifier }
      ]
    });
  }

  if (!receiver) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Receiver not found");
  }

  const receiverId = receiver._id;

  if (senderId === receiverId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Cannot send money to yourself");
  }

  if (receiver.status !== 'active') {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Receiver account is ${receiver.status}.`);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sender = await User.findById(senderId).session(session);
    if (!sender || sender.status !== 'active') {
      throw new ApiError(StatusCodes.FORBIDDEN, "Your account is not active.");
    }

    const senderWallet = await getOrCreateWallet(senderId, session);
    const receiverWallet = await getOrCreateWallet(receiverId.toString(), session);

    if (senderWallet.status === 'blocked') {
      throw new ApiError(StatusCodes.FORBIDDEN, "Your wallet is blocked.");
    }
    if (receiverWallet.status === 'blocked') {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Receiver's wallet is blocked.");
    }

    const roundedAmount = roundFinancial(amount);
    if (senderWallet.balance < roundedAmount) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Insufficient wallet balance");
    }

    // Perform transfer
    senderWallet.balance = roundFinancial(senderWallet.balance - roundedAmount);
    receiverWallet.balance = roundFinancial(receiverWallet.balance + roundedAmount);

    await senderWallet.save({ session });
    await receiverWallet.save({ session });

    const appointmentObjectId = reference && Types.ObjectId.isValid(reference) ? new Types.ObjectId(reference) : undefined;

    const tx = await WalletTransaction.create(
      [
        {
          wallet: senderWallet._id,
          amount,
          type,
          direction: "debit",
          status: "success",
          from: senderId,
          to: receiverId,
          reference: reference || undefined,
          appointment: appointmentObjectId,
        },
        {
          wallet: receiverWallet._id,
          amount,
          type,
          direction: "credit",
          status: "success",
          from: senderId,
          to: receiverId,
          reference: reference || undefined,
          appointment: appointmentObjectId,
        },
      ],
      { session, ordered: true }
    );

    await session.commitTransaction();

    // Notifications
    try {
      await NotificationService.insertNotification({
        title: "Money Sent",
        message: `You have successfully sent €${Number(roundedAmount).toFixed(2)} to ${receiver.fullName || "User"}.`,
        receiver: new Types.ObjectId(senderId),
        screen: "WALLET",
        type: "USER",
        read: false
      });

      await NotificationService.insertNotification({
        title: "Money Received",
        message: `${sender.fullName || "Someone"} has sent you €${Number(roundedAmount).toFixed(2)} in your wallet.`,
        receiver: receiverId,
        screen: "WALLET",
        type: "USER",
        read: false
      });
    } catch (notifError) {
      console.error('[WalletService] Notification error:', notifError);
    }

    await delCache([`cache:wallet:${senderId}`, `cache:wallet:${receiverId.toString()}`]);

    return tx[0];
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
};

const withdraw = async (userId: string, amount: number) => {
  if (amount <= 5) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Amount must be greater than or equal to 5");
  }

  await checkWalletSetting('withdraw');

  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw new ApiError(StatusCodes.FORBIDDEN, "User account is not active or not found");
  }

  const wallet = await getOrCreateWallet(userId);
  if (wallet.status === 'blocked') {
    throw new ApiError(StatusCodes.FORBIDDEN, "Your wallet is blocked.");
  }

  if (wallet.balance < amount) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Insufficient balance");
  }

  // Ensure user is connected to Stripe
  if (!user.isStripeConnected || !user.stripeAccountId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Please connect your Stripe account to withdraw funds.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {

    // 1. Trigger Stripe Transfer (Platform -> Provider Account) FIRST to get reference
    const transfer = await StripeService.createTransfer(amount, user.stripeAccountId, { type: 'withdrawal', userId });

    // 2. Create successful transaction using Transfer ID as reference
    const tx = await WalletTransaction.create([
      {
        wallet: wallet._id,
        amount,
        type: "withdraw",
        direction: "debit",
        status: "success",
        from: userId,
        reference: transfer.id // Use Stripe Transfer ID
      }
    ], { session });

    const roundedAmount = roundFinancial(amount);
    // 3. Deduct from wallet balance
    wallet.balance = roundFinancial(wallet.balance - roundedAmount);
    await wallet.save({ session });

    // 4. Trigger Stripe Payout (Provider Account -> Card/Bank)
    try {
      await StripeService.createPayout(amount, user.stripeAccountId);
    } catch (payoutError: any) {
      logger.info(`[WalletService] Immediate payout deferred for user ${userId}: ${payoutError?.message || payoutError}. Funds transferred to connected account and will follow standard payout schedule.`);
    }

    await session.commitTransaction();

    // Notify User
    console.log(`[WalletService] Triggering withdrawal notification. User: ${userId}`);
    try {
      await NotificationService.insertNotification({
        title: "Withdrawal Successful",
        message: `Your withdrawal of €${Number(roundedAmount).toFixed(2)} has been successfully processed via Stripe.`,
        receiver: new Types.ObjectId(userId),
        screen: "WALLET",
        type: "USER",
        read: false
      });
    } catch (notifError) {
      console.error(`[WalletService] Withdrawal notification failed:`, notifError);
    }

    await delCache(`cache:wallet:${userId}`);

    return tx[0];
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const WalletService = {
  getOrCreateWallet,
  topUp,
  sendMoney,
  withdraw,
  getmyWallet
};
