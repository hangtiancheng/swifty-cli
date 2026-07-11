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
