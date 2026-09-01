"use client";

import { Badge, Button, Popover, Tag } from "antd";
import {
  FileTextOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { RefObject } from "react";
import { APP_VERSION } from "../AppVersion";
import { CLOUD_APP_URL } from "../links";
import type { CloudAccount, CloudSyncStatus } from "../cloud";

type AppView = "betting" | "orders" | "settings";

type AppShellHeaderProps = {
  activeView: AppView;
  cloudAccount: CloudAccount | null;
  cloudSyncStatus: CloudSyncStatus;
  headerRef: RefObject<HTMLElement | null>;
  isGuestMode: boolean;
  unsettledOrderCount: number;
  onAddOrder: () => void;
  onLogout: () => Promise<void>;
  onNavigate: (view: AppView) => void;
  onRequireAccount: () => void;
};

export function AppShellHeader({
  activeView,
  cloudAccount,
  cloudSyncStatus,
  headerRef,
  isGuestMode,
  unsettledOrderCount,
  onAddOrder,
  onLogout,
  onNavigate,
  onRequireAccount,
}: AppShellHeaderProps) {
  const syncLabel = isGuestMode
    ? "游客数据仅保存在当前浏览器"
    : cloudSyncStatus === "saving"
      ? "正在保存到云端"
      : cloudSyncStatus === "error"
        ? "云同步失败，请刷新后重试"
        : "云端数据已同步";

  const accountMenu = cloudAccount ? (
    <div className="cloud-account-menu">
      <div>
        <b>{cloudAccount.account}</b>
        <Tag color={isGuestMode ? "default" : cloudAccount.role === "admin" ? "gold" : "blue"}>
          {isGuestMode ? "本地模式" : cloudAccount.role === "admin" ? "管理员" : "账号"}
        </Tag>
      </div>
      <span className={cloudSyncStatus === "error" ? "error" : ""}>{syncLabel}</span>
      {isGuestMode
        ? <Button icon={<UserOutlined />} block href={CLOUD_APP_URL}>登录云端账号</Button>
        : <Button icon={<LogoutOutlined />} block onClick={() => { void onLogout(); }}>退出账号</Button>}
    </div>
  ) : null;

  return (
    <>
      <header className="hero-header" ref={headerRef}>
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="brand-lockup">
            <div className="brand-logo" role="img" aria-label="SMGR" />
            <div><p>中国以小博大 · 玩法模拟 · v{APP_VERSION}</p><h1>Small Money Get Rich</h1></div>
          </div>
          <div className="hero-actions">
            {activeView === "orders" && (
              <Button icon={<PlusOutlined />} onClick={onAddOrder}>
                <span className="header-button-label">添加订单</span>
              </Button>
            )}
            <Button className={activeView === "betting" ? "view-toggle active" : "view-toggle"} icon={<HomeOutlined />} onClick={() => onNavigate("betting")}>
              <span className="header-button-label">投注</span>
            </Button>
            <Badge className="order-navigation-badge" count={unsettledOrderCount} size="small" offset={[-12, 4]} onClick={() => onNavigate("orders")}>
              <Button className={activeView === "orders" ? "view-toggle active" : "view-toggle"} icon={<FileTextOutlined />}>
                <span className="header-button-label">订单</span>
              </Button>
            </Badge>
            <Button className={activeView === "settings" ? "view-toggle active" : "view-toggle"} icon={<SettingOutlined />} onClick={() => onNavigate("settings")}>
              <span className="header-button-label">设置</span>
            </Button>
            {cloudAccount ? (
              <Popover content={accountMenu} trigger="click" placement="bottomRight">
                <Button className="cloud-account-button" icon={<UserOutlined />}>
                  <span className="header-button-label">{cloudAccount.account}</span>
                </Button>
              </Popover>
            ) : (
              <Button className="cloud-account-button" icon={<UserOutlined />} onClick={onRequireAccount}>
                <span className="header-button-label">账号登录</span>
              </Button>
            )}
          </div>
        </div>
        <div className="responsible-note"><InfoCircleOutlined /> 非官方模拟工具 · 模拟器随便玩</div>
      </header>
      <div className="hero-header-spacer" aria-hidden="true" />
    </>
  );
}
