import { useState } from "react";
import type { ErrorAnalysisFeedback } from "../../types/benchmark";
import { saveFeedback, generateFeedbackId } from "../../utils/feedback";
import { ThumbsUp, ThumbsDown, Send } from "lucide-react";

interface FeedbackWidgetProps {
  componentType: ErrorAnalysisFeedback["componentType"];
  componentId: string;
  evalRepo: string;
  benchmarkCommit: string;
  agentModel?: string;
  questions: {
    type: "binary" | "rating" | "text";
    label: string;
    options?: string[];
  }[];
  onSubmit?: () => void;
}

export function FeedbackWidget({
  componentType,
  componentId,
  evalRepo,
  benchmarkCommit,
  agentModel,
  questions,
  onSubmit,
}: FeedbackWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const feedback: ErrorAnalysisFeedback = {
      feedbackId: generateFeedbackId(),
      timestamp: new Date().toISOString(),
      componentType,
      componentId,
      evalRepo,
      benchmarkCommit,
      agentModel,
      rating: responses.rating,
      category: responses.category,
      comment: responses.comment,
    };

    saveFeedback(feedback);
    setSubmitted(true);
    setExpanded(false);
    onSubmit?.();

    setTimeout(() => setSubmitted(false), 3000);
  };

  if (submitted) {
    return (
      <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
        Thank you for your feedback!
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700 transition-colors flex items-center justify-center gap-2"
      >
        <ThumbsUp className="w-4 h-4" />
        Provide Feedback
      </button>
    );
  }

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm text-gray-900">Provide Feedback</h4>
        <button
          onClick={() => setExpanded(false)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          Close
        </button>
      </div>

      {questions.map((question, index) => (
        <div key={index} className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            {question.label}
          </label>

          {question.type === "binary" && (
            <div className="flex gap-2">
              <button
                onClick={() => setResponses({ ...responses, rating: "agree" })}
                className={`flex-1 p-2 rounded-lg border-2 transition-colors flex items-center justify-center gap-2 ${
                  responses.rating === "agree"
                    ? "border-green-500 bg-green-50 text-green-700"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <ThumbsUp className="w-4 h-4" />
                Agree
              </button>
              <button
                onClick={() => setResponses({ ...responses, rating: "disagree" })}
                className={`flex-1 p-2 rounded-lg border-2 transition-colors flex items-center justify-center gap-2 ${
                  responses.rating === "disagree"
                    ? "border-red-500 bg-red-50 text-red-700"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <ThumbsDown className="w-4 h-4" />
                Disagree
              </button>
            </div>
          )}

          {question.type === "rating" && question.options && (
            <div className="space-y-1">
              {question.options.map((option) => (
                <label key={option} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`question-${index}`}
                    value={option}
                    checked={responses.category === option}
                    onChange={(e) =>
                      setResponses({ ...responses, category: e.target.value })
                    }
                    className="text-blue-600"
                  />
                  <span className="text-sm text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          )}

          {question.type === "text" && (
            <textarea
              value={responses.comment || ""}
              onChange={(e) =>
                setResponses({ ...responses, comment: e.target.value })
              }
              className="w-full p-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Your feedback..."
            />
          )}
        </div>
      ))}

      <button
        onClick={handleSubmit}
        disabled={Object.keys(responses).length === 0}
        className="w-full p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Send className="w-4 h-4" />
        Submit Feedback
      </button>
    </div>
  );
}
