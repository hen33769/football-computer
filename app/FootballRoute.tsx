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
  type CloudPersonalMetadata,
  type CloudSyncStatus,
} from "./cloud";
import { localCache, sessionCache } from "./browser-storage";
import { APP_VERSION } from "./AppVersion";
import FootballApp, { type AppView } from "./FootballApp";
import { DEMO_APP_URL } from "./links";
import {
  applyPersonalSyncIntent,
  createPersonalMetadataSyncIntent,
  emptyPersonalSyncIntent,
  hasPersonalSyncIntent,
  mergePersonalSyncIntents,
  type CloudOrderMutationResult,
  type CloudPersonalMutation,
  type CloudPersonalMutationResponse,
  type OrderSyncIntent,
  type PersonalSyncIntent,
} from "./personal-sync";
import type { MatchItem } from "./types";

type RouteStatus = "loading" | "ready" | "error";
type VersionResponse = { appVersion?: string };

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

function clearCloudPersonalStorage() {
  localCache.removeItem(CLOUD_STORAGE_KEYS.orders);
  localCache.removeItem(CLOUD_STORAGE_KEYS.expense);
  localCache.removeItem(CLOUD_STORAGE_KEYS.income);
  localCache.removeItem(CLOUD_STORAGE_KEYS.settings);
  localCache.removeItem(CLOUD_STORAGE_KEYS.accountId);
  localCache.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
  localCache.removeItem(CLOUD_STORAGE_KEYS.pendingPersonalChanges);
  localCache.removeItem(CLOUD_STORAGE_KEYS.legacyPendingPersonalChanges);
  localCache.removeItem(CLOUD_STORAGE_KEYS.pendingMigration);
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
  const [cloudPersonal, setCloudPersonal] = useState<CloudPersonalData | null>(null);
  const [latestVersion, setLatestVersion] = useState("");
  const syncQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const logoutRunningRef = useRef(false);
  const personalSyncRunningRef = useRef(false);
  const pendingPersonalIntentRef = useRef<PersonalSyncIntent>(emptyPersonalSyncIntent());
  const pendingPersonalVersionRef = useRef(0);
  const clientPersonalRef = useRef<CloudPersonalData | null>(null);
  const serverRevisionRef = useRef(0);
  const accountIdRef = useRef<string | null>(null);
  const pendingViewRef = useRef<AppView | null>(initialPersonalView);

  const sendPersonalMutation = useCallback(async (intent: PersonalSyncIntent, deleteOrders = [] as CloudPersonalMutation["deleteOrders"]) => {
    const mutation: CloudPersonalMutation = {
      ...intent,
      upsertOrders: ensureOrderIds(intent.upsertOrders),
      deleteOrders,
      expectedRevision: serverRevisionRef.current,
      orderMutationVersion: 2,
    };
    const response = await requestJson<CloudPersonalMutationResponse>("/api/cloud/personal", {
      method: "PUT",
      body: JSON.stringify(mutation),
    });
    serverRevisionRef.current = response.revision;
    return response;
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
        clearCloudPersonalStorage();
        accountIdRef.current = null;
        clientPersonalRef.current = null;
        serverRevisionRef.current = 0;
        pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
        personalSyncRunningRef.current = false;
        setAccount(null);
        setCloudPersonal(null);
        setSyncStatus("saved");
        setRouteStatus("ready");
        return;
      }

      const nextAccount = result.account;
      const serverPersonal: CloudPersonalData = {
        orders: ensureOrderIds(result.personal.orders),
        finance: result.personal.finance,
        settings: result.personal.settings,
      };
      clearCloudPersonalStorage();

      if (cloudMatches.length === 0 && localMatches.length > 0) {
        await saveMatchesImmediately(localMatches);
      }

      accountIdRef.current = nextAccount.id;
      clientPersonalRef.current = serverPersonal;
      serverRevisionRef.current = result.personal.revision;
      pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
      pendingPersonalVersionRef.current += 1;
      personalSyncRunningRef.current = false;
      setAccount(nextAccount);
      setCloudPersonal(serverPersonal);
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
  }, [saveMatchesImmediately]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void bootstrap();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bootstrap]);

  const checkAppVersion = useCallback(async () => {
    try {
      const result = await requestJson<VersionResponse>("/api/version");
      if (result.appVersion && result.appVersion !== APP_VERSION) {
        setLatestVersion(result.appVersion);
      }
    } catch {
      // Version checks are advisory; normal cloud error handling covers core data requests.
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void checkAppVersion();
    }, 0);
    const timer = window.setInterval(() => {
      void checkAppVersion();
    }, 60 * 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkAppVersion();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkAppVersion]);

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
    if (logoutRunningRef.current) return;
    logoutRunningRef.current = true;
    try {
      await requestJson("/api/cloud/account", { method: "DELETE" });
    } finally {
      accountIdRef.current = null;
      clientPersonalRef.current = null;
      serverRevisionRef.current = 0;
      pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
      personalSyncRunningRef.current = false;
      clearCloudPersonalStorage();
      setAccount(null);
      setCloudPersonal(null);
      setSyncStatus("saved");
      setActiveView("betting");
      pendingViewRef.current = null;
      sessionCache.removeItem(CLOUD_STORAGE_KEYS.loginBetDraft);
      window.history.replaceState({}, "", "/");
      logoutRunningRef.current = false;
    }
  }, []);

  const enqueueWrite = useCallback(<T,>(task: () => Promise<T>) => {
    if (!accountIdRef.current || logoutRunningRef.current) {
      return Promise.reject(new Error("请先输入账号登录"));
    }
    pendingWritesRef.current += 1;
    setSyncStatus("saving");
    const run = syncQueueRef.current.catch(() => undefined).then(task);
    syncQueueRef.current = run.catch(() => undefined);
    return run.then((value) => {
      pendingWritesRef.current -= 1;
      if (pendingWritesRef.current === 0) setSyncStatus("saved");
      return value;
    }).catch((error) => {
      pendingWritesRef.current -= 1;
      setSyncStatus("error");
      if ((error as Error & { status?: number }).status === 401) {
        accountIdRef.current = null;
        clientPersonalRef.current = null;
        serverRevisionRef.current = 0;
        pendingPersonalIntentRef.current = emptyPersonalSyncIntent();
        personalSyncRunningRef.current = false;
        clearCloudPersonalStorage();
        setAccount(null);
        setCloudPersonal(null);
        setActiveView("betting");
        setAccountDialogOpen(true);
      }
      throw error;
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
    void enqueueWrite(async () => {
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
        }
      } finally {
        personalSyncRunningRef.current = false;
      }
    }).catch(() => undefined);
  }, [enqueueWrite, sendPersonalMutation]);

  const syncPersonalMetadata = useCallback((metadata: CloudPersonalMetadata) => {
    const accountId = accountIdRef.current;
    if (!accountId) return;
    const previous = clientPersonalRef.current;
    if (!previous) return;
    const nextPersonal: CloudPersonalData = {
      ...previous,
      finance: metadata.finance,
      settings: metadata.settings,
    };
    clientPersonalRef.current = nextPersonal;
    const incomingIntent = createPersonalMetadataSyncIntent(previous, nextPersonal);
    if (hasPersonalSyncIntent(incomingIntent)) {
      pendingPersonalIntentRef.current = mergePersonalSyncIntents(
        pendingPersonalIntentRef.current,
        incomingIntent,
      );
      pendingPersonalVersionRef.current += 1;
    }
    schedulePersonalSync();
  }, [schedulePersonalSync]);

  const syncOrders = useCallback(async (orderIntent: OrderSyncIntent): Promise<CloudOrderMutationResult> => {
    const accountId = accountIdRef.current;
    if (!accountId) throw new Error("请先输入账号登录");
    const previous = clientPersonalRef.current;
    if (!previous) throw new Error("云端订单尚未加载，请刷新后重试");
    const currentOrdersById = new Map(previous.orders.flatMap((order) => order.id ? [[order.id, order] as const] : []));
    const incomingIntent: PersonalSyncIntent = {
      upsertOrders: ensureOrderIds(orderIntent.upsertOrders),
      deleteOrderIds: [...new Set(orderIntent.deleteOrderIds)],
    };
    if (!hasPersonalSyncIntent(incomingIntent)) {
      return {
        orders: previous.orders,
        upsertedOrders: [],
        deletedOrderIds: [],
        revision: serverRevisionRef.current,
      };
    }
    const deleteOrders = incomingIntent.deleteOrderIds.map((id) => ({
      id,
      updatedAt: currentOrdersById.get(id)?.updatedAt,
    }));
    const response = await enqueueWrite(() => sendPersonalMutation(incomingIntent, deleteOrders));
    const authoritativeIntent: PersonalSyncIntent = {
      upsertOrders: response.upsertedOrders,
      deleteOrderIds: response.deletedOrderIds,
    };
    const base = clientPersonalRef.current ?? previous;
    const nextPersonal = applyPersonalSyncIntent(base, authoritativeIntent);
    clientPersonalRef.current = nextPersonal;
    setCloudPersonal(nextPersonal);
    return {
      orders: nextPersonal.orders,
      upsertedOrders: response.upsertedOrders,
      deletedOrderIds: response.deletedOrderIds,
      revision: response.revision,
    };
  }, [enqueueWrite, sendPersonalMutation]);

  const syncMatches = useCallback((matches: MatchItem[]) => {
    if (!account) return;
    void enqueueWrite(async () => {
      await saveMatchesImmediately(matches);
    }).catch(() => undefined);
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
        cloudPersonal={cloudPersonal}
        cloudSyncStatus={syncStatus}
        onCloudPersonalMetadataChange={syncPersonalMetadata}
        onCloudOrderMutation={syncOrders}
        onCloudMatchesChange={syncMatches}
        onRequireAccount={openAccountDialog}
        onLogout={logout}
      />
      {latestVersion && (
        <div className="cloud-version-backdrop" role="alertdialog" aria-live="assertive" aria-labelledby="cloud-version-title">
          <section className="cloud-version-card">
            <span className="cloud-gate-kicker">NEW VERSION</span>
            <h2 id="cloud-version-title">发现新版本 v{latestVersion}</h2>
            <p>当前标签页仍在运行 v{APP_VERSION}。刷新后会使用最新前端，避免旧逻辑继续写入云端数据。</p>
            <button className="cloud-gate-primary" type="button" onClick={() => window.location.reload()}>刷新使用新版本</button>
          </section>
        </div>
      )}
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
