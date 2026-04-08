import React, { useState } from 'react';
import { Activity, Lock, LogIn, UserPlus } from 'lucide-react';

interface AuthScreenProps {
  onLogin: (email: string, password: string, mode: 'login' | 'register') => Promise<void>;
  accentClass: string;
  accentBg: string;
  loading?: boolean;
  error?: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  accentClass,
  accentBg,
  loading = false,
  error = null,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onLogin(email, password, mode);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#0a0a0a] flex items-center justify-center p-4 font-mono">
      <form onSubmit={handleSubmit} className="w-full max-w-md rack-panel p-8 border-2 border-zinc-800 bg-[#151515] shadow-2xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900">
          {loading ? <Activity size={28} className={`${accentClass} animate-spin`} /> : <Lock size={28} className={accentClass} />}
        </div>

        <h1 className="mb-2 text-center text-xl font-bold uppercase tracking-[0.25em] text-zinc-100">
          TrackMaster Access
        </h1>
        <p className="mb-6 text-center text-[10px] uppercase tracking-widest text-zinc-500">
          Local account required for public API access
        </p>

        {error && (
          <div className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] uppercase tracking-wider text-amber-100">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-[10px] uppercase tracking-widest text-zinc-500">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="mt-2 w-full rounded-sm border border-zinc-700 bg-black px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-400"
            />
          </label>

          <label className="block text-[10px] uppercase tracking-widest text-zinc-500">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={12}
              required
              className="mt-2 w-full rounded-sm border border-zinc-700 bg-black px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-400"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-sm px-4 py-3 text-xs font-bold uppercase tracking-widest text-black transition-opacity disabled:opacity-50 ${accentBg}`}
        >
          {loading ? <Activity size={16} className="animate-spin" /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {mode === 'login' ? 'Login' : 'Create Account'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          className="mt-4 w-full text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
        >
          {mode === 'login' ? 'Need an account? Register' : 'Already registered? Login'}
        </button>
      </form>
    </div>
  );
};
