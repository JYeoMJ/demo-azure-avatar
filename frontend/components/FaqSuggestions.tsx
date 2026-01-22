"use client";

import React from "react";

interface FaqSuggestionsProps {
  onSelect: (question: string) => void;
}

const FAQ_QUESTIONS = [
  "What is DTT?",
  "Who is in the DTT Data Analytics team?",
  "What is DTT DA SWAT team about?",
  "What are the current projects?",
  "How do I submit a project request?",
  "How is a project request processed?",
];

export default function FaqSuggestions({ onSelect }: FaqSuggestionsProps) {
  return (
    <div className="text-center">
      <p className="text-xs text-gray-500 mb-2">Suggested questions:</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {FAQ_QUESTIONS.map((question) => (
          <button
            key={question}
            onClick={() => onSelect(question)}
            className="px-3 py-1.5 bg-white/70 hover:bg-white text-[#1E3A5F] text-xs
                     rounded-full border border-gray-200/60 hover:border-[#00A3B4]
                     transition-all hover:shadow-sm"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}
