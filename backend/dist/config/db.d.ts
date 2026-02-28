import { Pool } from 'pg';
import * as schema from '../db/schema';
declare const pool: Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;
export declare function initDb(): Promise<boolean>;
export declare function closeDb(): Promise<void>;
export { pool };
//# sourceMappingURL=db.d.ts.map