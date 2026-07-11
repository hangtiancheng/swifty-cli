import { forwardRef, useImperativeHandle } from "react";
import { Box } from "ink";

export interface ScrollBoxHandle {
  scrollToBottom: () => void;
  isSticky: () => boolean;
}

interface Props {
  children: React.ReactNode;
  stickyScroll?: boolean;
}

// Simplified ScrollBox: In alt-screen mode, Ink automatically manages the rendering area.
// When content overflows the viewport, clearTerminal only affects the alt-screen (no flickering).
// Custom scrolling is not yet implemented; it will be enhanced later with virtual scrolling and mouse events.
export const ScrollBox = forwardRef<ScrollBoxHandle, Props>(function ScrollBox({ children }, ref) {
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: () => {
        /** noop */
      },
      isSticky: () => true,
    }),
    [],
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
});
