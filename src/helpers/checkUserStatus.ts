import { StatusCodes } from "http-status-codes";
import ApiError from "../errors/ApiErrors";

export const checkUserStatus = (status?: string) => {
  const statusMessages: Record<string, string> = {
    'rejected': 'Your account has been rejected. Please contact support for more information.',
    'suspended': 'Your account has been suspended. Please contact support.',
    'blocked': 'Your account has been blocked. Please contact support.',
    'deleted': 'Your account has been deleted.'
  };

  if (status && statusMessages[status]) {
    throw new ApiError(StatusCodes.FORBIDDEN, statusMessages[status]);
  }
};
