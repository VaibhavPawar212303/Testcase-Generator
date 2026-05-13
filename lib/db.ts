import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;
let initialized = false;

export async function getDb() {
  if (!pool) {
    const config = {
      host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
      port: Number(process.env.DB_PORT) || 4000,
      user: process.env.DB_USERNAME || 'sC5aTifmN57gWAj.root',
      password: process.env.DB_PASSWORD || 'uLngwCciBMxbmMc2',
      database: process.env.DB_DATABASE || 'KnowledgeBase',
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: false,
      },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000, // 10 seconds timeout
    };
    
    pool = mysql.createPool(config);
  }
  return pool;
}

export async function initSchema() {
  if (initialized) return;
  
  const db = await getDb();
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS knowledge_fragments (
        id VARCHAR(36) PRIMARY KEY,
        text TEXT NOT NULL,
        embedding JSON NOT NULL,
        source VARCHAR(255),
        created_at BIGINT
      )
    `);
    initialized = true;
  } catch (err) {
    console.error('Schema initialization failed:', err);
    throw err;
  }
}
