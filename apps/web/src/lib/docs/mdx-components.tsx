// apps/web/src/lib/docs/mdx-components.tsx
import type { MDXComponents } from "mdx/types";
import { Callout } from "@/components/docs/callout";
import { Steps, Step } from "@/components/docs/steps";
import { AddressPill } from "@/components/docs/address-pill";
import { FlowDiagram } from "@/components/docs/flow-diagram";
import { HarnessMatrix } from "@/components/docs/harness-matrix";
import { SystemMap } from "@/components/docs/system-map";
import { ContractCard } from "@/components/docs/contract-card";

export const docsMdxComponents: MDXComponents = {
  Callout,
  Steps,
  Step,
  AddressPill,
  FlowDiagram,
  HarnessMatrix,
  SystemMap,
  ContractCard,
};
