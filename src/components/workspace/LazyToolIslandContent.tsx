import { lazy, memo, Suspense } from "react";
import type { ToolIslandContentProps } from "@/components/workspace/ToolIslandContent";

const ToolIslandContentImpl = lazy(() =>
  import("@/components/workspace/ToolIslandContent").then((mod) => ({ default: mod.ToolIslandContent })),
);

export const LazyToolIslandContent = memo(function LazyToolIslandContent(props: ToolIslandContentProps) {
  return (
    <Suspense fallback={<div className="h-full min-h-0 w-full" />}>
      <ToolIslandContentImpl {...props} />
    </Suspense>
  );
});
