import { useEffect, useState } from "react";
import type { AdminUser } from "../../types/api";
import { createUser, fetchUsers, setUserActive } from "../../lib/admin";

const ROLES = ["io", "analyst", "auditor", "admin"] as const;

/**
 * Screen 15. User Management (API_CONTRACTS.md §2.11, D21). Admin role
 * only — the shell already hides this screen from other roles and the
 * server rejects them. Deactivation flips `active`; there is no delete
 * path anywhere in this file, so the audit trail survives by
 * construction, not by convention.
 */
export function UserManagement(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [badge, setBadge] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("io");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      setUsers(await fetchUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Users unavailable.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function create(): Promise<void> {
    setFormError(null);
    try {
      await createUser({ email: email.trim(), badge_no: badge.trim(), full_name: name.trim(), role });
      setEmail("");
      setBadge("");
      setName("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "User was not created.");
    }
  }

  async function deactivate(id: string): Promise<void> {
    try {
      await setUserActive(id, false);
      setConfirmId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deactivation failed.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Create user</h3>
        <div className="flex max-w-3xl flex-wrap gap-2">
          <input
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.test"
            className="w-56 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <input
            aria-label="Badge number"
            value={badge}
            onChange={(event) => setBadge(event.target.value)}
            placeholder="Badge no."
            className="w-32 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <input
            aria-label="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Full name"
            className="w-48 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <select
            aria-label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void create()}
            className="rounded-sm bg-neutral-800 px-3 py-1 text-sm font-semibold text-neutral-100"
          >
            Create
          </button>
        </div>
        {formError && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {formError}
          </p>
        )}
      </section>

      <section className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Managed users</h3>
        {error ? (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        ) : users.length === 0 ? (
          <p className="text-xs text-neutral-500">No managed users yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="px-2 py-1">Email</th>
                <th className="px-2 py-1">Badge</th>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Role</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-neutral-800 text-neutral-200">
                  <td className="px-2 py-1">{user.email}</td>
                  <td className="px-2 py-1 font-mono">{user.badge_no}</td>
                  <td className="px-2 py-1">{user.full_name}</td>
                  <td className="px-2 py-1">{user.role}</td>
                  <td className="px-2 py-1">
                    {user.active ? (
                      <span className="text-green-500">Active</span>
                    ) : (
                      <span className="text-neutral-500">Deactivated</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {user.active &&
                      (confirmId === user.id ? (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void deactivate(user.id)}
                            className="font-semibold text-red-400 hover:text-red-300"
                          >
                            Confirm deactivate
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="text-neutral-400 hover:text-neutral-200"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(user.id)}
                          className="text-neutral-400 hover:text-neutral-200"
                        >
                          Deactivate
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
