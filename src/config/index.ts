import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), '.env') });

export default {
    ip_address: process.env.IP,
    port: process.env.PORT,
    database_url: process.env.DATABASE_URL,
    node_env: process.env.NODE_ENV,
    bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,
    jwt: {
        jwt_secret: process.env.JWT_SECRET,
        jwt_expire_in: process.env.JWT_EXPIRE_IN,
        jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
        jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
        jwtBiometricSecret: process.env.JWT_BIOMETRIC_SECRET,
        jwtBiometricExpiresIn: process.env.JWT_BIOMETRIC_EXPIRES_IN,
    },
    stripe: {
        stripeSecretKey: process.env.STRIPE_API_SECRET,
        webhookSecret: process.env.WEBHOOK_SECRET,
        paymentSuccess: process.env.SUCCESS_URL
    },
    email: {
        from: process.env.EMAIL_FROM,
        user: process.env.EMAIL_USER,
        port: process.env.EMAIL_PORT,
        host: process.env.EMAIL_HOST,
        pass: process.env.EMAIL_PASS
    },
    admin: {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD
    },
    aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
        bucket: process.env.AWS_S3_BUCKET,
        ses: {
            region: process.env.AWS_SES_REGION || process.env.AWS_REGION
        },
        s3: {
            region: process.env.AWS_S3_REGION || process.env.AWS_REGION
        },
        sns: {
            region: process.env.AWS_SNS_REGION || process.env.AWS_REGION
        }
    },

    didit: {
        apiKey: process.env.DIDIT_API_KEY,
        webhookSecret: process.env.DIDIT_WEBHOOK_SECRET,
        baseUrl: 'https://verification.didit.me/v2',
        workflowId: process.env.DIDIT_WORKFLOW_ID
    },
    iap: {
        appleSharedSecret: process.env.APPLE_IAP_SHARED_SECRET,
        googlePlayPublicKey: process.env.GOOGLE_PLAY_PUBLIC_KEY,
        packageName: process.env.PACKAGE_NAME
    },
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    redis: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        url: process.env.REDIS_URL || undefined,
    }
}