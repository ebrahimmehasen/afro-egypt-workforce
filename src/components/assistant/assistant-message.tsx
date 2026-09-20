import { Fragment } from "react";
import { parseBlocks, parseInline } from "@/lib/assistant/markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.type === "bold" ? (
          <strong key={i} className="font-semibold">
            {part.text}
          </strong>
        ) : part.type === "code" ? (
          <code key={i} dir="ltr" className="rounded bg-background/70 px-1 py-0.5 text-[0.85em]">
            {part.text}
          </code>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

/** An assistant answer as real elements — the model's text is never inserted as HTML. */
export function AssistantMessage({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return (
              <p key={i} className={b.level === 1 ? "text-base font-bold" : "font-semibold"}>
                <Inline text={b.text} />
              </p>
            );
          case "paragraph":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 ps-5">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 ps-5">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-background/60">
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} className="border-b border-border px-2 py-1.5 text-start font-semibold">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border/60 last:border-0">
                        {row.map((cell, c) => (
                          <td key={c} className="px-2 py-1.5 align-top">
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
