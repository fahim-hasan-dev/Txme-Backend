import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import config from "../config";
import ApiError from "../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";

const s3Client = new S3Client({
    region: config.aws.s3.region || "us-east-1",
    credentials: {
        accessKeyId: config.aws.accessKeyId as string,
        secretAccessKey: config.aws.secretAccessKey as string,
    },
});

// Uploads file to S3 and returns the public URL
export const uploadToS3 = async (
    filePath: string,
    fileName: string,
    mimeType: string
): Promise<string> => {
    if (!config.aws.bucket) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "S3 Bucket name is missing in config");
    }

    const fileStream = fs.createReadStream(filePath);

    try {
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: config.aws.bucket,
                Key: fileName,
                Body: fileStream,
                ContentType: mimeType,
                // ACL: "public-read", // Uncomment if your bucket supports public ACLs
            },
        });

        await upload.done();

        // Return the public URL
        return `https://${config.aws.bucket}.s3.${config.aws.s3.region}.amazonaws.com/${fileName}`;
    } catch (error: any) {
        console.error("❌ S3 Upload Error:", error.message || error);
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, `Failed to upload to S3: ${error.message}`);
    } finally {
        fileStream.destroy();
    }
};

// Deletes a file from S3 using its key
export const deleteFromS3 = async (key: string): Promise<void> => {
    try {
        const command = new DeleteObjectCommand({
            Bucket: config.aws.bucket,
            Key: key,
        });
        await s3Client.send(command);
    } catch (error: any) {
        console.error("❌ S3 Delete Error:", error.message || error);
    }
};
