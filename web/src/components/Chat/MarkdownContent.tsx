import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";

interface MarkdownContentProps {
  content: string;
}

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "u", "mark", "abbr",
  ],
  attributes: {
    ...defaultSchema.attributes,
    abbr: ["title"],
    span: ["className", "dataQuoteId"],
  },
};

const customComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return <code className="ei-code-inline" {...props}>{children}</code>;
    }
    return (
      <code className={`ei-code-block ${className || ""}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="ei-pre">{children}</pre>,
};

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="ei-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={customComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
