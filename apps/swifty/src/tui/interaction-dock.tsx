import { useRef, type ComponentProps } from "react";

import { AskUserDialog } from "./ask-user-dialog.js";
import type { InputDraft } from "./input-draft.js";
import { InputBox } from "./input.js";
import { PermissionDialog } from "./permission-dialog.js";
import { PlanApprovalDialog } from "./plan-approval.js";
import { ProviderSelect } from "./provider-select.js";
import RewindDialog from "./rewind-dialog.js";
import { SessionSelector } from "./session-selector.js";
import { TeamsDialog } from "./teams-dialog.js";

interface Props {
  provider?: ComponentProps<typeof ProviderSelect>;
  planApproval?: ComponentProps<typeof PlanApprovalDialog>;
  rewind?: ComponentProps<typeof RewindDialog>;
  resume?: ComponentProps<typeof SessionSelector>;
  permission?: ComponentProps<typeof PermissionDialog>;
  askUser?: ComponentProps<typeof AskUserDialog>;
  teams?: ComponentProps<typeof TeamsDialog>;
  composer: ComponentProps<typeof InputBox>;
}

export function InteractionDock({
  provider,
  planApproval,
  rewind,
  resume,
  permission,
  askUser,
  teams,
  composer,
}: Props) {
  const draftRef = useRef<InputDraft | null>(null);
  if (provider) {
    return <ProviderSelect {...provider} />;
  }
  if (planApproval) {
    return <PlanApprovalDialog {...planApproval} />;
  }
  if (rewind) {
    return <RewindDialog {...rewind} />;
  }
  if (resume) {
    return <SessionSelector {...resume} />;
  }
  if (permission) {
    return <PermissionDialog {...permission} />;
  }
  if (askUser) {
    return <AskUserDialog {...askUser} />;
  }
  if (teams) {
    return <TeamsDialog {...teams} />;
  }
  return <InputBox {...composer} draftRef={draftRef} />;
}
