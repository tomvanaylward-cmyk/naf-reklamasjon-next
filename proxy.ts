import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Auth is handled client-side via getCurrentUser() in each page.
// Supabase JS v2 stores sessions in localStorage (not cookies), so
// server-side session detection is not available without @supabase/ssr.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
