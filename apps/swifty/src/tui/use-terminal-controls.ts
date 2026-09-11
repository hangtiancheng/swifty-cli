import { useInput, useStdout } from "ink";
import { useEffect, useRef, useState, type RefObject } from "react";

interface Options {
  isStreaming: boolean;
  abortControllerRef: RefObject<AbortController | null>;
  clearInputRef: RefObject<(() => void) | null>;
  onExit: () => void;
  teamsDialogOpen: boolean;
  onToggleTeams: () => void;
}

export function useTerminalControls({
  isStreaming,
  abortControllerRef,
  clearInputRef,
  onExit,
  teamsDialogOpen,
  onToggleTeams,
}: Options) {
  const { stdout } = useStdout();
  const termWidthRef = useRef(stdout.columns || 80);
  const [termWidth, setTermWidth] = useState(termWidthRef.current);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [ctrlCHint, setCtrlCHint] = useState(false);
  const ctrlCCountRef = useRef(0);
  const ctrlCTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        const width = stdout.columns || 80;
        if (width === termWidthRef.current) {
          return;
        }
        termWidthRef.current = width;
        // Rewrapped Static rows require a viewport clear; retain native scrollback.
        stdout.write("\x1b[2J\x1b[H");
        setTermWidth(width);
      }, 150);
    };
    stdout.on("resize", onResize);
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  useEffect(
    () => () => {
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
    },
    [],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (isStreaming && abortControllerRef.current) {
        abortControllerRef.current.abort();
        ctrlCCountRef.current = 0;
        return;
      }
      ctrlCCountRef.current += 1;
      if (ctrlCCountRef.current >= 2) {
        onExit();
        return;
      }
      clearInputRef.current?.();
      setCtrlCHint(true);
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
      }
      ctrlCTimerRef.current = setTimeout(() => {
        ctrlCCountRef.current = 0;
        setCtrlCHint(false);
      }, 2000);
      return;
    }

    if (input.includes("[<") && /\[<\d+;\d+;\d+[Mm]/.test(input)) {
      return;
    }

    if (ctrlCCountRef.current > 0) {
      ctrlCCountRef.current = 0;
      setCtrlCHint(false);
      if (ctrlCTimerRef.current) {
        clearTimeout(ctrlCTimerRef.current);
        ctrlCTimerRef.current = null;
      }
    }
  });

  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      // Static content must be remounted to reflect expanded tool output.
      stdout.write("\x1b[2J\x1b[H");
      setToolsExpanded((expanded) => !expanded);
    }
  });

  useInput(
    (input, key) => {
      if (key.ctrl && input === "t" && !isStreaming) {
        onToggleTeams();
      }
    },
    { isActive: !teamsDialogOpen },
  );

  return { termWidth, toolsExpanded, ctrlCHint };
}
