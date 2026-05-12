import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export async function getDb() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
      port: Number(process.env.DB_PORT) || 4000,
      user: process.env.DB_USERNAME || 'sC5aTifmN57gWAj.root',
      password: process.env.DB_PASSWORD || 'uLngwCciBMxbmMc2',
      database: process.env.DB_DATABASE || 'KnowledgeBase',
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function initSchema() {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_fragments (
      id VARCHAR(36) PRIMARY KEY,
      text TEXT NOT NULL,
      embedding JSON NOT NULL,
      source VARCHAR(255),
      created_at BIGINT
    )
  `);
}
