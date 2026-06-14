// apps/web/src/lib/docs/mdx-components.tsx
import type { MDXComponents } from "mdx/types";

/**
 * Component map injected into every MDX doc. Standard HTML elements get
 * surface-docs prose styling via globals.css (.surface-docs .prose ...), so we
 * only need to register custom tags here. Bespoke figures are added in Task 17.
 */
export const docsMdxComponents: MDXComponents = {};
