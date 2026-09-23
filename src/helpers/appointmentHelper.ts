import { User } from "../app/modules/user/user.model";
import { NotificationService } from "../app/modules/notification/notification.service";

// Calculates total worked time and cost for completed appointment
export async function handleAppointmentCompletion(appointment: any) {
  const provider = await User.findById(appointment.provider);
  if (appointment.actualStartTime && appointment.actualEndTime) {
    const start = new Date(appointment.actualStartTime);
    const end = new Date(appointment.actualEndTime);

    const durationMs = end.getTime() - start.getTime();
    const hours = durationMs / (1000 * 60 * 60);
    appointment.totalWorkedTime = parseFloat(hours.toFixed(2));

    if (provider?.providerProfile?.hourlyRate) {
      appointment.totalCost = parseFloat((hours * provider.providerProfile.hourlyRate).toFixed(2));
    }
  }
}

// Sends status-specific notifications to customer or provider
export async function sendStatusNotification(appointment: any, status: string, isCustomer: boolean) {
  const messages: Record<string, { title: string; message: string; receiver: "customer" | "provider" }> = {
    accepted: {
      title: "Appointment Accepted",
      message: `Your appointment for ${appointment.service} has been accepted.`,
      receiver: "customer"
    },
    rejected: {
      title: "Appointment Rejected",
      message: `Your appointment for ${appointment.service} was rejected. Reason: ${appointment.reason || 'N/A'}`,
      receiver: "customer"
    },
    in_progress: {
      title: "Service Started",
      message: `The provider has started the service for your appointment.`,
      receiver: "customer"
    },
    work_completed: {
      title: "Service Completed",
      message: `The service is complete. Total Time: ${appointment.totalWorkedTime} hrs, Total Cost: ${appointment.totalCost}. Please proceed to payment.`,
      receiver: "customer"
    },
    cancelled: {
      title: "Appointment Cancelled",
      message: `The appointment for ${appointment.service} has been cancelled. Reason: ${appointment.reason || 'N/A'}`,
      receiver: isCustomer ? "provider" : "customer"
    },
    cashPayment: {
      title: "Payment Update: Cash",
      message: `The customer has opted to pay via cash. Please confirm once you receive the payment.`,
      receiver: "provider"
    },
    cashReceived: {
      title: "Payment Confirmed",
      message: `The provider has confirmed your cash payment. Your service is now ready for review.`,
      receiver: "customer"
    },
    review_pending: {
      title: "Payment Processed",
      message: `Payment for appointment ${appointment._id} has been successfully processed.`,
      receiver: "customer"
    }
  };

  const config = messages[status];
  if (config) {
    const receiverId = config.receiver === "customer" ? appointment.customer : appointment.provider;
    console.log(`[AppointmentService] Triggering status notification: ${status}. Receiver: ${receiverId}`);
    try {
      await NotificationService.insertNotification({
        title: config.title,
        message: config.message,
        receiver: receiverId,
        referenceId: appointment._id,
        screen: "APPOINTMENT",
        type: "USER",
      });
      console.log(`[AppointmentService] Status notification inserted successfully`);
    } catch (error) {
      console.error(`[AppointmentService] Failed to insert status notification:`, error);
    }
  }
}
