import { ResourceConsumer } from "../simulation/consumer";
import { CACHE_READ, CACHE_WRITE, CONNECTION } from "../simulation/units";

/**
 * A generic in-memory data cache that follows the Singleton pattern.
 * It uses a simple First-In, First-Out (FIFO) eviction policy when the cache is full.
 * @template TData The type of data to be stored in the cache.
 */
export class DataCache<TData> extends ResourceConsumer {
    static instance: DataCache<any> | null = null;
    static cacheMax = 64;
    static cacheHits = 0;
    static cacheMisses = 0;

    private cache: Map<string, TData>; // Internal map to store cached data.

    /**
     * Private constructor to enforce the singleton pattern.
     */
    private constructor() {
        super();
        this.cache = new Map<string, TData>();
        this.consume(CONNECTION);
    }

    /**
     * Gets the singleton instance of the DataCache.
     * @returns The singleton DataCache instance.
     */
    public static getInstance<T>(): DataCache<T> {
        if (!DataCache.instance) {
            DataCache.instance = new DataCache<T>();
        }
        return DataCache.instance;
    }
    /**
     * Retrieves an item from the cache.
     * @param key The key of the item to retrieve.
     * @returns The cached data, or undefined if the item is not in the cache.
     */
    public get(key: string): TData | undefined {
        if (this.cache.has(key)) {
            DataCache.cacheHits++;
            return this.cache.get(key);
        }
 
        DataCache.cacheMisses++;
        this.consume(CACHE_READ);

        return undefined;
    }

    /**
     * Adds or updates an item in the cache.
     * If the cache is full, it evicts the oldest item (FIFO).
     * @param key The key of the item to store.
     * @param data The data to be stored.
     */
    public put(key: string, data: TData) {
        if (!this.cache.has(key) && this.cache.size >= DataCache.cacheMax) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, data);

        this.consume(CACHE_WRITE);
    }
}