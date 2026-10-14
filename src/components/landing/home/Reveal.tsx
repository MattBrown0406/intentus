import type { CSSProperties, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInView } from "./useInView";

/** Fades and lifts its children in when scrolled into view. Static under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
}) {
  const { ref, inView } = useInView<HTMLElement>();
  const style: CSSProperties = { transitionDelay: `${delay}ms` };
  return (
    <Tag
      ref={ref}
      style={style}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0",
        inView ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
