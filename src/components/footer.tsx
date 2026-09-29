export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 100 100" className="h-5 w-5 shrink-0" aria-hidden="true">
            <rect x="6" y="6" width="88" height="88" rx="22" fill="#0d9488" />
            <rect x="28" y="42" width="44" height="16" rx="8" fill="#ffffff" />
            <rect x="42" y="28" width="16" height="44" rx="8" fill="#ffffff" />
          </svg>
          <span>ClinicOS</span>
        </div>
        <p>&copy; {new Date().getFullYear()} ClinicOS</p>
      </div>
    </footer>
  );
}
