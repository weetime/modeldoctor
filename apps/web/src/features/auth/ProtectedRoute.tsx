import { useAuthStore } from "@/stores/auth-store";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

interface BootGateProps {
  children: ReactNode;
}

function BootGate({ children }: BootGateProps) {
  // On mount, attempt a silent /api/auth/refresh so reloads re-hydrate the
  // session via the HttpOnly cookie. Shows nothing while the probe is in
  // flight to avoid a login-flash.
  const [probed, setProbed] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!cancelled && res.ok) {
          const body = await res.json();
          setAuth(body.accessToken, body.user);
        }
      } catch {
        // ignore — no cookie, just proceed to login
      }
      if (!cancelled) setProbed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [setAuth]);

  if (!probed) return null;
  return <>{children}</>;
}

export function ProtectedRoute() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();

  return (
    <BootGate>
      {accessToken ? (
        <Outlet />
      ) : (
        <Navigate to="/login" state={{ from: location.pathname }} replace />
      )}
    </BootGate>
  );
}
