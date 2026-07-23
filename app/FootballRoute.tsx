"use client";

import { useRouter } from "next/navigation";
import FootballApp, { type AppView } from "./FootballApp";

export default function FootballRoute({ initialView }: { initialView: AppView }) {
  const router = useRouter();
  return <FootballApp initialView={initialView} onNavigate={(view) => router.push(view === "orders" ? "/orders" : view === "settings" ? "/settings" : "/")} />;
}
