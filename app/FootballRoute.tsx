"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  accountNameError,
  clearMatchSelections,
  CLOUD_STORAGE_KEYS,
  ensureOrderIds,
  type CloudAccount,
  type CloudBootstrapResponse,
  type CloudPersonalData,
  type CloudSyncStatus,
} from "./cloud";
import { localCache, sessionCache } from "./browser-storage";
import FootballApp, { type AppView } from "./FootballApp";
import { DEMO_APP_URL } from "./links";
import {
  createPersonalSyncIntent,
  emptyPersonalSyncIntent,
  hasPersonalSyncIntent,
  mergePersonalSyncIntents,
  resolvePersonalBootstrapState,
  type CloudPersonalMutation,
  type PersonalSyncIntent,
} from "./personal-sync";
import { createDefaultSettings, normalizeAppSettings } from "./settings";
import type { MatchItem, SavedSlip } from "./types";

type RouteStatus = "loading" | "ready" | "error";
type PendingPersonalChanges = {
  accountId: string;
  intent: PersonalSyncIntent;
};

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
    const raw = localCache.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function readLocalPersonalState(): CloudPersonalData {
  const rawOrders = readJson<unknown>(CLOUD_STORAGE_KEYS.orders, []);
  const orders = ensureOrderIds(Array.isArray(rawOrders) ? rawOrders as SavedSlip[] : []);
  const expenseTotal = Number(localCache.getItem(CLOUD_STORAGE_KEYS.expense));
  const incomeTotal = Number(localCache.getItem(CLOUD_STORAGE_KEYS.income));
  return {
    orders,
    finance: {
      expenseTotal: Number.isFinite(expenseTotal) ? Math.max(0, expenseTotal) : 0,
      incomeTotal: Number.isFinite(incomeTotal) ? Math.max(0, incomeTotal) : 0,
    },
    settings: normalizeAppSettings(readJson(CLOUD_STORAGE_KEYS.settings, createDefaultSettings())),
  };
}

function hasLocalPersonalData(state: CloudPersonalData) {
  return state.orders.length > 0
    || state.finance.expenseTotal > 0
    || state.finance.incomeTotal > 0
    || localCache.getItem(CLOUD_STORAGE_KEYS.settings) !== null;
}

function installPersonalState(state: CloudPersonalData, accountId: string) {
  localCache.setItem(CLOUD_STORAGE_KEYS.orders, JSON.stringify(ensureOrderIds(state.orders)));
  localCache.setItem(CLOUD_STORAGE_KEYS.expense, String(state.finance.expenseTotal));
  localCache.setItem(CLOUD_STORAGE_KEYS.income, String(state.finance.incomeTotal));
  localCache.setItem(CLOUD_STORAGE_KEYS.settings, JSON.stringify(normalizeAppSettings(state.settings)));
  localCache.setItem(CLOUD_STORAGE_KEYS.accountId, accountId);
}

function installPublicState() {
  localCache.setItem(CLOUD_STORAGE_KEYS.orders, "[]");
  localCache.setItem(CLOUD_STORAGE_KEYS.expense, "0");
  localCache.setItem(CLOUD_STORAGE_KEYS.income, "0");
  localCache.setItem(CLOUD_STORAGE_KEYS.settings, JSON.stringify(createDefaultSettings()));
  localCache.removeItem(CLOUD_STORAGE_KEYS.accountId);
  localCache.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
}

function readPendingPersonalChanges(accountId: string): PersonalSyncIntent | null {
  const pending = readJson<PendingPersonalChanges | null>(CLOUD_STORAGE_KEYS.pendingPersonalChanges, null);
  if (
    !pending
    || pending.accountId !== accountId
    || !Array.isArray(pending.intent?.upsertOrders)
    || !Array.isArray(pending.intent?.deleteOrderIds)
  ) {
    return null;
  }
  return pending.intent;
}

function writePendingPersonalChanges(accountId: string, intent: PersonalSyncIntent) {
  if (!hasPersonalSyncIntent(intent)) {
    localCache.removeItem(CLOUD_STORAGE_KEYS.pendingPersonalChanges);
    return;
  }
  localCache.setItem(
    CLOUD_STORAGE_KEYS.pendingPersonalChanges,
    JSON.stringify({ accountId, intent } satisfies PendingPersonalChanges),
  );
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
    Object.assign(error, { status: response.status, payload });
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
  const personalSyncRunningRef = useRef(false);
  const pendingPersonalIntentRef = useRef<PersonalSyncIntent>(emptyPersonalSyncIntent());
  const pendingPersonalVersionRef = useRef(0);
  const clientPersonalRef = useRef<CloudPersonalData | null>(null);
  const serverRevisionRef = useRef(0);
  const accountIdRef = useRef<string | null>(null);
  const pendingViewRef = useRef<AppView | null>(initialPersonalView);

  const sendPersonalMutation = useCallback(async (intent: PersonalSyncIntent) => {
    let conflictCount = 0;
    while (conflictCount < 6) {
      const mutation: CloudPersonalMutation = {
        ...intent,
        upsertOrders: ensureOrderIds(intent.upsertOrders),
        expectedRevision: serverRevisionRef.current,
      };
      try {
        const response = await requestJson<{ revision: number }>("/api/cloud/personal", {
          method: "PUT",
          body: JSON.stringify(mutation),
        });
        serverRevisionRef.current = response.revision;
        return;
      } catch (error) {
        const requestError = error as Error & {
          status?: number;
          payload?: { revision?: unknown };
        };
        const conflictRevision = Number(requestError.payload?.revision);
        if (
          requestError.status !== 409
          || !Number.isInteger(conflictRevision)
          || conflictRevision < 0
        ) {
          throw error;
        }
        serverRevisionRef.current = conflictRevision;
        conflictCount += 1;
      }
    }
    throw new Error("云端数据持续被其他设备更新，请稍后重试");
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
        localCache.setItem(CLOUD_STORAGE_KEYS.matches, JSON.stringify(clearMatchSelections(cloudMatches)));
      }

      if (result.requiresAccount || !result.account || !result.personal) {
        const localMarker = localCache.getItem(CLOUD_STORAGE_KEYS.accountId);
        const localPersonal = readLocalPersonalState();
        if (!localMarker && hasLocalPersonalData(localPersonal)) {
          localCache.setItem(CLOUD_STORAGE_KEYS.pendingMigration, JSON.stringify(localPersonal));
        }
        installPublicState();
        accountIdRef.current = null;
        clientPersonalRef.current = null;
        serverRevisionRef.current = 0;
        pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
        personalSyncRunningRef.current = false;
        setAccount(null);
        setSyncStatus("saved");
        setRouteStatus("ready");
        return;
      }

      const nextAccount = result.account;
      const localMarker = localCache.getItem(CLOUD_STORAGE_KEYS.accountId);
      const localPersonal = readLocalPersonalState();
      const pendingMigration = readJson<CloudPersonalData | null>(CLOUD_STORAGE_KEYS.pendingMigration, null);
      const serverPersonal: CloudPersonalData = {
        orders: ensureOrderIds(result.personal.orders),
        finance: result.personal.finance,
        settings: result.personal.settings,
      };
      const durablePendingIntent = readPendingPersonalChanges(nextAccount.id);
      const initialMigrationPersonal = !result.hasPersonalData && !hasPersonalSyncIntent(durablePendingIntent ?? emptyPersonalSyncIntent())
        ? pendingMigration
          ?? ((!localMarker || localMarker === nextAccount.id) && hasLocalPersonalData(localPersonal)
            ? localPersonal
            : undefined)
        : undefined;
      const { intent: pendingIntent, personal } = resolvePersonalBootstrapState(
        serverPersonal,
        Boolean(result.hasPersonalData),
        durablePendingIntent,
        initialMigrationPersonal,
      );
      localCache.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
      localCache.removeItem(CLOUD_STORAGE_KEYS.pendingMigration);
      writePendingPersonalChanges(nextAccount.id, pendingIntent);
      installPersonalState(personal, nextAccount.id);

      if (cloudMatches.length === 0 && localMatches.length > 0) {
        await saveMatchesImmediately(localMatches);
      }

      accountIdRef.current = nextAccount.id;
      clientPersonalRef.current = personal;
      serverRevisionRef.current = result.personal.revision;
      pendingPersonalIntentRef.current = pendingIntent;
      pendingPersonalVersionRef.current += 1;
      personalSyncRunningRef.current = false;
      setAccount(nextAccount);
      setSyncStatus(hasPersonalSyncIntent(pendingIntent) ? "saving" : "saved");
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
  }, [saveMatchesImmediately]);

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
    sessionCache.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
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
      clientPersonalRef.current = null;
      serverRevisionRef.current = 0;
      pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
      personalSyncRunningRef.current = false;
      installPublicState();
      setAccount(null);
      setSyncStatus("saved");
      setActiveView("betting");
      pendingViewRef.current = null;
      sessionCache.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
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
        clientPersonalRef.current = null;
        serverRevisionRef.current = 0;
        pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
        personalSyncRunningRef.current = false;
        installPublicState();
        setAccount(null);
        setActiveView("betting");
        setAccountDialogOpen(true);
      }
    });
  }, []);

  const schedulePersonalSync = useCallback(() => {
    const accountId = accountIdRef.current;
    if (
      !accountId
      || personalSyncRunningRef.current
      || !hasPersonalSyncIntent(pendingPersonalIntentRef.current)
    ) {
      return;
    }
    personalSyncRunningRef.current = true;
    enqueueWrite(async () => {
      try {
        while (
          accountIdRef.current === accountId
          && hasPersonalSyncIntent(pendingPersonalIntentRef.current)
        ) {
          const sentVersion = pendingPersonalVersionRef.current;
          const sentIntent = structuredClone(pendingPersonalIntentRef.current);
          await sendPersonalMutation(sentIntent);
          if (accountIdRef.current !== accountId) return;

          if (pendingPersonalVersionRef.current === sentVersion) {
            pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
          }
          writePendingPersonalChanges(accountId, pendingPersonalIntentRef.current);
        }
      } finally {
        personalSyncRunningRef.current = false;
      }
    });
  }, [enqueueWrite, sendPersonalMutation]);

  const syncPersonal = useCallback((personal: CloudPersonalData) => {
    const accountId = accountIdRef.current;
    if (!accountId) return;
    const nextPersonal: CloudPersonalData = {
      ...personal,
      orders: ensureOrderIds(personal.orders),
    };
    const previous = clientPersonalRef.current;
    clientPersonalRef.current = nextPersonal;
    if (previous) {
      const incomingIntent = createPersonalSyncIntent(previous, nextPersonal);
      if (hasPersonalSyncIntent(incomingIntent)) {
        pendingPersonalIntentRef.current = mergePersonalSyncIntents(
          pendingPersonalIntentRef.current,
          incomingIntent,
        );
        pendingPersonalVersionRef.current += 1;
        writePendingPersonalChanges(accountId, pendingPersonalIntentRef.current);
      }
    }
    schedulePersonalSync();
  }, [schedulePersonalSync]);

  const syncMatches = useCallback((matches: MatchItem[]) => {
    if (!account) return;
    enqueueWrite(async () => {
      await saveMatchesImmediately(matches);
    });
  }, [account, enqueueWrite, saveMatchesImmediately]);

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
            <div className="cloud-account-mode-note">
              <b>账号模式 · 使用云端</b>
              <span>已有账号会直接登录，新账号会自动创建。订单、收支、设置和官方比赛将通过 D1 跨设备同步。</span>
            </div>
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
            <small>无需密码。请勿使用包含隐私信息的账号名。</small>
            <div className="cloud-account-divider"><span>或者</span></div>
            <a className="cloud-gate-secondary" href={DEMO_APP_URL}>
              游客登录 · 进入 Demo
            </a>
            <small>游客版不连接账号服务器，订单、收支和设置只保存在当前浏览器；清理浏览器数据或更换设备后不会同步。当前页面的选择不会带到游客版。</small>
          </form>
        </div>
      )}
    </>
  );
}
