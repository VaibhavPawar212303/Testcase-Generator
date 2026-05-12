import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knowledge.json');

async function getDB() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { documents: [] };
  }
}

async function saveDB(data: any) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

export async function GET() {
  const db = await getDB();
  return NextResponse.json(db);
}

export async function POST(req: Request) {
  const body = await req.json();
  await saveDB(body);
  return NextResponse.json({ success: true });
}
