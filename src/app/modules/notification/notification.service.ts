import { JwtPayload } from 'jsonwebtoken';
import { INotification } from './notification.interface';
import { Notification } from './notification.model';
import { FilterQuery } from 'mongoose';
import QueryBuilder from '../../../helpers/QueryBuilder';

import { PushNotificationService } from './pushNotification.service';
import { User } from '../user/user.model';
import { addNotificationJob } from '../../queues/notification.queue';

// insert notification
const insertNotification = async (payload: Partial<INotification>): Promise<INotification> => {
    const result = await Notification.create(payload);

    // --- PUSH NOTIFICATION (BullMQ Queue) ---
    if (result.title && result.message) {
        if (result.type === 'ADMIN') {
            const admins = await User.find({
                role: { $in: ['ADMIN', 'SUPER_ADMIN'] }
            }).select('fcmToken').lean();

            const adminTokens = admins.map(a => a.fcmToken).filter(Boolean);

            if (adminTokens.length > 0) {
                console.log(`[NotificationService] Enqueuing admin push job for: "${result.title}" to ${adminTokens.length} admin(s)`);
                for (const token of adminTokens) {
                    await addNotificationJob({
                        token: token!,
                        title: `Admin: ${result.title}`,
                        message: result.message,
                        data: { referenceId: result.referenceId, screen: result.screen }
                    });
                }
            } else {
                console.warn(`⚠️ [NotificationService] Push skipped: No admin users found with an fcmToken in DB.`);
            }
        } else if (result.receiver) {
            const receiverId = result.receiver.toString();

            const receiverUser = await User.findById(receiverId).select('fcmToken fullName').lean();

            if (!receiverUser) {
                console.warn(`⚠️ [NotificationService] Push skipped: Receiver user ${receiverId} not found in DB.`);
            } else if (!receiverUser.fcmToken) {
                console.warn(`⚠️ [NotificationService] Push skipped: Receiver user "${receiverUser.fullName || receiverId}" does not have an fcmToken in DB.`);
            } else {
                console.log(`[NotificationService] Enqueuing push job for user "${receiverUser.fullName || receiverId}": "${result.title}"`);
                await addNotificationJob({
                    token: receiverUser.fcmToken,
                    title: result.title,
                    message: result.message,
                    data: { referenceId: result.referenceId, screen: result.screen }
                });
            }
        } else {
            console.warn(`⚠️ [NotificationService] Push skipped: Notification has no receiver specified.`);
        }
    } else {
        console.warn(`⚠️ [NotificationService] Push skipped: Missing title or message in notification.`);
    }

    // --- SOCKET NOTIFICATION ---
    //@ts-ignore
    const io = global.io;
    if (io) {
        if (result.type === 'ADMIN') {
            io.emit('admin-notification', result);
        } else if (result.receiver) {
            io.emit(`notification::${result.receiver.toString()}`, result);
        }
    }

    return result;
};

// get notifications
const getNotificationFromDB = async (user: JwtPayload, query: FilterQuery<any>): Promise<Object> => {
    const result = new QueryBuilder(Notification.find({ receiver: user.id }), query).paginate().sort();
    
    const [notifications, pagination, unreadCount] = await Promise.all([
        result.modelQuery.lean(),
        result.getPaginationInfo(),
        Notification.countDocuments({
            receiver: user.id,
            read: false,
        })
    ]);

    // Mark all unread notifications for this user as read
    await Notification.updateMany(
        { receiver: user.id, read: false },
        { $set: { read: true } }
    );

    const data: Record<string, any> = {
        notifications,
        pagination,
        unreadCount
    };

    return data;
};

// get unread notification count
const getUnreadCountFromDB = async (user: JwtPayload): Promise<number> => {
    const count = await Notification.countDocuments({
        receiver: user.id,
        read: false,
    });
    return count;
};

// get notifications for admin
const adminNotificationFromDB = async (query: FilterQuery<any>): Promise<{ notifications: INotification[], pagination: any, unreadCount: number }> => {
    const result = new QueryBuilder(Notification.find({ type: "ADMIN" }), query).paginate().sort();
    
    const [notifications, pagination, unreadCount] = await Promise.all([
        result.modelQuery.lean() as unknown as INotification[],
        result.getPaginationInfo(),
        Notification.countDocuments({
            type: 'ADMIN',
            read: false,
        })
    ]);

    // Mark all unread admin notifications as read
    await Notification.updateMany(
        { type: 'ADMIN', read: false },
        { $set: { read: true } }
    );

    return { notifications, pagination, unreadCount };
};

// get unread count for admin
const adminGetUnreadCountFromDB = async (): Promise<number> => {
    const count = await Notification.countDocuments({
        type: 'ADMIN',
        read: false,
    });
    return count;
};

export const NotificationService = {
    insertNotification,
    getNotificationFromDB,
    getUnreadCountFromDB,
    adminNotificationFromDB,
    adminGetUnreadCountFromDB
};
