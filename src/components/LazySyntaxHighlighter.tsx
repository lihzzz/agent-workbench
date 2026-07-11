import type { CSSProperties, ElementType } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

interface LazySyntaxHighlighterProps {
  code: string;
  language: string;
  theme?: "dark" | "light";
  customStyle?: CSSProperties;
  codeTagProps?: { style?: CSSProperties };
  PreTag?: ElementType;
  CodeTag?: ElementType;
}

export function LazySyntaxHighlighter({
  code,
  language,
  theme = "dark",
  customStyle,
  codeTagProps,
  PreTag,
  CodeTag,
}: LazySyntaxHighlighterProps) {
  return (
    <SyntaxHighlighter
      style={theme === "light" ? oneLight : oneDark}
      language={language}
      PreTag={PreTag}
      CodeTag={CodeTag}
      customStyle={customStyle}
      codeTagProps={codeTagProps}
    >
      {code}
    </SyntaxHighlighter>
  );
}
