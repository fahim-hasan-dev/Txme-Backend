import { ADMIN_ROLES, USER_ROLES } from "../../../enums/user";
import { Appointment } from "./appointment.model";
import { User } from "../user/user.model";
import { generateDailySlots } from "../../../util/generateDailySlots";
import { checkWalletSetting } from "../../../helpers/checkSetting";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { WalletService } from "../wallet/wallet.service";
import { NotificationService } from "../notification/notification.service";
import { JwtPayload } from "jsonwebtoken";
import QueryBuilder from "../../../helpers/QueryBuilder";
import { delCache } from "../../../helpers/redisHelper";
import { handleAppointmentCompletion, sendStatusNotification } from "../../../helpers/appointmentHelper";
import { formatTime } from "../../../util/formatTime";
export const createAppointment = async (customerId: string, data: any) => {
  const { provider, date, startTime, endTime, service, paymentMethod, note } = data;

  // Validate provider exists and has provider profile
  const providerUser = await User.findOne({
    _id: provider,
    "providerProfile": { $exists: true }
  });

  if (!providerUser?.providerProfile) {
    throw new Error("Provider profile not found");
  }

  // Check if provider is available on the requested date
  const requestedDate = new Date(date);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = days[requestedDate.getUTCDay()] as any;

  if (!providerUser.providerProfile.workingDays.includes(dayOfWeek)) {
    throw new Error("Provider not available on this day");
  }

  // Check if provider has set this specific date as unavailable
  const isUnavailableDate = providerUser.providerProfile.unavailableDates?.some(
    (d: Date) => d.toISOString().split('T')[0] === requestedDate.toISOString().split('T')[0]
  );

  if (isUnavailableDate) {
    throw new Error("Provider is unavailable on this date");
  }

  // Generate valid slots for the provider
  const validSlots = generateDailySlots(providerUser.providerProfile.workingHours, date);

  // Validate the requested slot
  const isValidSlot = validSlots.some(
    slot => slot.startTime === startTime && slot.endTime === endTime
  );

  if (!isValidSlot) {
    throw new Error("Invalid time slot");
  }

  // Check for existing Appointments in the same time slot
  const conflictingAppointment = await Appointment.findOne({
    provider,
    date: requestedDate,
    startTime,
    endTime,
    status: { $in: ["confirmed", "accepted", "in_progress", "awaiting_payment", "paid"] }
  });

  if (conflictingAppointment) {
    throw new Error("This time slot is already booked");
  }

  // Create the Appointment
  const appointment = await Appointment.create({
    customer: customerId,
    provider,
    date: requestedDate,
    startTime,
    endTime,
    service,
    paymentMethod,
    note,
    status: "pending",
    price: providerUser.providerProfile.hourlyRate
  });

  // Send Notification to Provider
  console.log(`[AppointmentService] Triggering notification for New Appointment. Provider: ${provider}`);
  try {
    await NotificationService.insertNotification({
      title: "New Appointment Request",
      message: `You have a new appointment request for ${service} on ${date}`,
      receiver: provider,
      referenceId: appointment._id,
      screen: "APPOINTMENT",
      type: "USER"
    });
    console.log(`[AppointmentService] Notification inserted successfully for provider`);
  } catch (error) {
    console.error(`[AppointmentService] Failed to insert new appointment notification:`, error);
  }

  // Invalidate customer and provider profile caches for real-time stats update
  await delCache([`cache:user:profile:${customerId}`, `cache:user:profile:${provider}`]);

  return appointment;
};


export const updateAppointmentStatus = async (
  appointmentId: string,
  status: string,
  userId: string,
  userRole: string,
  reason?: string,
  data?: any
) => {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw new ApiError(StatusCodes.NOT_FOUND, "Appointment not found");

  // 1. Permission Check
  const isCustomer = userRole?.toUpperCase() === USER_ROLES.CUSTOMER && appointment.customer?.toString() === userId?.toString();
  const isProvider = userRole?.toUpperCase() === USER_ROLES.PROVIDER && appointment.provider?.toString() === userId?.toString();

  if (!isCustomer && !isProvider) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Permission denied! Only the assigned user can update this.");
  }

  // 2. Status Transition Validation
  const currentStatus = appointment.status;

  // New strict transition rules
  const allowedTransitions: Record<string, string[]> = {
    pending: ["accepted", "rejected", "cancelled"],
    accepted: ["in_progress", "cancelled"],
    in_progress: ["work_completed"],
    work_completed: ["awaiting_payment"],
    awaiting_payment: ["review_pending", "cashPayment"],
    cashPayment: ["cashReceived"],
  };

  // Check if transition is generally allowed
  if (!allowedTransitions[currentStatus]?.includes(status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot move appointment from '${currentStatus}' to '${status}'.`);
  }

  // Role-specific restrictions
  if (status === "cancelled") {
    if (!isCustomer && !isProvider) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Only the assigned customer or provider can cancel this appointment.");
    }
    if (!["pending", "accepted"].includes(currentStatus)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot cancel appointment when it is already '${currentStatus}'.`);
    }
  }

  if (status === "rejected") {
    if (!isProvider) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Only providers can reject appointments.");
    }
    if (currentStatus !== "pending") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Can only reject 'pending' appointments.");
    }
  }

  if (["cancelled", "rejected"].includes(status)) {
    if (!reason) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `A reason is required to ${status} this appointment.`);
    }
    appointment.reason = reason;
  }

  if (["accepted", "in_progress", "work_completed"].includes(status) && !isProvider) {
    throw new ApiError(StatusCodes.FORBIDDEN, `Only providers can set status to '${status}'.`);
  }

  if (["review_pending", "cashPayment"].includes(status) && !isCustomer) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only customers can finalize payment.");
  }

  if (status === "cashReceived" && !isProvider) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only providers can confirm cash receipt.");
  }

  // 3. Status Specific Actions
  if (status === "in_progress") {
    const activeAppointment = await Appointment.findOne({
      provider: appointment.provider,
      status: {
        $in: [
          "in_progress",
          "work_completed",
          "awaiting_payment",
          "review_pending",
          "provider_review_pending",
          "cashPayment",
          "cashReceived",
        ],
      },
      _id: { $ne: appointment._id },
    });

    if (activeAppointment) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Please finalize prior job before initiating a new one"
      );
    }

    appointment.actualStartTime = new Date();
    appointment.status = status;
  }

  if (status === "work_completed") {
    appointment.actualEndTime = new Date();
    await handleAppointmentCompletion(appointment);
    appointment.status = "awaiting_payment";
  }

  if (status === "review_pending") {
    appointment.status = "review_pending";
  }

  if (status === "cashPayment") {
    appointment.paymentMethod = "cash";
    appointment.status = "cashPayment";
  }

  if (status === "cashReceived") {
    appointment.status = "review_pending";
  }

  // Update status for other valid transitions if not already handled
  if (!["work_completed", "in_progress", "review_pending", "cashPayment", "cashReceived"].includes(status)) {
    appointment.status = status as any;
  }

  await appointment.save();

  // 4. Send Notifications
  await sendStatusNotification(appointment, status, isCustomer);

  // 5. Socket notification for real-time update in UI list (sorting)
  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`appointmentUpdate::${appointment.customer.toString()}`, appointment);
    io.emit(`appointmentUpdate::${appointment.provider.toString()}`, appointment);
  }

  // Invalidate profile cache for both customer and provider
  await delCache([
    `cache:user:profile:${appointment.customer.toString()}`,
    `cache:user:profile:${appointment.provider.toString()}`
  ]);

  return appointment;
};


export const getAppointmentById = async (appointmentId: string, user: JwtPayload) => {
  const appointment = await Appointment.findById(appointmentId)
    .populate("customer", "fullName email phone residentialAddress")
    .populate("provider", "fullName email phone providerProfile residentialAddress providerProfile")
    .lean();

  if (!appointment) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Appointment not found");
  }

  // Admin/SuperAdmin can access any appointment
  if (user.role === ADMIN_ROLES.ADMIN || user.role === ADMIN_ROLES.SUPER_ADMIN) {
    return appointment;
  }

  // Users can only access their own appointments
  const customerId = (appointment.customer as any)?._id?.toString() || appointment.customer?.toString();
  const providerId = (appointment.provider as any)?._id?.toString() || appointment.provider?.toString();

  const isCustomer = Boolean(customerId && customerId === user.id);
  const isProvider = Boolean(providerId && providerId === user.id);

  if (!isCustomer && !isProvider) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to view this appointment");
  }

  return appointment;
};



const payWithWallet = async (appointmentId: string, userId: string) => {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Appointment not found");
  }

  if (appointment.status !== 'awaiting_payment') {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Payment not allowed for appointment in ${appointment.status} status`);
  }

  if (!appointment.totalCost || appointment.totalCost <= 0) {
    throw new Error("Invalid appointment cost");
  }

  if (appointment.customer.toString() !== userId) {
    throw new ApiError(StatusCodes.FORBIDDEN, "This is not your appointment");
  }

  // Use WalletService to transfer money from customer to provider
  // Note: We might want a specialized transaction type for appointments, 
  // but for now we follow the existing sendMoney pattern.
  await checkWalletSetting('moneySend');
  await WalletService.sendMoney(
    appointment.customer.toString(),
    appointment.provider.toString(),
    appointment.totalCost,
    appointment._id.toString(),
    "payment"
  );

  // Update appointment status
  appointment.status = 'review_pending';
  await appointment.save();

  // Notify Provider
  console.log(`[AppointmentService] Triggering wallet payment notification for provider: ${appointment.provider}`);
  try {
    await NotificationService.insertNotification({
      title: "Payment Received",
      message: `Payment received for appointment ${appointmentId}. Amount: ${appointment.totalCost}`,
      receiver: appointment.provider,
      referenceId: appointment._id,
      screen: "APPOINTMENT",
      type: "USER"
    });
  } catch (error) {
    console.error(`[AppointmentService] Failed to notify provider:`, error);
  }

  // Notify Customer
  console.log(`[AppointmentService] Triggering wallet payment notification for customer: ${appointment.customer}`);
  try {
    await NotificationService.insertNotification({
      title: "Payment Successful",
      message: `Your wallet payment of ${appointment.totalCost} for appointment ${appointmentId} was successful.`,
      receiver: appointment.customer,
      referenceId: appointment._id,
      screen: "APPOINTMENT",
      type: "USER"
    });
  } catch (error) {
    console.error(`[AppointmentService] Failed to notify customer:`, error);
  }

  // also emit socket for real-time update
  //@ts-ignore
  const io = global.io;
  if (io) {
    io.emit(`appointmentUpdate::${appointment.customer.toString()}`, appointment);
    io.emit(`appointmentUpdate::${appointment.provider.toString()}`, appointment);
  }

  return appointment;
};

const getMyAppointments = async (user: JwtPayload, query: Record<string, any>) => {
  const { role, id } = user;

  if (role?.toUpperCase() === USER_ROLES.CUSTOMER) {
    query.customer = id;
  } else if (role?.toUpperCase() === USER_ROLES.PROVIDER) {
    query.provider = id;
  }

  const appointmentQuery = new QueryBuilder(
    Appointment.find()
      .populate("customer", "fullName email phone profilePicture residentialAddress")
      .populate("provider", "fullName email phone profilePicture residentialAddress providerProfile"),
    query
  )
    .filter()
    .sort((query.sort as string) || "-updatedAt")
    .paginate();

  const result = await appointmentQuery.modelQuery.lean();
  const meta = await appointmentQuery.getPaginationInfo();

  return { result, meta };
};

const getAllAppointmentsFromDB = async (query: Record<string, any>) => {
  const appointmentQuery = new QueryBuilder(
    Appointment.find()
      .populate("customer", "fullName email phone profilePicture residentialAddress")
      .populate("provider", "fullName email phone profilePicture residentialAddress providerProfile"),
    query
  )
    .filter()
    .sort()
    .paginate();

  const result = await appointmentQuery.modelQuery.lean();
  const meta = await appointmentQuery.getPaginationInfo();

  return { result, meta };
};

const getCurrentAppointment = async (user: JwtPayload) => {
  const { role, id } = user;
  const query: Record<string, any> = {
    status: {
      $in: [
        "in_progress",
        "work_completed",
        "awaiting_payment",
        "cashPayment",
        "cashReceived",
        "review_pending",
        "provider_review_pending",
        "customer_review_pending",
      ],
    },
  };

  if (role?.toUpperCase() === USER_ROLES.CUSTOMER) {
    query.customer = id;
  } else if (role?.toUpperCase() === USER_ROLES.PROVIDER) {
    query.provider = id;
  }

  const result = await Appointment.findOne(query)
    .populate("customer", "fullName email phone profilePicture residentialAddress")
    .populate("provider", "fullName email phone profilePicture providerProfile residentialAddress providerProfile")
    .sort("-updatedAt")
    .lean();

  return result;
};


export const AppointmentService = {
  createAppointment,
  payWithWallet,
  updateAppointmentStatus,
  getMyAppointments,
  getAllAppointmentsFromDB,
  getCurrentAppointment,
  getAppointmentById
}
