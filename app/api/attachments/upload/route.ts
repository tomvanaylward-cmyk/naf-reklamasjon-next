// app/api/attachments/upload/route.ts
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/admin-api';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE      = 10 * 1024 * 1024; // 10 MB
const MAX_FILES     = 5;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const caseId   = formData.get('case_id') as string | null;
    const token    = formData.get('token')   as string | null;

    if (!caseId) {
      return NextResponse.json({ error: 'case_id er påkrevd' }, { status: 400 });
    }

    // case_id may be the human-readable ID (e.g. NAF-202604-0001) — look up the UUID.
    // If a reply token is present we also validate it (portal uploads); absent = authenticated path.
    let caseUuid = caseId;
    if (!caseId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)) {
      const { data: caseRow } = await adminDb
        .from('cases')
        .select('id, reply_token')
        .eq('case_id', caseId)
        .single();
      if (!caseRow) {
        return NextResponse.json({ error: 'Sak ikke funnet' }, { status: 404 });
      }

      // Validate reply_token when present (customer portal uploads)
      if (token !== null) {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const storedToken = caseRow.reply_token ?? '';
        const valid =
          uuidRe.test(token) &&
          token.length === storedToken.length &&
          storedToken.length === 36 &&
          timingSafeEqual(Buffer.from(token), Buffer.from(storedToken));
        if (!valid) {
          return NextResponse.json({ error: 'Ugyldig lenke' }, { status: 403 });
        }
      }

      caseUuid = caseRow.id;
    }

    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ ok: true, uploaded: 0 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maks ${MAX_FILES} filer per opplasting` },
        { status: 400 },
      );
    }

    const errors: string[]   = [];
    const uploaded: string[] = [];

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: filtype ikke støttet`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        errors.push(`${file.name}: for stor (maks 10 MB)`);
        continue;
      }

      // Derive extension from validated MIME type, not the filename (prevents path traversal)
      const EXT_MAP: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
      };
      const ext      = EXT_MAP[file.type] ?? 'bin';
      const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const storagePath = `${caseUuid}/${safeName}`;

      const { error: storageError } = await adminDb.storage
        .from('case-attachments')
        .upload(storagePath, await file.arrayBuffer(), {
          contentType: file.type,
          upsert: false,
        });

      if (storageError) {
        console.error('Storage error:', storageError);
        errors.push(`${file.name}: opplasting feilet`);
        continue;
      }

      const { error: dbError } = await adminDb.from('attachments').insert({
        case_id:      caseUuid,
        uploader_id:  null,
        file_name:    file.name,
        file_size:    file.size,
        mime_type:    file.type,
        storage_path: storagePath,
      });

      if (dbError) {
        console.error('DB insert error:', dbError);
        errors.push(`${file.name}: lagring av metadata feilet`);
        continue;
      }

      uploaded.push(file.name);
    }

    return NextResponse.json({ ok: true, uploaded: uploaded.length, errors });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ error: 'Opplasting feilet' }, { status: 500 });
  }
}
