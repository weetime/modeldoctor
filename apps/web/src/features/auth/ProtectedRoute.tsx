import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { type ReactNode, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

interface BootGateProps {
  children: ReactNode;
}

function BootGate({ children }: BootGateProps) {
  // On mount, attempt a silent /api/auth/refresh so reloads re-hydrate the
  // session via the HttpOnly cookie. Delegates to api-client's module-level
  // refreshAccessToken so React StrictMode's double-invoked effects in dev
  // dedup against a single in-flight refresh — otherwise both POSTs would
  // carry the same cookie, and the server's rotation guard would treat the
  // second arrival as a reuse attack and invalidate the whole session.
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void refreshAccessToken().finally(() => {
      // refreshAccessToken populates the auth store on success; the only
      // job left here is to release the loading gate so child routes render.
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
