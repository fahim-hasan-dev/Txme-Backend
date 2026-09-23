import { Model } from "mongoose";
import { USER_ROLES } from "../../../enums/user";
import { IProviderLanguage } from "../../../enums/languages";

interface IAuthenticationProps {
  purpose:
  | "email_verify"
  | "phone_verify"
  | "login_otp"
  | "password_reset"
  | "number_change"
  | "biometric_enable";
  channel: "email" | "phone";
  oneTimeCode: number;
  expireAt: Date;
  newPhone?: string;

}



interface IWorkingHours {
  startTime: string;
  endTime: string;
  duration: number;
}

interface IProviderProfile {
  serviceCategory: string[];
  designation?: string;
  workingHours: IWorkingHours;
  workingDays: ("Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday")[];
  unavailableDates?: Date[];
  hourlyRate?: number;
  certifications?: string[];
  experience?: number;
  skills?: string[];
  languages?: IProviderLanguage[];
  workLocation?: {
    postCode?: string;
    city?: string;
    radius?: number;
    latitude?: number;
    longitude?: number;
    address?: string;
  }
}

export interface IUser extends Document {
  email: string;
  phone?: string;
  fullName?: string;
  dateOfBirth?: Date;
  role?: USER_ROLES;
  gender?: string;
  nationality?: string;
  profilePicture?: string;
  countryOfResidence?: string;
  residentialAddress?: {
    address?: string;
    city?: string;
    postCode?: string;
    latitude?: number;
    longitude?: number;
  };
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
  maritalStatus?: string;
  review: {
    averageRating: number;
    totalReviews: number;
  };
  authentication?: IAuthenticationProps;
  idDocuments?: string[];
  addressDocuments?: string[];
  biometricEnabled?: boolean;
  status?: "pending" | "active" | "rejected" | "suspended" | "blocked" | "deleted";
  bio?: string;
  providerProfile?: IProviderProfile;
  stripeAccountId?: string;
  isStripeConnected?: boolean;
  fcmToken?: string;

  isIdentityVerified?: boolean;
  diditSessionId?: string;
  isPromoted?: boolean;
  promotionExpiry?: Date;
}

export type UserModal = {
  isExistUserById(id: string): any;
  isExistUserByEmail(email: string): any;
  isMatchPassword(password: string, hashPassword: string): boolean;
} & Model<IUser>;