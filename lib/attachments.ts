import { db } from '@/lib/supabase';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE      = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES = 5;

/** Returns an error message, or null if the file is valid. */
export function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return `${file.name}: filtype ikke støttet (JPG, PNG, PDF)`;
  if (file.size > MAX_SIZE)
    return `${file.name}: for stor (maks 10 MB)`;
  return null;
}

/** Human-readable file size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uploads a file directly from an authenticated client to Supabase Storage,
 * then inserts a row into `attachments`.
 * Returns an error string on failure, null on success.
 */
export async function uploadAttachmentAuthenticated(
  caseId: string,
  file: File,
  uploaderId: string,
): Promise<string | null> {
  // Derive extension from validated MIME type, not the filename (prevents path traversal)
  const EXT_MAP: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
  };
  const ext      = EXT_MAP[file.type] ?? 'bin';
  const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const storagePath = `${caseId}/${safeName}`;

  const { error: storageError } = await db.storage
    .from('case-attachments')
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (storageError) return `Opplasting feilet: ${storageError.message}`;

  const { error: dbError } = await db.from('attachments').insert({
    case_id:      caseId,
    uploader_id:  uploaderId,
    file_name:    file.name,
    file_size:    file.size,
    mime_type:    file.type,
    storage_path: storagePath,
  });

  if (dbError) return `Databasefeil: ${dbError.message}`;
  return null;
}

/**
 * Creates a 60-minute signed URL for a private Storage file.
 * Returns null on error.
 */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await db.storage
    .from('case-attachments')
    .createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}
