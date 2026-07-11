import { memo, useEffect, useMemo, useState } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { loadLucideIcon, resolveCommonLucideIcon } from "@/lib/icon-utils";

interface DynamicLucideIconProps extends Omit<LucideProps, "ref"> {
  name: string | null | undefined;
  fallback?: LucideIcon;
}

export const DynamicLucideIcon = memo(function DynamicLucideIcon({
  name,
  fallback: Fallback,
  ...props
}: DynamicLucideIconProps) {
  const commonIcon = useMemo(() => resolveCommonLucideIcon(name), [name]);
  const lookupName = name?.trim() ?? "";
  const [loaded, setLoaded] = useState<{ name: string; Icon: LucideIcon | null } | null>(null);

  useEffect(() => {
    if (!lookupName || commonIcon) {
      setLoaded(null);
      return;
    }

    let cancelled = false;
    void loadLucideIcon(lookupName).then((Icon) => {
      if (!cancelled) setLoaded({ name: lookupName, Icon });
    });

    return () => {
      cancelled = true;
    };
  }, [commonIcon, lookupName]);

  const Icon = commonIcon ?? (loaded?.name === lookupName ? loaded.Icon : null);
  if (Icon) return <Icon {...props} />;

  return Fallback ? <Fallback {...props} /> : null;
});
