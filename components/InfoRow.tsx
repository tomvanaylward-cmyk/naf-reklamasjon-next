import type React from 'react';

export default function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1.5 border-b border-gray-100 last:border-0 text-[13px]">
      <span className="text-gray-400 text-[12px] shrink-0">{label}</span>
      <span className="text-gray-800 font-medium text-right">{value ?? '–'}</span>
    </div>
  );
}
