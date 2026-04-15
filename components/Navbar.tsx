'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';

interface NavbarProps {
  userName: string;
  isAdmin: boolean;
}

export default function Navbar({ userName, isAdmin }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await db.auth.signOut();
    router.push('/login');
  }

  const links = [
    { href: '/dashboard',       label: 'Dashboard' },
    { href: '/saksbehandling',  label: 'Saksbehandling' },
    { href: '/eksport',         label: 'Eksport' },
    ...(isAdmin ? [{ href: '/admin', label: 'Adminpanel' }] : []),
  ];

  return (
    <nav className="bg-[#003087] h-[58px] flex items-center px-7 gap-5 sticky top-0 z-50 shadow-[0_2px_16px_rgba(0,48,135,0.35)]">
      <Link href="/" className="flex items-center gap-3 font-semibold text-[14.5px] text-white no-underline">
        <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-0.5 rounded">NAF</span>
        Reklamasjonssystem
      </Link>
      <div className="flex gap-0.5 ml-auto">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className={`text-[13.5px] font-medium px-3.5 py-1.5 rounded-lg transition-colors no-underline
              ${pathname.startsWith(l.href)
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 text-white/75 text-sm ml-3 pl-3 border-l border-white/15">
        <div className="w-[30px] h-[30px] rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold text-white">
          {(userName || '?')[0].toUpperCase()}
        </div>
        <span>{userName}</span>
        <button onClick={logout} className="text-white/50 text-xs px-2 py-1 rounded hover:bg-white/10 hover:text-white transition-colors cursor-pointer border-none bg-transparent font-[Sora]">
          Logg ut
        </button>
      </div>
    </nav>
  );
}
