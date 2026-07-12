// Alternate screen buffer — prevents flicker by isolating TUI rendering from scrollback
import { useEffect, useState } from "react";
import { Box, useStdout } from "ink";

interface Props {
  children: React.ReactNode;
}

declare global {
  var __swifty_code_alt_screen__: boolean;
}

export function AlternateScreen({ children }: Props): React.JSX.Element {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows || 24);

  useEffect(() => {
    stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
    globalThis.__swifty_code_alt_screen__ = true;

    const onResize = (): void => {
      setRows(stdout.rows || 24);
    };
    stdout.on("resize", onResize);

    return () => {
      stdout.off("resize", onResize);
      globalThis.__swifty_code_alt_screen__ = false;
      stdout.write("\x1b[?1049l");
    };
  }, [stdout]);

  return (
    <Box height={rows} flexDirection="column" overflow="hidden">
      {children}
    </Box>
  );
}
