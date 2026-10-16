/** The one footer action that renders the video and fills the page's box. */
import { t, type MessageKey } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import type { ChainStage, RenderAndFill } from "./useRenderAndFill";

const STAGE_LABEL: Record<Exclude<ChainStage, "idle">, MessageKey> = {
  writing: "chain_writing",
  saving: "chain_saving",
  rendering: "chain_rendering",
  backToPage: "chain_backToPage",
  filling: "chain_filling",
};

export function RenderAndFillButton({
  chain,
  labelKey,
  disabled,
}: {
  chain: RenderAndFill;
  /** e.g. "Render video & fill LinkedIn message". */
  labelKey: MessageKey;
  disabled?: boolean;
}) {
  const { stage } = chain;
  const waiting = stage === "rendering" || stage === "backToPage";
  return (
    <Button
      variant="promote"
      block
      icon="video"
      busy={stage !== "idle" && !waiting}
      disabled={disabled || waiting}
      onClick={chain.start}
    >
      {stage === "idle" ? t(labelKey) : t(STAGE_LABEL[stage])}
    </Button>
  );
}
