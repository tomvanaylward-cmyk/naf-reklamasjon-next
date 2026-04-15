const BADGE_CLASSES: Record<string, string> = {
  ny:      'bg-indigo-50 text-indigo-700',
  open:    'bg-amber-50 text-amber-800',
  waiting: 'bg-sky-50 text-sky-800',
  closed:  'bg-emerald-50 text-emerald-800',
};
const LABELS: Record<string, string> = {
  ny: 'Ny', open: 'Åpen', waiting: 'Venter', closed: 'Lukket'
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center text-[10.5px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${BADGE_CLASSES[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
