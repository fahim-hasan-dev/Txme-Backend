import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import config from '../config';
import ApiError from '../errors/ApiErrors';
import { StatusCodes } from 'http-status-codes';

const snsClient = new SNSClient({
  region: config.aws.sns.region || 'us-east-1',
  credentials: {
    accessKeyId: config.aws.accessKeyId as string,
    secretAccessKey: config.aws.secretAccessKey as string,
  },
});

const sendSMS = async (to: string, message: string) => {
  if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
    console.error("❌ AWS Credentials missing in config");
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'SMS configuration missing');
  }

  // Ensure phone number starts with + for AWS SNS international format
  const formattedTo = to.startsWith('+') ? to : `+${to}`;

  try {
    const params = {
      Message: message,
      PhoneNumber: formattedTo,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'Txme',
        },
      },
    };

    const command = new PublishCommand(params);
    const result = await snsClient.send(command);

    console.log("✅ SMS sent successfully via AWS SNS:", result.MessageId);
    return {
      invalid: false,
      message: `Message sent successfully to ${to}`,
    };
  } catch (error: any) {
    console.error("❌ AWS SNS SMS Error:", error.message || error);

    // AWS SNS error codes are different from other providers
    if (error.name === 'InvalidParameterException' && error.message.includes('PhoneNumber')) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid phone number format');
    }

    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Failed to send sms');
  }
};

export default sendSMS;
