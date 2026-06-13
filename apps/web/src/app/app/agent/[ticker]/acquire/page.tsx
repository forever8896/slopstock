import { notFound } from "next/navigation";
import { loadAgentDetail } from "@/lib/agents";
import { AcquireClient } from "./acquire-client";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function AcquirePage({ params }: PageProps) {
  const { ticker } = await params;
  const agent = await loadAgentDetail(ticker.toUpperCase());
  if (!agent) notFound();

  return <AcquireClient agent={agent} />;
}
