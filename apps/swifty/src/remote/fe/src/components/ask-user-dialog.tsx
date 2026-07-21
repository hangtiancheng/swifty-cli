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

import { useState } from "react";
import type { AskUserItem, Question } from "../types";

interface QuestionDraft {
  radio: string;
  other: string;
  useOther: boolean;
}

interface AskUserDialogProps {
  item: AskUserItem;
  onAnswer: (id: string, answers: Record<string, string>) => void;
}

export function AskUserDialog({ item, onAnswer }: AskUserDialogProps) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});

  const getDraft = (key: string): QuestionDraft =>
    drafts[key] ?? { radio: "", other: "", useOther: false };

  const updateDraft = (key: string, patch: Partial<QuestionDraft>) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...getDraft(key), ...patch } }));
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    item.questions.forEach((_, qi) => {
      const d = getDraft(`${item.id}_${qi}`);
      answers[`question_${qi}`] = d.useOther ? d.other : d.radio;
    });
    onAnswer(item.id, answers);
  };

  if (item.answered) {
    return (
      <div className="my-3 rounded-lg border-2 border-yellow bg-surface p-4">
        <div className="text-dim">✓ Answered</div>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border-2 border-yellow bg-surface p-4">
      <div className="mb-3 font-bold text-yellow">❓ Question</div>
      {item.questions.map((q, qi) => {
        const key = `${item.id}_${qi}`;
        const draft = getDraft(key);
        return (
          <QuestionRow
            key={key}
            question={q}
            name={`ask_${item.id}_${qi}`}
            draft={draft}
            onChange={(patch) => updateDraft(key, patch)}
          />
        );
      })}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="cursor-pointer rounded border border-green bg-green px-4 py-1.5 text-[13px] text-bg"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

interface QuestionRowProps {
  question: Question;
  name: string;
  draft: QuestionDraft;
  onChange: (patch: Partial<QuestionDraft>) => void;
}

function QuestionRow({ question, name, draft, onChange }: QuestionRowProps) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-bright">{question.question || question.header}</div>
      {question.options.map((opt) => (
        <label key={opt.label} className="my-1 block cursor-pointer">
          <input
            type="radio"
            name={name}
            value={opt.label}
            checked={!draft.useOther && draft.radio === opt.label}
            onChange={() => onChange({ radio: opt.label, useOther: false })}
            className="mr-1.5"
          />
          <span className="text-blue">{opt.label}</span>
          {opt.description && <span className="ml-1 text-xs text-dim">— {opt.description}</span>}
        </label>
      ))}
      <label className="my-1 block cursor-pointer">
        <input
          type="radio"
          name={name}
          value="__other__"
          checked={draft.useOther}
          onChange={() => onChange({ useOther: true })}
          className="mr-1.5"
        />
        <span className="text-dim">Other: </span>
        <input
          type="text"
          value={draft.other}
          onChange={(e) => onChange({ other: e.target.value, useOther: true })}
          className="w-[300px] rounded border border-border bg-input px-2 py-1 font-[inherit] text-[13px] text-base"
        />
      </label>
    </div>
  );
}
