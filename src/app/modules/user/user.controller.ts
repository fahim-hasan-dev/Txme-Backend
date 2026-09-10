import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserService } from './user.service';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';


// retrieved user profile
const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const user = req.user;
    const result = await UserService.getAllUsers(user, req.query);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Users data retrieved successfully',
        ...result
    });
});

//update profile
const updateProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const result = await UserService.updateProfileToDB(req.user, req.body);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Profile updated successfully',
        data: result
    });
});

// get single user
const getSingleUser = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await UserService.getSingleUser(id);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'User retrieved successfully',
        data: result
    });
});

// get my profile
const getMyProfile = catchAsync(async (req: Request, res: Response) => {
    const user = req.user;
    const result = await UserService.getmyProfile(user);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Profile data retrieved successfully',
        data: result
    });
});



// get popular providers


// update user status
const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { status } = req.body;
    const result = await UserService.updateUserStatusInDB(userId, status);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'User status updated successfully',
        data: result
    });
});


// delete user
const deleteUser = catchAsync(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const result = await UserService.deleteUserFromDB(userId);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: result.message
    });
});

const updateFcmToken = catchAsync(async (req: Request, res: Response) => {
    const token = req.body.token || req.body.fcmToken;
    console.log(`[UserController] User "${req.user?.id}" updating FCM token: ${token ? token.substring(0, 15) + '...' : 'EMPTY/UNDEFINED'}`);
    const result = await UserService.updateFcmTokenToDB(req.user, token);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'FCM Token updated successfully',
        data: result
    });
});

export const UserController = {
    getAllUsers,
    updateProfile,
    getSingleUser,
    getMyProfile,

    updateUserStatus,
    deleteUser,
    updateFcmToken
};
