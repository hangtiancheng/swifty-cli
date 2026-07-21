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

import { useEffect, useState } from "react";
import { Box, useStdout } from "ink";

interface Props {
  children: React.ReactNode;
}

declare global {
  var __swifty_alt_screen__: boolean;
}

export function AlternateScreen({ children }: Props) {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows || 24);

  useEffect(() => {
    // Enter alternate screen buffer, clear screen, and reset cursor position
    stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
    // Set global flag so the Ink renderer skips the clearTerminal path
    globalThis.__swifty_alt_screen__ = true;

    const onResize = () => {
      setRows(stdout.rows || 24);
    };
    stdout.on("resize", onResize);

    return () => {
      stdout.off("resize", onResize);
      globalThis.__swifty_alt_screen__ = false;
      stdout.write("\x1b[?1049l");
    };
  }, []);

  return (
    <Box height={rows} flexDirection="column" overflow="hidden">
      {children}
    </Box>
  );
}
