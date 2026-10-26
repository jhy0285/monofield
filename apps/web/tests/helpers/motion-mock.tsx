import { forwardRef, type ComponentProps, type ElementType } from 'react';

function AnimatePresence({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

// Surfaces the reduced-motion preference to tests. Real motion/react uses this
// to gate transform animations on the OS `prefers-reduced-motion` setting; the
// mock just exposes the configured value so wiring can be asserted.
function MotionConfig({
  reducedMotion,
  children,
}: {
  reducedMotion?: 'always' | 'never' | 'user';
  children?: React.ReactNode;
}) {
  return <div data-testid="motion-config" data-reduced-motion={reducedMotion}>{children}</div>;
}

// One component type per tag. Creating a new forwardRef on every property
// access would hand React a different element type each render and remount
// the whole subtree, which the real library never does.
const motionComponents = new Map<string, ReturnType<typeof forwardRef>>();

const motionHandler: ProxyHandler<object> = {
  get(_target, prop: string) {
    const cached = motionComponents.get(prop);
    if (cached) return cached;
    const Component = forwardRef<unknown, ComponentProps<ElementType>>((props, ref) => {
      const {
        variants: _variants,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        whileHover: _whileHover,
        whileTap: _whileTap,
        transition: _transition,
        layout: _layout,
        layoutId: _layoutId,
        ...rest
      } = props as Record<string, unknown>;
      const Tag = prop as ElementType;
      return <Tag ref={ref} {...rest} />;
    });
    Component.displayName = `motion.${prop}`;
    motionComponents.set(prop, Component);
    return Component;
  },
};

const motion = new Proxy({}, motionHandler);

// Tests never run exit animations, so a mounted child is always present.
function useIsPresent(): boolean {
  return true;
}

export { AnimatePresence, MotionConfig, motion, useIsPresent };
