/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
