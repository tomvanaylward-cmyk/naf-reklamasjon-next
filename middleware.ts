import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('sb-efnpfmcgapcgqiouopsx-auth-token');
  const isAuth = !!token;
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!isAuth && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (isAuth && isLoginPage) {
    return NextResponse.redirect(new URL('/saksbehandling', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|favicon.ico).*)'],
};
