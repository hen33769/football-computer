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

type GateStatus = "loading" | "signin" | "account" | "ready" | "error";

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
  const [activeView, setActiveView] = useState(initialView);
  const [gateStatus, setGateStatus] = useState<GateStatus>("loading");
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [accountDraft, setAccountDraft] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [gateError, setGateError] = useState("");
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>("saved");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const personalGenerationRef = useRef(0);

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

  const bootstrap = useCallback(async () => {
    setGateStatus("loading");
    setGateError("");
    try {
      const result = await requestJson<CloudBootstrapResponse>("/api/cloud/bootstrap");
      if (result.requiresAccount || !result.account || !result.personal) {
        setIdentityName(result.identity?.displayName ?? "");
        setGateStatus("account");
        return;
      }

      const nextAccount = result.account;
      const localMarker = localStorage.getItem(CLOUD_STORAGE_KEYS.accountId);
      const hasPendingLocalWrite = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingPersonal) === nextAccount.id;
      const localPersonal = readLocalPersonalState();
      let personal = result.personal;
      if (
        (hasPendingLocalWrite || !result.hasPersonalData)
        && (!localMarker || localMarker === nextAccount.id)
        && hasLocalPersonalData(localPersonal)
      ) {
        personal = await savePersonalImmediately(localPersonal);
        localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingPersonal);
      }
      installPersonalState(personal, nextAccount.id);

      const cloudMatches = result.matches ?? [];
      const localMatches = readJson<MatchItem[]>(CLOUD_STORAGE_KEYS.matches, []);
      if (cloudMatches.length > 0) {
        localStorage.setItem(CLOUD_STORAGE_KEYS.matches, JSON.stringify(clearMatchSelections(cloudMatches)));
      } else if (nextAccount.role === "admin" && localMatches.length > 0) {
        await saveMatchesImmediately(localMatches);
      }

      setAccount(nextAccount);
      setSyncStatus("saved");
      setGateStatus("ready");
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 401) {
        setGateStatus("signin");
        return;
      }
      setGateError(error instanceof Error ? error.message : "云端连接失败");
      setGateStatus("error");
    }
  }, [saveMatchesImmediately, savePersonalImmediately]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void bootstrap();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bootstrap]);

  useEffect(() => {
    const onPopState = () => setActiveView(viewForPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = accountNameError(accountDraft);
    if (validationError) {
      setGateError(validationError);
      return;
    }
    setGateError("");
    try {
      await requestJson("/api/cloud/account", {
        method: "POST",
        body: JSON.stringify({ account: accountDraft }),
      });
      await bootstrap();
    } catch (error) {
      setGateError(error instanceof Error ? error.message : "账号创建失败");
    }
  };

  const enqueueWrite = useCallback((task: () => Promise<void>) => {
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
      if ((error as Error & { status?: number }).status === 401) setGateStatus("signin");
    });
  }, []);

  const syncPersonal = useCallback((personal: CloudPersonalState) => {
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
    const path = pathForView(view);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setActiveView(view);
  };

  if (gateStatus === "loading") {
    return (
      <div className="app-loading-shell">
        <div className="app-loading-mark">☁</div>
        <b>正在连接云端数据</b>
        <span>加载账号、订单、设置与公共比赛…</span>
      </div>
    );
  }

  if (gateStatus === "signin") {
    return (
      <main className="cloud-gate">
        <section className="cloud-gate-card">
          <div className="cloud-gate-logo" aria-hidden="true">★</div>
          <span className="cloud-gate-kicker">SMGR CLOUD</span>
          <h1>登录后继续</h1>
          <p>无需为本应用设置密码。登录后，你的订单、收支和设置会自动同步到所有电脑。</p>
          <a className="cloud-gate-primary" href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 登录</a>
          <small>比赛与赔率数据由所有账号共用。</small>
        </section>
      </main>
    );
  }

  if (gateStatus === "account") {
    return (
      <main className="cloud-gate">
        <form className="cloud-gate-card" onSubmit={createAccount}>
          <div className="cloud-gate-logo" aria-hidden="true">★</div>
          <span className="cloud-gate-kicker">WELCOME {identityName ? `· ${identityName}` : ""}</span>
          <h1>创建唯一账号</h1>
          <p>账号用于显示和绑定个人数据。以后登录同一 ChatGPT 身份即可自动进入这个账号。</p>
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
          {gateError && <div className="cloud-gate-error">{gateError}</div>}
          <button className="cloud-gate-primary" type="submit">创建并进入</button>
          <small>支持中文、字母、数字、点、横线和下划线。</small>
        </form>
      </main>
    );
  }

  if (gateStatus === "error") {
    return (
      <main className="cloud-gate">
        <section className="cloud-gate-card">
          <div className="cloud-gate-logo error" aria-hidden="true">!</div>
          <span className="cloud-gate-kicker">CLOUD OFFLINE</span>
          <h1>暂时无法连接云端</h1>
          <p>{gateError}</p>
          <button className="cloud-gate-primary" type="button" onClick={() => void bootstrap()}>重新连接</button>
        </section>
      </main>
    );
  }

  return (
    <FootballApp
      initialView={activeView}
      onNavigate={navigate}
      cloudAccount={account!}
      cloudSyncStatus={syncStatus}
      onCloudPersonalChange={syncPersonal}
      onCloudMatchesChange={syncMatches}
    />
  );
}
