import Redis from "ioredis";
import config from "../config";

let redisClient: Redis | null = null;
let isRedisConnected = false;

try {
    if (config.redis.url) {
        redisClient = new Redis(config.redis.url, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });
    } else {
        redisClient = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });
    }

    redisClient.on("connect", () => {
        isRedisConnected = true;
        console.log("🚀 [Redis] Successfully connected to Redis Server");
    });

    redisClient.on("error", (err) => {
        isRedisConnected = false;
        console.warn(`⚠️ [Redis] Error / Connection offline: ${err.message}`);
    });

    // Initiate background connection
    redisClient.connect().catch((err) => {
        isRedisConnected = false;
        console.warn(`⚠️ [Redis] Lazy connect failed (will fallback to MongoDB): ${err.message}`);
    });
} catch (error: any) {
    console.warn(`⚠️ [Redis] Client initialization error: ${error.message}`);
}

// Fetches cached data or returns null
export async function getCache<T>(key: string): Promise<T | null> {
    if (!redisClient || !isRedisConnected) return null;
    try {
        const data = await redisClient.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
    } catch (error: any) {
        console.warn(`[Redis] getCache error for key "${key}":`, error.message);
        return null;
    }
}

// Sets cache with optional TTL
export async function setCache(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!redisClient || !isRedisConnected) return;
    try {
        const serialized = JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await redisClient.set(key, serialized, "EX", ttlSeconds);
        } else {
            await redisClient.set(key, serialized);
        }
    } catch (error: any) {
        console.warn(`[Redis] setCache error for key "${key}":`, error.message);
    }
}

// Deletes specified cache keys
export async function delCache(keys: string | string[]): Promise<void> {
    if (!redisClient || !isRedisConnected) return;
    try {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        if (keyArray.length > 0) {
            await redisClient.del(...keyArray);
        }
    } catch (error: any) {
        console.warn(`[Redis] delCache error:`, error.message);
    }
}

// Safely deletes keys matching a pattern via SCAN
export async function delCachePattern(pattern: string): Promise<void> {
    if (!redisClient || !isRedisConnected) return;
    try {
        let stream = redisClient.scanStream({
            match: pattern,
            count: 100,
        });

        stream.on("data", async (keys: string[]) => {
            if (keys.length > 0 && redisClient) {
                const pipeline = redisClient.pipeline();
                keys.forEach((key) => pipeline.del(key));
                await pipeline.exec();
            }
        });
    } catch (error: any) {
        console.warn(`[Redis] delCachePattern error for pattern "${pattern}":`, error.message);
    }
}

export { redisClient };
