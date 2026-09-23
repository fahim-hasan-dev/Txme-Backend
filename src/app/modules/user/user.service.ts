import { IUser } from "./user.interface";
import { JwtPayload } from "jsonwebtoken";
import { User } from "./user.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import generateOTP from "../../../util/generateOTP";
import unlinkFile from "../../../shared/unlinkFile";
import sendSMS from "../../../shared/sendSMS";
import { emailHelper } from "../../../helpers/emailHelper";
import { ADMIN_ROLES } from "../../../enums/user";
import QueryBuilder from "../../../helpers/QueryBuilder";
import { Appointment } from "../appointment/appointment.model";
import { Review } from "../review/review.model";
import { Types } from "mongoose";
import { geocodePostCode } from "../../../util/geocoding.util";
import { delCache, getCache, setCache } from "../../../helpers/redisHelper";

// get all users
const getAllUsers = async (
  user: JwtPayload,
  query: Record<string, unknown>
) => {
  const isAdminOrSuperAdmin =
    user.role === ADMIN_ROLES.ADMIN || user.role === ADMIN_ROLES.SUPER_ADMIN;

  if (user.role === "CUSTOMER" || user.role === "PROVIDER") {
    query.role = "PROVIDER";
  }

  // Geolocation & Postcode check only for non-admin roles (CUSTOMER & PROVIDER)
  if (!isAdminOrSuperAdmin) {
    // Use query postCode or user's residentialAddress.postCode
    let searchPostCode = query.postCode as string;
    if (!searchPostCode && user?.id) {
      const currentUser = await User.findById(user.id).select("residentialAddress").lean();
      if (currentUser?.residentialAddress?.postCode) {
        searchPostCode = currentUser.residentialAddress.postCode;
      }
    }

    if (!searchPostCode) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Postcode is required in your residential address to search providers"
      );
    }

    try {
      const coords = await geocodePostCode(searchPostCode);
      query.latitude = coords.latitude;
      query.longitude = coords.longitude;
      if (!query.radius) {
        query.radius = 100;
      }
    } catch (error) {
      console.error("[UserService] Geocoding in getAllUsers failed:", error);
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;
      return {
        data: [],
        pagination: {
          total: 0,
          totalData: 0,
          page,
          limit,
          totalPage: 0,
        },
      };
    }
  } else {
    // If admin explicitly passes postCode in query string for filtering, geocode it optionally
    if (query.postCode) {
      try {
        const coords = await geocodePostCode(query.postCode as string);
        query.latitude = coords.latitude;
        query.longitude = coords.longitude;
        if (!query.radius) {
          query.radius = 100;
        }
      } catch (error) {
        console.error("[UserService] Admin optional geocoding failed:", error);
      }
    }
  }

  // ✅ Force sort by isPromoted first, then Rating, then user preference
  const isProviderSearch = query.role === "PROVIDER";
  if (isProviderSearch) {
    const userSort = (query.sort as string) || '-createdAt';
    query.sort = `-isPromoted -review.averageRating ${userSort}`;
  }

  const selectedFields = isProviderSearch
    ? "fullName email phone profilePicture status review role providerProfile isPromoted createdAt"
    : "fullName email phone profilePicture status review role createdAt";

  const userQueryBuilder = new QueryBuilder(
    User.find({ status: { $ne: "deleted" } }).select(selectedFields),
    query
  )
    .geolocation()
    .providerFilter()
    .filter()
    .search(["fullName", "email", "phone", "providerProfile.serviceCategory", "providerProfile.skills"])
    .sort()
    .paginate();

  // Execute user query, pagination count, and overall total count in parallel
  const [users, paginateInfo, totalUsers] = await Promise.all([
    userQueryBuilder.modelQuery.lean(),
    userQueryBuilder.getPaginationInfo(),
    User.countDocuments({ status: { $ne: "deleted" } })
  ]);

  return { data: users, pagination: { ...paginateInfo, totalData: totalUsers } };
};

const updateProfileToDB = async (
  user: JwtPayload,
  payload: Partial<IUser>
): Promise<Partial<IUser | null>> => {
  const { id } = user;

  const isExistUser = await User.findById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // ✅ Fix for profilePicture field name
  if (payload.profilePicture && isExistUser.profilePicture) {
    unlinkFile(isExistUser.profilePicture);
  }

  // Update residentialAddress subdocument properties
  if (payload.residentialAddress) {
    if (!isExistUser.residentialAddress) {
      isExistUser.residentialAddress = payload.residentialAddress as any;
    } else {
      for (const [key, value] of Object.entries(payload.residentialAddress)) {
        // @ts-ignore
        isExistUser.residentialAddress[key] = value;
      }
    }
    delete payload.residentialAddress;
  }

  // Update fields
  if (payload.providerProfile) {
    if (!isExistUser.providerProfile) {
      // If profile doesn't exist, create it with payload
      isExistUser.providerProfile = payload.providerProfile as any;
    } else {
      // We iterate keys to ensure we update the subdocument properties
      for (const [key, value] of Object.entries(payload.providerProfile)) {
        // @ts-ignore
        isExistUser.providerProfile[key] = value;
      }
    }
    delete payload.providerProfile;
  }

  // Use Mongoose set for remaining top-level fields
  if (Object.keys(payload).length > 0) {
    isExistUser.set(payload);
  }

  // Save triggers the pre-save hook for validation
  const updatedUser = await isExistUser.save();

  // Invalidate profile cache
  await delCache(`cache:user:profile:${id}`);

  return updatedUser;
};

const getSingleUser = async (id: string): Promise<any> => {
  const cacheKey = `cache:user:profile:${id}`;
  const cachedProfile = await getCache<any>(cacheKey);
  if (cachedProfile) {
    return cachedProfile;
  }

  const user = await User.findById(id).select("-authentication");
  if (!user) return null;

  const stats = await getUserStats(user);
  const responseData = {
    ...user.toObject(),
    ...stats
  };

  await setCache(cacheKey, responseData, 900); // 15 mins TTL
  return responseData;
};

const getmyProfile = async (user: JwtPayload): Promise<any> => {
  const { id } = user;
  const cacheKey = `cache:user:profile:${id}`;
  const cachedProfile = await getCache<any>(cacheKey);
  if (cachedProfile) {
    return cachedProfile;
  }

  const result = await User.findById(id).select("-authentication");
  if (!result) return null;

  const stats = await getUserStats(result);
  const responseData = {
    ...result.toObject(),
    ...stats
  };

  await setCache(cacheKey, responseData, 900); // 15 mins TTL
  return responseData;
};

// Calculates statistics for user profile
async function getUserStats(user: any) {
  const userId = user._id;
  const role = user.role;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const paidStatuses = ["review_pending", "provider_review_pending", "customer_review_pending", "completed"];

  if (role === "PROVIDER") {
    const [
      totalAppointments,
      totalAppointmentsThisMonth,
      earningResult,
      monthlyEarningResult,
      last10Reviews
    ] = await Promise.all([
      Appointment.countDocuments({ provider: userId }),
      Appointment.countDocuments({
        provider: userId,
        createdAt: { $gte: startOfMonth }
      }),
      Appointment.aggregate([
        { $match: { provider: new Types.ObjectId(userId), status: { $in: paidStatuses } } },
        { $group: { _id: null, total: { $sum: "$totalCost" } } }
      ]),
      Appointment.aggregate([
        {
          $match: {
            provider: new Types.ObjectId(userId),
            status: { $in: paidStatuses },
            createdAt: { $gte: startOfMonth }
          }
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } }
      ]),
      Review.find({ reviewee: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("reviewer", "fullName profilePicture")
        .lean()
    ]);

    const totalEarning = earningResult.length > 0 ? earningResult[0].total : 0;
    const totalEarnThisMonth = monthlyEarningResult.length > 0 ? monthlyEarningResult[0].total : 0;

    return {
      totalAppointments,
      totalAppointmentsThisMonth,
      totalEarning,
      totalEarnThisMonth,
      last10Reviews
    };
  } else if (role === "CUSTOMER") {
    const [
      totalAppointmentsBooked,
      totalAppointmentsThisMonth,
      spendResult,
      monthlySpendResult,
      last10Reviews
    ] = await Promise.all([
      Appointment.countDocuments({ customer: userId }),
      Appointment.countDocuments({
        customer: userId,
        createdAt: { $gte: startOfMonth }
      }),
      Appointment.aggregate([
        { $match: { customer: new Types.ObjectId(userId), status: { $in: paidStatuses } } },
        { $group: { _id: null, total: { $sum: "$totalCost" } } }
      ]),
      Appointment.aggregate([
        {
          $match: {
            customer: new Types.ObjectId(userId),
            status: { $in: paidStatuses },
            createdAt: { $gte: startOfMonth }
          }
        },
        { $group: { _id: null, total: { $sum: "$totalCost" } } }
      ]),
      Review.find({ reviewee: userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("reviewer", "fullName profilePicture")
        .lean()
    ]);

    const totalSpend = spendResult.length > 0 ? spendResult[0].total : 0;
    const totalSpendThisMonth = monthlySpendResult.length > 0 ? monthlySpendResult[0].total : 0;

    return {
      totalAppointmentsBooked,
      totalAppointmentsThisMonth,
      totalSpend,
      totalSpendThisMonth,
      last10Reviews
    };
  }

  return {};
}


// update user status
const updateUserStatusInDB = async (userId: string, status: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User doesn't exist!");
  }

  const validStatuses = ['pending', 'active', 'rejected', 'suspended', 'blocked', 'deleted'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`);
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { status },
    { new: true }
  ).select('-authentication');

  await delCache(`cache:user:profile:${userId}`);

  return updatedUser;
};

// delete user (soft delete)
const deleteUserFromDB = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User doesn't exist!");
  }

  if (user.status === 'deleted') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User is already deleted');
  }

  await User.findByIdAndUpdate(
    userId,
    { status: 'deleted' },
    { new: true }
  );

  await delCache(`cache:user:profile:${userId}`);

  return { message: 'User deleted successfully' };
};

const updateFcmTokenToDB = async (user: JwtPayload, token: string) => {
  const { id } = user;
  const result = await User.findByIdAndUpdate(
    id,
    { fcmToken: token },
    { new: true }
  );
  return result;
};

export const UserService = {
  getAllUsers,
  updateProfileToDB,
  getSingleUser,
  getmyProfile,
  updateUserStatusInDB,
  deleteUserFromDB,
  updateFcmTokenToDB
};
