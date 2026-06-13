import { notFound } from "next/navigation";
import { loadAgentDetail } from "@/lib/agents";
import { SubscribeClient } from "./subscribe-client";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function SubscribePage({ params }: PageProps) {
  const { ticker } = await params;
  const agent = await loadAgentDetail(ticker.toUpperCase());
  if (!agent) notFound();

  return <SubscribeClient agent={agent} />;
}
