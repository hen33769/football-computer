"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  accountNameError,
  clearMatchSelections,
  CLOUD_STORAGE_KEYS,
  ensureOrderIds,
  type CloudAccount,
  type CloudBootstrapResponse,
  type CloudPersonalState,
  type CloudSyncStatus,
} from "./cloud";
import FootballApp, { type AppView } from "./FootballApp";
import { createDefaultSettings, normalizeAppSettings } from "./settings";
import type { MatchItem, SavedSlip } from "./types";

type RouteStatus = "loading" | "ready" | "error";

function pathForView(view: AppView) {
  return view === "orders" ? "/orders" : view === "settings" ? "/settings" : "/";
}

function viewForPath(pathname: string): AppView {
  return pathname.startsWith("/orders")
    ? "orders"
    : pathname.startsWith("/settings")
      ? "settings"
      : "betting";
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function readLocalPersonalState(): CloudPersonalState {
  const rawOrders = readJson<unknown>(CLOUD_STORAGE_KEYS.orders, []);
  const orders = ensureOrderIds(Array.isArray(rawOrders) ? rawOrders as SavedSlip[] : []);
  const expenseTotal = Number(localStorage.getItem(CLOUD_STORAGE_KEYS.expense));
  const incomeTotal = Number(localStorage.getItem(CLOUD_STORAGE_KEYS.income));
  return {
    orders,
    finance: {
      expenseTotal: Number.isFinite(expenseTotal) ? Math.max(0, expenseTotal) : 0,
      incomeTotal: Number.isFinite(incomeTotal) ? Math.max(0, incomeTotal) : 0,
    },
    settings: normalizeAppSettings(readJson(CLOUD_STORAGE_KEYS.settings, createDefaultSettings())),
  };
}

function hasLocalPersonalData(state: CloudPersonalState) {
  return state.orders.length > 0
    || state.finance.expenseTotal > 0
    || state.finance.incomeTotal > 0
    || localStorage.getItem(CLOUD_STORAGE_KEYS.settings) !== null;
}

function installPersonalState(state: CloudPersonalState, accountId: string) {
  localStorage.setItem(CLOUD_STORAGE_KEYS.orders, JSON.stringify(ensureOrderIds(state.orders)));
  localStorage.setItem(CLOUD_STORAGE_KEYS.expense, String(state.finance.expenseTotal));
  localStorage.setItem(CLOUD_STORAGE_KEYS.income, String(state.finance.incomeTotal));
  localStorage.setItem(CLOUD_STORAGE_KEYS.settings, JSON.stringify(normalizeAppSettings(state.settings)));
  localStorage.setItem(CLOUD_STORAGE_KEYS.accountId, accountId);
}

function installPublicState() {
  localStorage.setItem(CLOUD_STORAGE_KEYS.orders, "[]");
  localStorage.setItem(CLOUD_STORAGE_KEYS.expense, "0");
  localStorage.setItem(CLOUD_STORAGE_KEYS.income, "0");
  localStorage.setItem(CLOUD_STORAGE_KEYS.settings, JSON.stringify(createDefaultSettings()));
  localStorage.removeItem(CLOUD_STORAGE_KEYS.accountId);
  localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(payload.error || "云端请求失败");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload;
}

export default function FootballRoute({ initialView }: { initialView: AppView }) {
  const initialPersonalView = initialView === "betting" ? null : initialView;
  const [activeView, setActiveView] = useState<AppView>(initialPersonalView ? "betting" : initialView);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>("loading");
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(Boolean(initialPersonalView));
  const [accountDraft, setAccountDraft] = useState("");
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [routeErrorMessage, setRouteErrorMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>("saved");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const personalGenerationRef = useRef(0);
  const accountIdRef = useRef<string | null>(null);
  const pendingViewRef = useRef<AppView | null>(initialPersonalView);

  const savePersonalImmediately = useCallback(async (personal: CloudPersonalState) => {
    const response = await requestJson<{ orders?: SavedSlip[] }>("/api/cloud/personal", {
      method: "PUT",
      body: JSON.stringify({
        ...personal,
        orders: ensureOrderIds(personal.orders),
      }),
    });
    return response.orders ? { ...personal, orders: response.orders } : personal;
  }, []);

  const saveMatchesImmediately = useCallback(async (matches: MatchItem[]) => {
    await requestJson("/api/cloud/matches", {
      method: "PUT",
      body: JSON.stringify({ matches: clearMatchSelections(matches) }),
    });
  }, []);

  const bootstrap = useCallback(async (showLoading = true) => {
    if (showLoading) setRouteStatus("loading");
    setRouteErrorMessage("");
    try {
      const result = await requestJson<CloudBootstrapResponse>("/api/cloud/bootstrap");
      const cloudMatches = result.matches ?? [];
      const localMatches = readJson<MatchItem[]>(CLOUD_STORAGE_KEYS.matches, []);
      if (cloudMatches.length > 0) {
        localStorage.setItem(CLOUD_STORAGE_KEYS.matches, JSON.stringify(clearMatchSelections(cloudMatches)));
      }

      if (result.requiresAccount || !result.account || !result.personal) {
        const localMarker = localStorage.getItem(CLOUD_STORAGE_KEYS.accountId);
        const localPersonal = readLocalPersonalState();
        if (!localMarker && hasLocalPersonalData(localPersonal)) {
          localStorage.setItem(CLOUD_STORAGE_KEYS.pendingMigration, JSON.stringify(localPersonal));
        }
        installPublicState();
        accountIdRef.current = null;
        setAccount(null);
        setSyncStatus("saved");
        setRouteStatus("ready");
        return;
      }

      const nextAccount = result.account;
      const localMarker = localStorage.getItem(CLOUD_STORAGE_KEYS.accountId);
      const hasPendingLocalWrite = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingPersonal) === nextAccount.id;
      const localPersonal = readLocalPersonalState();
      const pendingMigration = readJson<CloudPersonalState | null>(CLOUD_STORAGE_KEYS.pendingMigration, null);
      let personal = result.personal;
      if (!result.hasPersonalData && pendingMigration) {
        personal = await savePersonalImmediately(pendingMigration);
      } else if (
        (hasPendingLocalWrite || !result.hasPersonalData)
        && (!localMarker || localMarker === nextAccount.id)
        && hasLocalPersonalData(localPersonal)
      ) {
        personal = await savePersonalImmediately(localPersonal);
      }
      localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
      localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingMigration);
      installPersonalState(personal, nextAccount.id);

      if (cloudMatches.length === 0 && nextAccount.role === "admin" && localMatches.length > 0) {
        await saveMatchesImmediately(localMatches);
      }

      accountIdRef.current = nextAccount.id;
      setAccount(nextAccount);
      setSyncStatus("saved");
      const pendingView = pendingViewRef.current;
      if (pendingView) {
        pendingViewRef.current = null;
        setActiveView(pendingView);
        window.history.replaceState({}, "", pathForView(pendingView));
      }
      setAccountDialogOpen(false);
      setRouteStatus("ready");
    } catch (error) {
      setRouteErrorMessage(error instanceof Error ? error.message : "云端连接失败");
      setRouteStatus("error");
    }
  }, [saveMatchesImmediately, savePersonalImmediately]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void bootstrap();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bootstrap]);

  useEffect(() => {
    const onPopState = () => {
      const view = viewForPath(window.location.pathname);
      if (!accountIdRef.current && view !== "betting") {
        pendingViewRef.current = view;
        setAccountDialogOpen(true);
        setActiveView("betting");
        return;
      }
      setActiveView(view);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openAccountDialog = useCallback((view?: AppView) => {
    if (view && view !== "betting") pendingViewRef.current = view;
    setAccountError("");
    setAccountDialogOpen(true);
  }, []);

  const closeAccountDialog = () => {
    pendingViewRef.current = null;
    setAccountDialogOpen(false);
    setAccountError("");
    sessionStorage.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
    if (window.location.pathname !== "/") window.history.replaceState({}, "", "/");
  };

  const enterAccount = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = accountNameError(accountDraft);
    if (validationError) {
      setAccountError(validationError);
      return;
    }
    setAccountSubmitting(true);
    setAccountError("");
    try {
      await requestJson("/api/cloud/account", {
        method: "POST",
        body: JSON.stringify({ account: accountDraft }),
      });
      await bootstrap(false);
      setAccountDraft("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "账号登录失败");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const logout = useCallback(async () => {
    setSyncStatus("saving");
    await syncQueueRef.current.catch(() => undefined);
    try {
      await requestJson("/api/cloud/account", { method: "DELETE" });
    } finally {
      accountIdRef.current = null;
      installPublicState();
      setAccount(null);
      setSyncStatus("saved");
      setActiveView("betting");
      pendingViewRef.current = null;
      sessionStorage.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const enqueueWrite = useCallback((task: () => Promise<void>) => {
    if (!accountIdRef.current) return;
    pendingWritesRef.current += 1;
    setSyncStatus("saving");
    const run = syncQueueRef.current.catch(() => undefined).then(task);
    syncQueueRef.current = run;
    void run.then(() => {
      pendingWritesRef.current -= 1;
      if (pendingWritesRef.current === 0) setSyncStatus("saved");
    }).catch((error) => {
      pendingWritesRef.current -= 1;
      setSyncStatus("error");
      if ((error as Error & { status?: number }).status === 401) {
        accountIdRef.current = null;
        installPublicState();
        setAccount(null);
        setActiveView("betting");
        setAccountDialogOpen(true);
      }
    });
  }, []);

  const syncPersonal = useCallback((personal: CloudPersonalState) => {
    if (!accountIdRef.current) return;
    const generation = personalGenerationRef.current + 1;
    personalGenerationRef.current = generation;
    enqueueWrite(async () => {
      await savePersonalImmediately(personal);
      if (personalGenerationRef.current === generation) {
        localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
      }
    });
  }, [enqueueWrite, savePersonalImmediately]);

  const syncMatches = useCallback((matches: MatchItem[]) => {
    if (account?.role !== "admin") return;
    enqueueWrite(async () => {
      await saveMatchesImmediately(matches);
    });
  }, [account?.role, enqueueWrite, saveMatchesImmediately]);

  const navigate = (view: AppView) => {
    if (view !== "betting" && !account) {
      openAccountDialog(view);
      return;
    }
    const path = pathForView(view);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setActiveView(view);
  };

  if (routeStatus === "loading") {
    return (
      <div className="app-loading-shell">
        <div className="app-loading-mark">☁</div>
        <b>正在加载公共比赛</b>
        <span>查看比赛无需登录，个人功能按账号同步。</span>
      </div>
    );
  }

  if (routeStatus === "error") {
    return (
      <main className="cloud-gate">
        <section className="cloud-gate-card">
          <div className="cloud-gate-logo error" aria-hidden="true">!</div>
          <span className="cloud-gate-kicker">CLOUD OFFLINE</span>
          <h1>暂时无法连接云端</h1>
          <p>{routeErrorMessage}</p>
          <button className="cloud-gate-primary" type="button" onClick={() => void bootstrap()}>重新连接</button>
        </section>
      </main>
    );
  }

  return (
    <>
      <FootballApp
        key={account?.id ?? "public"}
        initialView={activeView}
        onNavigate={navigate}
        cloudAccount={account}
        cloudSyncStatus={syncStatus}
        onCloudPersonalChange={syncPersonal}
        onCloudMatchesChange={syncMatches}
        onRequireAccount={openAccountDialog}
        onLogout={logout}
      />
      {accountDialogOpen && !account && (
        <div className="cloud-account-backdrop" role="presentation">
          <form className="cloud-gate-card cloud-account-dialog" onSubmit={enterAccount} aria-labelledby="cloud-account-title">
            <button className="cloud-dialog-close" type="button" aria-label="关闭登录窗口" onClick={closeAccountDialog}>×</button>
            <div className="cloud-gate-logo cloud-gate-brand-logo" role="img" aria-label="SMGR" />
            <span className="cloud-gate-kicker">SMGR ACCOUNT</span>
            <h1 id="cloud-account-title">输入账号进入</h1>
            <p>已有账号会直接登录；新账号会自动创建。订单、收支和设置将同步到这个账号。</p>
            <label htmlFor="cloud-account">账号</label>
            <input
              id="cloud-account"
              autoFocus
              autoComplete="username"
              maxLength={24}
              value={accountDraft}
              onChange={(event) => setAccountDraft(event.target.value)}
              placeholder="例如：football88"
            />
            {accountError && <div className="cloud-gate-error">{accountError}</div>}
            <button className="cloud-gate-primary" type="submit" disabled={accountSubmitting}>
              {accountSubmitting ? "正在进入…" : "登录或创建账号"}
            </button>
            <small>无需密码。关闭此窗口仍可查看公共比赛；请勿使用包含隐私信息的账号名。</small>
          </form>
        </div>
      )}
    </>
  );
}
