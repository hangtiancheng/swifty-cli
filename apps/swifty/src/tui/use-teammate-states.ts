import { useEffect, useState } from "react";

import type { TeammateUIState } from "../teams/progress.js";
import type { TeamManager } from "../teams/team.js";

export function useTeammateStates(manager: TeamManager) {
  const [states, setStates] = useState<TeammateUIState[]>([]);

  useEffect(() => {
    let signature = "";
    const timer = setInterval(() => {
      const next = manager.getAllTeammateStates();
      const nextSignature = JSON.stringify(next);
      if (nextSignature !== signature) {
        signature = nextSignature;
        setStates(next);
      }
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [manager]);

  return states;
}
