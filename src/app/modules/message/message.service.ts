import mongoose from 'mongoose';
import QueryBuilder from '../../../helpers/QueryBuilder';
import { IMessage } from './message.interface';
import { Message } from './message.model';
import { checkMongooseIDValidation } from '../../../shared/checkMongooseIDValidation';
import { Chat } from '../chat/chat.model';
import { WalletService } from '../wallet/wallet.service';
import { MESSAGE } from '../../../enums/message';
import { JwtPayload } from 'jsonwebtoken';
import ApiError from '../../../errors/ApiErrors';
import { StatusCodes } from 'http-status-codes';
import { checkWalletSetting } from '../../../helpers/checkSetting';
import { PushNotificationService } from '../notification/pushNotification.service';
import { NotificationService } from '../notification/notification.service';
import { addNotificationJob } from '../../queues/notification.queue';
import { User } from '../user/user.model';
import { ADMIN_ROLES } from '../../../enums/user';
import { Admin } from '../admin/admin.model';

const sendMessageToDB = async (payload: any): Promise<IMessage> => {
  // Initialize readBy with sender's ID
  payload.readBy = [payload.sender];

  if (payload.type === MESSAGE.MoneyRequest) {
    await checkWalletSetting('moneyRequest');
    if (!payload.amount || payload.amount <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Amount is required for money requests and must be greater than 0");
    }
    payload.moneyRequestStatus = 'pending';

    if (await Chat.findById(payload.chatId).isAdminSupport) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You can't send money request to admin support chat");
    }
  }

  const isExistChat = await Chat.findById(payload.chatId);
  if (!isExistChat) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Chat doesn't exist!");
  }

  const isExistAdmin = await Admin.findById(payload.sender);

  if (!isExistChat.participants.includes(payload.sender) && !isExistAdmin) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You are not a participant!");
  }

  // Save to DB
  const response = await Message.create(payload);

  // Update chat's lastMessage and lastMessageAt
  await Chat.findByIdAndUpdate(payload.chatId, {
    lastMessage: response._id,
    lastMessageAt: new Date()
  });

  //@ts-ignore
  const io = global.io;
  if (io && payload.chatId) {
    // Send message to specific Chat room
    io.emit(`getMessage::${payload?.chatId}`, response);

    // Notify ALL participants to update their chat list (real-time sorting)
    isExistChat.participants.forEach((participantId: any) => {
      io.emit(`chatListUpdate::${participantId.toString()}`, {
        chatId: payload.chatId,
        lastMessage: response,
      });
    });

    // If it's an admin support chat, also notify ALL admins (for admin dashboard update)
    if (isExistChat.isAdminSupport) {
      console.log(`[Socket] Emitting adminChatListUpdate for chatId: ${payload.chatId}`);
      io.emit('adminChatListUpdate', {
        chatId: payload.chatId,
        lastMessage: response,
      });
    }
  }

  // Send Push Notification
  try {
    const chatStatus = await Chat.findById(payload.chatId);
    if (!chatStatus) return response;

    // Fetch sender details for better title
    const sender = await User.findById(payload.sender).select('fullName role');
    const title = sender?.fullName || "New Message";
    const body = payload.text ?
      (payload.text.length > 50 ? payload.text.substring(0, 50) + "..." : payload.text) :
      "Sent an attachment";

    if (chatStatus.isAdminSupport) {
      // For Admin Support, notify all admins except the sender (if sender is an admin)
      // or all admins if sender is a user
      const admins = await User.find({
        role: { $in: [ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN] },
        _id: { $ne: payload.sender }
      }).select('fcmToken');

      const adminTokens = admins.map(a => a.fcmToken).filter(Boolean);

      // Send to each admin (Firebase Admin SDK .send() takes one token, or use .sendEachForMulticast)
      if (adminTokens.length > 0) {
        for (const token of adminTokens) {
          await addNotificationJob({
            token: token!,
            title: `Support: ${title}`,
            message: body,
            data: { screen: "CHAT", chatId: payload.chatId?.toString() }
          });
        }
      }

      // If the sender is an admin, notify the user as well
      const isSenderAdmin = [ADMIN_ROLES.ADMIN, ADMIN_ROLES.SUPER_ADMIN].includes(sender?.role as any);
      if (isSenderAdmin) {
        const userParticipant = await User.findById(chatStatus.participants[0]).select('fcmToken').lean();
        if (userParticipant?.fcmToken) {
          await addNotificationJob({
            token: userParticipant.fcmToken,
            title,
            message: body,
            data: { screen: "CHAT", chatId: payload.chatId?.toString() }
          });
        }
      }
    } else {
      // Normal Chat recipient
      const recipientId = chatStatus.participants.find(
        (p: any) => p.toString() !== payload.sender.toString()
      );

      if (recipientId) {
        const recipient = await User.findById(recipientId).select('fcmToken fullName').lean();
        if (recipient?.fcmToken) {
          console.log(`[MessageService] Enqueuing chat push notification to recipient "${recipient.fullName || recipientId}"`);
          await addNotificationJob({
            token: recipient.fcmToken,
            title,
            message: body,
            data: { screen: "CHAT", chatId: payload.chatId?.toString() }
          });
        } else {
          console.warn(`⚠️ [MessageService] Push skipped: Recipient "${recipient?.fullName || recipientId}" has NO fcmToken in DB.`);
        }
      }
    }
  } catch (error) {
    console.error("❌ [MessageService] Error enqueuing chat push notification:", error);
    // Don't block the response if notification fails
  }

  return response;
};

// Get Message from db
const getMessageFromDB = async (
  id: string,
  user: JwtPayload,
  query: Record<string, any>
): Promise<{ messages: IMessage[], pagination: any, participant: any }> => {
  checkMongooseIDValidation(id, "Chat");

  const isExistChat = await Chat.findById(id);
  if (!isExistChat) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Chat doesn't exist!");
  }

  if (!isExistChat.participants.includes(user.id) && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    throw new Error('You are not participant of this chat')
  }

  // Mark messages as read for this user
  await Message.updateMany(
    {
      chatId: new mongoose.Types.ObjectId(id),
      sender: { $ne: new mongoose.Types.ObjectId(user.id) },
      readBy: { $ne: new mongoose.Types.ObjectId(user.id) }
    },
    {
      $addToSet: { readBy: new mongoose.Types.ObjectId(user.id) }
    }
  );

  const result = new QueryBuilder(
    Message.find({ chatId: id })
      .populate('sender', 'fullName profilePicture')
      .sort({ createdAt: -1 }),
    query
  ).paginate();

  const [rawMessages, pagination, participant] = await Promise.all([
    result.modelQuery.lean() as unknown as IMessage[],
    result.getPaginationInfo(),
    Chat.findById(id)
      .populate({
        path: 'participants',
        select: '-_id fullName profilePicture ',
        match: {
          _id: { $ne: new mongoose.Types.ObjectId(user.id) }
        }
      })
      .lean()
  ]);

  const messages = [...rawMessages].reverse();

  return { messages, pagination, participant: (participant as any)?.participants[0] };
};


// Update a message
const updateMessageToDB = async (messageId: string, userId: string, payload: Partial<IMessage>): Promise<IMessage | null> => {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found");
  }

  // Check if the user is the sender
  if (message.sender.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You can only update your own messages");
  }

  // Update the message
  const updatedMessage = await Message.findByIdAndUpdate(
    messageId,
    payload,
    { new: true }
  );

  //@ts-ignore
  const io = global.io;
  if (io && updatedMessage) {
    io.emit(`getMessage::${updatedMessage.chatId}`, updatedMessage);
  }

  return updatedMessage;
};

// Get unread message count for a specific chat
const getUnreadCountForChat = async (chatId: string, userId: string): Promise<number> => {
  const count = await Message.countDocuments({
    chatId: new mongoose.Types.ObjectId(chatId),
    sender: { $ne: new mongoose.Types.ObjectId(userId) },
    readBy: { $ne: new mongoose.Types.ObjectId(userId) }
  });

  return count;
};

// Get total unread message count for a user
const getTotalUnreadCount = async (userId: string): Promise<number> => {
  // Get all chats for this user
  const chats = await Chat.find({
    participants: new mongoose.Types.ObjectId(userId)
  }).select('_id');

  const chatIds = chats.map(chat => chat._id);

  // Count unread messages across all chats
  const count = await Message.countDocuments({
    chatId: { $in: chatIds },
    sender: { $ne: new mongoose.Types.ObjectId(userId) },
    readBy: { $ne: new mongoose.Types.ObjectId(userId) }
  });

  return count;
};

// Delete message from DB
const deleteMessageFromDB = async (messageId: string, userId: string): Promise<IMessage | null> => {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found");
  }

  // Check if the user is the sender of the message
  if (message.sender.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You can only delete your own messages");
  }

  return await Message.findByIdAndDelete(messageId);
};

const updateMoneyRequestStatusToDB = async (messageId: string, user: JwtPayload, status: 'accepted' | 'rejected') => {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found");
  }

  if (message.type !== MESSAGE.MoneyRequest) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message is not a money request");
  }

  if (message.moneyRequestStatus !== 'pending') {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Money request is already ${message.moneyRequestStatus}`);
  }

  // The sender is the one who REQUESTED money. The participant (current user) is the one who ACCEPTS/REJECTS.
  if (message.sender.toString() === user.id) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You cannot accept/reject your own money request");
  }

  if (status === 'accepted') {
    await checkWalletSetting('moneyRequest');
    if (!message.amount) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid money request: amount missing");
    }

    // Transfer money from the current user (acceptor) to the message sender (requester)
    await WalletService.sendMoney(user.id, message.sender.toString(), message.amount);
  }

  message.moneyRequestStatus = status;
  await message.save();

  // Socket notification for real-time update in chat UI
  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`moneyRequestUpdate::${message.chatId}`, message);

    // Also update chat list for participants (move to top)
    const chat = await Chat.findById(message.chatId);
    if (chat) {
      chat.participants.forEach((participantId: any) => {
        io.emit(`chatListUpdate::${participantId.toString()}`, {
          chatId: message.chatId,
          lastMessageAt: new Date(),
        });
      });
    }
  }

  // --- Send Push Notification to Request Sender ---
  try {
    const title = status === 'accepted' ? "Money Request Accepted" : "Money Request Rejected";
    const body = status === 'accepted'
      ? `Your request for ${message.amount} has been accepted.`
      : `Your request for ${message.amount} has been rejected.`;

    await NotificationService.insertNotification({
      title,
      message: body,
      receiver: message.sender, // Notify the person who requested the money
      referenceId: message.chatId, // Redirect to the chat
      screen: "CHAT",
      type: "USER"
    });
  } catch (error) {
    console.error(`[MessageService] Failed to send money request notification:`, error);
  }

  return message;
};

export const MessageService = {
  sendMessageToDB,
  getMessageFromDB,
  updateMessageToDB,
  getUnreadCountForChat,
  getTotalUnreadCount,
  deleteMessageFromDB,
  updateMoneyRequestStatusToDB
};