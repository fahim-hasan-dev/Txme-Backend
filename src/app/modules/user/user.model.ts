import { model, Schema } from "mongoose";
import { USER_ROLES } from "../../../enums/user";
import { IUser, UserModal } from "./user.interface";
import bcrypt from "bcrypt";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import config from "../../../config";
import { Wallet } from "../wallet/wallet.model";
import { PROVIDER_LANGUAGES } from "../../../enums/languages";
import { geocodePostCode } from "../../../util/geocoding.util";

// Provider Profile Sub-document Schema
const providerProfileSchema = new Schema(
  {
    serviceCategory: {
      type: [String],
      required: true,
    },
    designation: { type: String },
    workingHours: {
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      duration: { type: Number, required: true, default: 2 },
    },
    workingDays: [
      {
        type: String,
        required: true,
        enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      },
    ],
    unavailableDates: [
      {
        type: Date,
      }
    ],
    hourlyRate: { type: Number, required: true },
    certifications: [{ type: String }],
    experience: { type: Number },
    skills: [{ type: String }],
    languages: [{
      type: String,
      enum: PROVIDER_LANGUAGES,
    }],
    workLocation: {
      postCode: { type: String },
      city: { type: String },
      radius: { type: Number },
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
    },
  },
  { _id: false, timestamps: false }
);

// Main User Schema
const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    fullName: { type: String },
    dateOfBirth: { type: Date },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: false,
    },
    gender: { type: String },
    nationality: { type: String },
    countryOfResidence: { type: String },
    profilePicture: { type: String },
    residentialAddress: {
      address: { type: String, required: false },
      city: { type: String, required: false },
      postCode: { type: String, required: false },
      latitude: { type: Number, required: false },
      longitude: { type: Number, required: false },
    },
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    maritalStatus: { type: String },
    biometricEnabled: {
      type: Boolean,
      default: false,
    },
    idDocuments: [
      {
        type: String,
        required: false,
      },
    ],
    addressDocuments: [
      {
        type: String,
        required: false,
      },
    ],
    status: {
      type: String,
      enum: [
        "pending",
        "active",
        "rejected",
        "suspended",
        "blocked",
        "deleted",
      ],
      default: "pending",
    },

    providerProfile: {
      type: providerProfileSchema,
      required: false
    },
    review: {
      averageRating: { type: Number, default: 0 },
      totalReviews: { type: Number, default: 0 },
    },
    bio: { type: String },

    authentication: {
      purpose: {
        type: String,
        enum: [
          "email_verify",
          "phone_verify",
          "login_otp",
          "password_reset",
          "number_change",
          "biometric_enable",
        ],
      },
      channel: {
        type: String,
        enum: ["email", "phone"],
      },
      oneTimeCode: { type: Number },
      expireAt: { type: Date },
      newPhone: { type: String, required: false },
    },
    stripeAccountId: { type: String, required: false },
    isStripeConnected: { type: Boolean, default: false },
    fcmToken: { type: String, required: false },

    isIdentityVerified: { type: Boolean, default: false },
    diditSessionId: { type: String, required: false },
    isPromoted: { type: Boolean, default: false },
    promotionExpiry: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// Indexes for high performance querying
userSchema.index({ role: 1, status: 1 });
userSchema.index({ "providerProfile.serviceCategory": 1 });
userSchema.index({ "providerProfile.workLocation.latitude": 1, "providerProfile.workLocation.longitude": 1 });

// pre save hook
userSchema.pre("save", async function (next) {
  const user = this as IUser & { isModified: (path: string) => boolean };

  // Handle Geocoding for Provider Work Location PostCode
  if (user.providerProfile?.workLocation?.postCode && user.isModified('providerProfile.workLocation.postCode')) {
    try {
      console.log(`[UserModel] Detected postCode change: ${user.providerProfile.workLocation.postCode}. Fetching coordinates...`);
      const coords = await geocodePostCode(user.providerProfile.workLocation.postCode);

      // We must check again if providerProfile still exists (though unlikely to disappear during hook)
      if (user.providerProfile && user.providerProfile.workLocation) {
        user.providerProfile.workLocation.latitude = coords.latitude;
        user.providerProfile.workLocation.longitude = coords.longitude;
        user.providerProfile.workLocation.address = coords.address;
        console.log(`[UserModel] Successfully geocoded to: ${coords.latitude}, ${coords.longitude}`);
      }
    } catch (error: any) {
      console.error(`[UserModel] Geocoding failed: ${error.message}`);
      return next(error);
    }
  }
  next();
});

userSchema.pre("save", function (next) {
  if (this.providerProfile) {
    const profile = this.providerProfile;

    if (!profile.serviceCategory || profile.serviceCategory.length === 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "At least one service category is required for providers"
        )
      );
    }

    if (
      !profile.workingHours?.startTime ||
      !profile.workingHours?.endTime ||
      !profile.workingHours?.duration ||
      !profile.workingDays?.length
    ) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Complete working hours information is required for providers"
        )
      );
    }

    // Validate working hours time format and same-day constraint
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(profile.workingHours.startTime) || !timeRegex.test(profile.workingHours.endTime)) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid time format. Please use HH:MM (24-hour format)."
        )
      );
    }

    const [startH, startM] = profile.workingHours.startTime.split(":").map(Number);
    const [endH, endM] = profile.workingHours.endTime.split(":").map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);

    if (totalMinutes <= 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "End time must be after start time (same day only)."
        )
      );
    }

    const slotDurationMinutes = profile.workingHours.duration * 60;
    if (slotDurationMinutes <= 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Slot duration must be positive."
        )
      );
    }

    if (totalMinutes < slotDurationMinutes) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Shift duration must be at least as long as a slot."
        )
      );
    }

    if (totalMinutes % slotDurationMinutes !== 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          `Shift duration (${totalMinutes / 60}h) is not perfectly divisible by slot duration (${profile.workingHours.duration}h).`
        )
      );
    }

    if (!profile.hourlyRate || profile.hourlyRate <= 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Hourly rate must be a positive number."
        )
      );
    }

    if (profile.experience !== undefined && profile.experience < 0) {
      return next(
        new ApiError(
          StatusCodes.BAD_REQUEST,
          "Experience cannot be negative."
        )
      );
    }
  }
  next();
});


// ✅ Index for provider profile searches
userSchema.index({
  "providerProfile.serviceCategory": 1,
});

// ✅ Index for workLocation coordinates
userSchema.index({
  "providerProfile.workLocation.latitude": 1,
  "providerProfile.workLocation.longitude": 1,
});

// ALL OTHER STATICS AND HOOKS REMAIN EXACTLY SAME
userSchema.statics.isExistUserById = async (id: string) => {
  const isExist = await User.findById(id);
  return isExist;
};

userSchema.statics.isExistUserByEmail = async (email: string) => {
  const isExist = await User.findOne({ email: email?.toLowerCase().trim() });
  return isExist;
};

userSchema.statics.isMatchPassword = async (
  password: string,
  hashPassword: string
): Promise<boolean> => {
  return await bcrypt.compare(password, hashPassword);
};

userSchema.pre("save", async function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  if (this.isNew) {
    const email = this.email;

    if (email) {
      const existingUser = await User.findOne({
        email: email,
      });

      if (existingUser) {
        return next(
          new ApiError(StatusCodes.BAD_REQUEST, "Email already exists!")
        );
      }
    }
  }
  next();
});

export const User = model<IUser, UserModal>("User", userSchema);