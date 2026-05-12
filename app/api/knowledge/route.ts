import { NextResponse } from 'next/server';
import { getDb, initSchema } from '@/lib/db';

export async function GET() {
  try {
    await initSchema();
    const db = await getDb();
    const [rows] = await db.execute('SELECT * FROM knowledge_fragments ORDER BY created_at DESC');
    
    const documents = (rows as any[]).map(row => ({
      id: row.id,
      text: row.text,
      embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding,
      metadata: {
        source: row.source,
        createdAt: row.created_at
      }
    }));

    return NextResponse.json({ documents });
  } catch (err) {
    console.error('DB Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { documents } = await req.json();
    const db = await getDb();

    // Since the frontend currently replaces the whole set or adds new sets,
    // we'll handle upserts or bulk inserts. For simplicity and to match the previous logic:
    for (const doc of documents) {
      await db.execute(
        `INSERT INTO knowledge_fragments (id, text, embedding, source, created_at) 
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE text = VALUES(text), embedding = VALUES(embedding), source = VALUES(source)`,
        [doc.id, doc.text, JSON.stringify(doc.embedding), doc.metadata.source, doc.metadata.createdAt]
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DB Save Error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const db = await getDb();
    await db.execute('DELETE FROM knowledge_fragments WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { id, text, embedding } = await req.json();
    const db = await getDb();
    await db.execute(
      'UPDATE knowledge_fragments SET text = ?, embedding = ? WHERE id = ?',
      [text, JSON.stringify(embedding), id]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
