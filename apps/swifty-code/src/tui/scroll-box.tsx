// ScrollBox: placeholder for future virtual scrolling.
// In alt-screen mode Ink manages the render area automatically.
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
