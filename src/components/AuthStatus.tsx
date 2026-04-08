import { useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import type { AuthUser } from '../lib/api';

interface AuthStatusProps {
  accentClass: string;
  accentBg: string;
  user: AuthUser;
  onLogout: () => void;
}

export function AuthStatus({
  accentClass,
  accentBg,
  user,
  onLogout,
}: AuthStatusProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 2500);
  };

  return (
    <div className="relative flex items-center gap-3 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-sm min-w-[220px]">
      <div className={`p-1.5 rounded-sm bg-black border border-zinc-800 ${accentClass}`}>
        <UserRound size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[9px] font-mono text-zinc-500 uppercase leading-none">Authenticated</p>
          <span className={`h-1.5 w-1.5 rounded-full ${accentBg}`} />
        </div>
        <p className="mt-1 text-[10px] font-mono font-bold text-zinc-200 truncate">{user.email}</p>
        <p className="mt-0.5 text-[8px] font-mono uppercase tracking-wider text-zinc-500">Local API Storage</p>
      </div>

      <button
        onClick={() => {
          showFeedback('Signed out');
          onLogout();
        }}
        className={`p-1.5 border border-zinc-800 rounded-sm ${accentClass} hover:bg-zinc-800 transition-colors`}
        title="Sign out"
      >
        <LogOut size={15} />
      </button>

      {feedback && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-sm border border-zinc-700 bg-zinc-950 p-2 text-[9px] font-mono uppercase tracking-wider text-zinc-300 shadow-2xl z-[120]">
          {feedback}
        </div>
      )}
    </div>
  );
}
