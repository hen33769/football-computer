import type { Metadata } from "next";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "竞彩足球模拟工具",
  description: "使用官方比赛与倍率数据，支持自由串关、订单跟踪、奖金与利润区间计算的非官方竞彩足球模拟工具。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
