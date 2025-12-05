import { FeedbackWidget } from "./FeedbackWidget";

interface JudgeFeedbackPanelProps {
  judgeName: string;
  judgeModel: string;
  evalRepo: string;
  benchmarkCommit: string;
  agentModel: string;
  episodeIndex: number;
  scoreType: string;
}

export function JudgeFeedbackPanel({
  judgeName,
  evalRepo,
  benchmarkCommit,
  agentModel,
  episodeIndex,
  scoreType,
}: JudgeFeedbackPanelProps) {
  const componentId = `${scoreType}:${judgeName}:episode-${episodeIndex}`;

  const questions = [
    {
      type: "binary" as const,
      label: "Do you agree with this judge's decision?",
    },
    {
      type: "rating" as const,
      label: "This judge was:",
      options: ["Too strict", "Just right", "Too lenient"],
    },
    {
      type: "text" as const,
      label: "What did the judge get wrong? (optional)",
    },
  ];

  return (
    <FeedbackWidget
      componentType="judge"
      componentId={componentId}
      evalRepo={evalRepo}
      benchmarkCommit={benchmarkCommit}
      agentModel={agentModel}
      questions={questions}
    />
  );
}
