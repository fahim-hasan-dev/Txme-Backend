import fs from 'fs';
import { uploadToS3 } from '../util/s3.util';

// Uploads file to S3 and removes local copy
export const uploadFileToS3 = async (
    localPath: string,
    folderName: string,
    fileName: string,
    mimeType: string
): Promise<string> => {
    try {
        const s3Key = `${folderName}/${Date.now()}-${fileName}`;
        const s3Url = await uploadToS3(localPath, s3Key, mimeType);

        // Cleanup local file after successful upload
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
        }

        return s3Url;
    } catch (error) {
        // Still try to cleanup even if upload fails to avoid local storage build-up
        if (fs.existsSync(localPath)) {
            try {
                fs.unlinkSync(localPath);
            } catch (cleanupError) {
                console.error("Local cleanup failed after S3 error:", cleanupError);
            }
        }
        throw error;
    }
};
