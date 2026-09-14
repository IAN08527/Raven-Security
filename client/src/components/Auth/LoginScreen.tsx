import { useState } from "react";
import { login, LoginError } from "../../lib/session";

// Login screen (M5-T4, design screen 01): dark surface, RAVEN wordmark,
// email + password, specific errors, no "remember me" -- the session
// ends when the window closes because the JWT is memory-only.

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      onSignedIn();
    } catch (err: unknown) {
      if (err instanceof LoginError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Sign-in failed unexpectedly.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
      <main className="w-80 border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-xl font-semibold tracking-widest">RAVEN</h1>
        <p className="mt-1 text-sm text-neutral-400">Sign in to continue.</p>
        <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              aria-label="Email"
              type="email"
              autoComplete="off"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              aria-label="Password"
              type="password"
              autoComplete="off"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="border border-neutral-600 bg-neutral-800 px-3 py-1 text-sm disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
