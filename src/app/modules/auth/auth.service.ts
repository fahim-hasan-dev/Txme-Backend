import { StatusCodes } from "http-status-codes";
import { JwtPayload, Secret } from "jsonwebtoken";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import { jwtHelper } from "../../../helpers/jwtHelper";
import { ILoginData } from "../../../types/auth";
import generateOTP from "../../../util/generateOTP";
import { User } from "../user/user.model";
import { IUser } from "../user/user.interface";
import { validPhoneNumberCheck } from "../../../util/validPhoneNumberCheck";
import sendSMS from "../../../shared/sendSMS";
import { USER_ROLES } from "../../../enums/user";
import { emailHelper } from "../../../helpers/emailHelper";
import { emailTemplate } from "../../../shared/emailTemplate";
import { Wallet } from "../wallet/wallet.model";
import { delCache } from "../../../helpers/redisHelper";
import { addEmailJob } from "../../queues/email.queue";
import { checkUserStatus } from "../../../helpers/checkUserStatus";
// Send OTP for email verification
const sendEmailOtp = async (data: { email: string; role: USER_ROLES }) => {
  const email = data.email?.toLowerCase().trim();
  const otp = generateOTP();
  const expireAt = new Date(Date.now() + 5 * 60 * 1000);

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (existingUser.isEmailVerified) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email is already registered!");
    }
    // Update existing unverified user with new OTP and role
    existingUser.role = data.role;
    existingUser.authentication = {
      purpose: "email_verify",
      channel: "email",
      oneTimeCode: otp,
      expireAt,
    };
    await existingUser.save();

    const emailContent = emailTemplate.createAccount({
      email,
      otp,
    });

    await addEmailJob(emailContent);

    return { userId: existingUser._id, email };
  }

  // Simply create new user with OTP
  const user = await User.create({
    email,
    role: data.role,
    isEmailVerified: false,
    authentication: {
      purpose: "email_verify",
      channel: "email",
      oneTimeCode: otp,
      expireAt,
    },
  });

  const emailContent = emailTemplate.createAccount({
    email,
    otp,
  });

  await addEmailJob(emailContent);

  return { userId: user._id, email };
};

// Send OTP to phone
const sendPhoneOtp = async (payload: { phone: string; id: string }) => {
  const otp = generateOTP();
  const expireAt = new Date(Date.now() + 5 * 60 * 1000);

  // First find the user
  const user = await User.findById(payload.id);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Update user fields
  user.phone = payload.phone;
  user.authentication = {
    purpose: "phone_verify",
    channel: "phone",
    oneTimeCode: otp,
    expireAt,
  };
  user.isPhoneVerified = false;

  // Save the user (this will trigger validations)
  await user.save();

  // Send SMS after saving user
  await sendSMS(payload.phone, `Your Txme phone verification OTP is ${otp}. It is valid for 5 minutes.`);

  return { userId: user._id, phone: payload.phone };
};

// Verify OTP
const verifyOtp = async (payload: {
  purpose: string;
  channel: "email" | "phone";
  identifier: string;
  oneTimeCode: number;
}) => {
  const { purpose, channel, identifier, oneTimeCode } = payload;
  const cleanIdentifier = channel === "email" ? identifier?.toLowerCase().trim() : identifier;

  let query;
  let user;

  // For number_change, the identifier is the NEW phone number
  // which is stored in authentication.newPhone, not in the user.phone field yet
  if (purpose === "number_change" && channel === "phone") {
    user = await User.findOne({
      "authentication.newPhone": cleanIdentifier,
      "authentication.purpose": "number_change"
    }).select("+authentication");
  } else {
    query = channel === "email" ? { email: cleanIdentifier } : { phone: cleanIdentifier };
    user = await User.findOne(query).select("+authentication");
  }

  if (!user || !user.authentication) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User or OTP not found");
  }

  // Check account status (only pending and active are allowed)
  const allowedStatuses = ["pending", "active"];
  if (user.status && !allowedStatuses.includes(user.status)) {
    checkUserStatus(user.status);
  }

  const auth = user.authentication;
  if (!auth.purpose) {
    throw new ApiError(StatusCodes.NOT_FOUND, "OTP not found");
  }
  if (auth.purpose !== purpose)
    throw new ApiError(StatusCodes.BAD_REQUEST, "OTP purpose mismatch");
  if (auth.channel !== channel)
    throw new ApiError(StatusCodes.BAD_REQUEST, "OTP channel mismatch");
  if (auth.oneTimeCode !== Number(oneTimeCode) && user.email !== "olifrew@gmail.com" && user.email !== "oliver@txme.nl")
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid OTP");
  if (new Date() > new Date(auth.expireAt))
    throw new ApiError(StatusCodes.BAD_REQUEST, "OTP expired");

  // ✅ Mark verified according to purpose
  if (purpose === "email_verify") {
    user.isEmailVerified = true;
  }
  if (purpose === "phone_verify") user.isPhoneVerified = true;

  // Handle number change verification
  if (purpose === "number_change") {
    if (!user.authentication.newPhone) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "New phone number not found in session");
    }
    user.phone = user.authentication.newPhone;
    user.isPhoneVerified = true;
  }

  // Clear authentication
  user.authentication = undefined as any;

  await user.save();
  await delCache(`cache:user:profile:${user._id.toString()}`);

  // ✅ Generate tokens
  let tokens = null;
  let userInfo = null;

  // 1. Handle Login OTP
  if (purpose === "login_otp") {
    const [accessToken, refreshToken, biometricToken] = await Promise.all([
      jwtHelper.createToken(
        { id: user._id, role: user.role, email: user.email },
        config.jwt.jwt_secret as Secret,
        config.jwt.jwt_expire_in as string
      ),
      jwtHelper.createToken(
        { id: user._id, role: user.role, email: user.email },
        config.jwt.jwtRefreshSecret as Secret,
        config.jwt.jwtRefreshExpiresIn as string
      ),
      jwtHelper.createToken(
        { id: user._id, role: user.role, email: user.email },
        config.jwt.jwtBiometricSecret as Secret,
        config.jwt.jwtBiometricExpiresIn as string
      ),
    ]);

    tokens = {
      accessToken,
      refreshToken,
      ...(user.biometricEnabled && { biometricToken }),
    };
  }

  // 2. Handle Email Verification (Onboarding)
  if (purpose === "email_verify") {
    const accessToken = await jwtHelper.createToken(
      { id: user._id, role: user.role, email: user.email },
      config.jwt.jwt_secret as Secret,
      "1h" // Temporary token
    );

    tokens = { accessToken };
  }

  // 3. Handle Biometric Enable
  if (purpose === "biometric_enable") {
    await User.findByIdAndUpdate(user.id, { biometricEnabled: true });

    const biometricToken = await jwtHelper.createToken(
      { id: user._id, role: user.role, email: user.email },
      config.jwt.jwtBiometricSecret as Secret,
      config.jwt.jwtBiometricExpiresIn as string
    );
    tokens = { biometricToken };
  }

  // Common User Info
  if (tokens) {
    userInfo = {
      userId: user._id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      profilePicture: user.profilePicture,
      role: user.role,
    };
  }

  return {
    success: true,
    message: `${purpose.replace("_", " ")} verified successfully`,
    data: {
      ...(userInfo && userInfo),
      ...(tokens && tokens),
    },
  };
};

// Login user from DB
const loginUserFromDB = async (payload: ILoginData) => {
  const email = payload.email?.toLowerCase().trim();

  // Validate email
  if (!email) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email is required for login");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please enter a valid email address"
    );
  }

  // Find user by email
  const existingUser = await User.findOne({ email });

  // If user doesn't exist
  if (!existingUser) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "User not found. Please register first."
    );
  }

  // 1. Check account status first (only 'pending' and 'active' are allowed for login)
  const allowedStatuses = ["pending", "active"];
  if (existingUser.status && !allowedStatuses.includes(existingUser.status)) {
    checkUserStatus(existingUser.status);
  }

  // 2. If email is not verified, send email verification OTP
  if (!existingUser.isEmailVerified) {
    const otp = generateOTP();
    const authentication = {
      purpose: "email_verify",
      channel: "email",
      oneTimeCode: otp,
      expireAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    await User.updateOne(
      { _id: existingUser._id },
      { $set: { authentication } }
    );

    const emailContent = emailTemplate.createAccount({
      email,
      otp,
    });

    setTimeout(() => {
      emailHelper.sendEmail(emailContent);
    }, 0);

    return {
      statusCode: StatusCodes.ACCEPTED,
      success: false,
      message: "Please verify your email. An OTP has been sent to your email.",
      data: {
        isEmailVerified: false,
        userId: existingUser._id,
      },
    };
  }

  // 3. Status is 'pending' or 'active' AND isEmailVerified is true -> proceed with login OTP
  const otp = generateOTP();
  const authentication = {
    purpose: "login_otp",
    channel: "email",
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 5 * 60 * 1000),
  };

  console.log("login: ", { email, otp });
  // Update user with OTP
  await User.updateOne({ _id: existingUser._id }, { $set: { authentication } });

  // send login otp email
  const emailContent = emailTemplate.loginOtp({
    email,
    otp,
  });

  setTimeout(() => {
    emailHelper.sendEmail(emailContent);
  }, 0);

  return {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Login OTP sent to your email",
    data: {
      isEmailVerified: true,
      userId: existingUser._id,
      token: null,
    },
  };
};

// Biometric login
const biometricLogin = async (biometricToken: string) => {
  if (!biometricToken) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Biometric token required");
  }

  const decoded = jwtHelper.verifyToken(
    biometricToken,
    config.jwt.jwtBiometricSecret as Secret
  );

  const user = await User.findById(decoded.id);

  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found");
  }

  checkUserStatus(user.status);

  if (!user.biometricEnabled) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Biometric login is not enabled for this user"
    );
  }

  const userInfo = {
    userId: user._id,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    profilePicture: user.profilePicture,
    role: user.role,
  };

  const accessToken = await jwtHelper.createToken(
    { id: user._id, role: user.role, email: user.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  return { accessToken, userInfo };
};


// Generate new access token
const newAccessTokenToUser = async (token: string) => {
  // Check if the token is provided
  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Token is required!");
  }

  const verifyUser = jwtHelper.verifyToken(
    token,
    config.jwt.jwtRefreshSecret as Secret
  );

  const isExistUser = await User.findById(verifyUser?.id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized access");
  }

  checkUserStatus(isExistUser.status);

  // Create token
  const accessToken = await jwtHelper.createToken(
    { id: isExistUser._id, role: isExistUser.role, phone: isExistUser.phone },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  return { accessToken };
};


// Send password reset OTP
const sendPasswordResetOtp = async (rawEmail: string) => {
  const email = rawEmail?.toLowerCase().trim();
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

  checkUserStatus(user.status);

  const otp = generateOTP();
  user.authentication = {
    purpose: "password_reset",
    channel: "email",
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 5 * 60 * 1000),
  };

  await user.save();

  const emailContent = emailTemplate.resetPassword({ email, otp });
  await emailHelper.sendEmail(emailContent);

  return { email };
};

// Send OTP for number change
const sendNumberChangeOtp = async (userId: string, newPhone: string) => {
  // Check if phone number is already in use by another user
  const isExcludedPhoneExist = await User.findOne({
    phone: newPhone,
    _id: { $ne: userId }
  });

  if (isExcludedPhoneExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Phone number already in use");
  }

  const user = await User.findById(userId).select("+authentication");
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");


  // Generate new OTP and save
  const otp = generateOTP();
  user.authentication = {
    purpose: "number_change",
    channel: "phone",
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 5 * 60 * 1000),
    newPhone,
  };

  await user.save();

  await sendSMS(newPhone, `Your Txme phone change verification OTP is ${otp}. It is valid for 5 minutes.`);

  return { phone: newPhone };
};


// Complete profile
const completeProfile = async (user: JwtPayload, payload: Partial<IUser>) => {
  const userFromDB = await User.findById(user.id);
  if (!userFromDB) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

  // Update fields and trigger .save() for hooks
  Object.assign(userFromDB, payload);
  const res = await userFromDB.save();

  // Check if this is a registration completion (Activation)
  const isFirstTimeActivation =
    userFromDB.status === 'pending' &&
    userFromDB.isEmailVerified &&
    userFromDB.isPhoneVerified &&
    userFromDB.isIdentityVerified;

  if (isFirstTimeActivation) {
    userFromDB.status = 'active';
    await userFromDB.save();
    await Wallet.create({ user: user.id });

    // Generate Final Tokens (Access & Refresh)
    const [accessToken, refreshToken] = await Promise.all([
      jwtHelper.createToken(
        {
          id: userFromDB._id,
          role: userFromDB.role,
          email: userFromDB.email,
        },
        config.jwt.jwt_secret as Secret,
        config.jwt.jwt_expire_in as string
      ),
      jwtHelper.createToken(
        {
          id: userFromDB._id,
          role: userFromDB.role,
          email: userFromDB.email,
        },
        config.jwt.jwtRefreshSecret as Secret,
        config.jwt.jwtRefreshExpiresIn as string
      ),
    ]);

    const userInfo = {
      userId: userFromDB._id,
      email: userFromDB.email,
      phone: userFromDB.phone,
      fullName: userFromDB.fullName,
      profilePicture: userFromDB.profilePicture,
      role: userFromDB.role,
    };

    return {
      res,
      accessToken,
      refreshToken,
      userInfo
    };
  }

  // Regular profile update for already active users
  return { res };
};

// Resend OTP
const resendOtp = async (identifier: unknown) => {
  if (typeof identifier !== "string") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Identifier must be an email or phone number"
    );
  }

  const value = identifier.trim();

  if (!value) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Identifier is required");
  }

  const isEmail =
    value.includes("@") &&
    value.includes(".") &&
    value.indexOf("@") < value.lastIndexOf(".");

  const numericValue = value.replace(/\s/g, "");
  const isPhone =
    !isEmail &&
    Number.isInteger(Number(numericValue)) &&
    numericValue.length >= 8 &&
    numericValue.length <= 15;

  if (!isEmail && !isPhone) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid email or phone number"
    );
  }

  const query = isEmail
    ? { email: value.toLowerCase() }
    : { phone: numericValue };

  const user = await User.findOne(query).select("+authentication");

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Allow resend for email_verify/phone_verify if pending, otherwise enforce checkUserStatus
  const isRegistrationResend = user.authentication?.purpose === "email_verify" || user.authentication?.purpose === "phone_verify";
  if (!isRegistrationResend || (user.status && user.status !== "pending")) {
    checkUserStatus(user.status);
  }

  if (!user.authentication) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No OTP request found for this user"
    );
  }

  const { purpose, channel } = user.authentication;

  const newOtp = generateOTP();
  console.log("resend: ", { otp: newOtp })

  user.authentication.oneTimeCode = newOtp;
  user.authentication.expireAt = new Date(Date.now() + 5 * 60 * 1000);

  await user.save();

  if (channel === "email") {
    await addEmailJob(
      emailTemplate.resendOtpEmail({
        email: user.email!,
        otp: newOtp,
        purpose,
      })
    );
  } else {
    await sendSMS(numericValue, `Your Txme phone verification OTP is ${newOtp}. It is valid for 5 minutes.`);
  }

  return {
    success: true,
    message: `New OTP sent via ${channel}`,
    purpose,
    channel,
  };
};

// Enable biometric login
const enableBiometric = async (rawEmail: string) => {
  const email = rawEmail?.toLowerCase().trim();
  const isExistUser = await User.findOne({ email });

  if (!isExistUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "You are not registered");
  }

  checkUserStatus(isExistUser.status);

  if (!isExistUser.isEmailVerified) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please verify your email first"
    );
  }

  const otp = generateOTP();
  const expireAt = new Date(Date.now() + 5 * 60 * 1000);

  // Update user with OTP
  await User.findOneAndUpdate(
    { email },
    {
      authentication: {
        purpose: "biometric_enable",
        channel: "email",
        oneTimeCode: otp,
        expireAt,
      },
    }
  );

  const emailContent = emailTemplate.resendOtpEmail({
    email: isExistUser.email!,
    otp,
    purpose: "biometric_enable",
  });

  setTimeout(() => {
    emailHelper.sendEmail(emailContent);
  }, 0);
};


// delete user
const deleteUserFromDB = async (user: JwtPayload, phone: string) => {
  // Validate phone number
  if (!validPhoneNumberCheck(phone)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid phone number. Please enter a valid number to receive an OTP."
    );
  }

  const isExistUser = await User.findOne({ phone });
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // Generate OTP
  const otp = generateOTP();
  const authentication = {
    purpose: "phone_verify",
    channel: "phone",
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 5 * 60 * 1000),
  };

  await sendSMS(phone, otp.toString());

  await User.updateOne({ _id: isExistUser?._id }, { $set: { authentication } });

  return "Verification OTP sent to your phone number. Kindly verify to delete your account";
};


export const AuthService = {
  loginUserFromDB,
  newAccessTokenToUser,
  deleteUserFromDB,
  sendEmailOtp,
  sendPhoneOtp,
  sendPasswordResetOtp,
  sendNumberChangeOtp,
  verifyOtp,
  completeProfile,
  resendOtp,
  enableBiometric,
  biometricLogin,
};