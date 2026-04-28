import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

interface BootGateProps {
  children: ReactNode;
}

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  // Lightweight scan — no need for a full parser. Looks for "md_session=1"
  // anywhere in the cookie header (with the standard "; "-separated form
  // browsers emit). False positives are harmless: we'd just probe /refresh
  // and gracefully handle the 401.
  return /(?:^|;\s*)md_session=1(?:;|$)/.test(document.cookie);
}

function BootGate({ children }: BootGateProps) {
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Already authenticated in this session → no need to probe.
    if (useAuthStore.getState().accessToken) {
      setProbed(true);
      return;
    }
    // No session cookie → user has never logged in (or has logged out).
    // Skip the network call entirely; ProtectedRoute will Navigate to /login.
    if (!hasSessionCookie()) {
      setProbed(true);
      return;
    }
    void refreshAccessToken().finally(() => {
      if (!cancelled) setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
