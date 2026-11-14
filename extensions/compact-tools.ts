import { highlightCode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const labels: Record<string, string> = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  memory_write: "Memory",
};

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function (pi: ExtensionAPI) {
  pi.registerToolRenderer((name, next) => {
    const label = labels[name];
    if (!label) return next();
    const original = next();

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        const target = name === "bash" ? oneLine(args.command) : name === "memory_write" ? oneLine(args.target) : oneLine(args.path);
        const state = context.isError ? "error" : context.isPartial ? "warning" : "success";
        const elapsed = duration(context.durationMs);
        return new Text(
          theme.fg(state, "● ") +
            theme.fg("toolTitle", theme.bold(label)) +
            (target ? `  ${name === "bash" ? highlightCode(target, "bash").join(" ") : theme.fg("muted", target)}` : "") +
            (elapsed ? theme.fg("dim", `  ${elapsed}`) : ""),
          0,
          0,
        );
      },
      renderResult(result, options, theme, context) {
        if (options.isPartial && !result.content.length) return new Text(theme.fg("dim", "  └ Running…"), 0, 0);
        if (options.expanded && original?.renderResult) return original.renderResult(result, options, theme, context);

        const output = result.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trimEnd();
        if (!output) return new Text(theme.fg(context.isError ? "error" : "dim", options.isPartial ? "  └ Running…" : context.isError ? "  └ Failed" : "  └ Done"), 0, 0);

        const lines = output.split("\n");
        if (context.isError && !options.expanded) {
          const nonempty = lines.filter((line) => line.trim());
          const error = nonempty.find((line) => /\b(error|fatal|failed|failure)\b/i.test(line)) ?? nonempty[0];
          const exit = [...nonempty].reverse().find((line) => /(?:exit(?:ed)? (?:with )?(?:code )?\d+|exit code[: ]+\d+)/i.test(line));
          const summary = [error, exit !== error ? exit : undefined].filter((line): line is string => Boolean(line));
          return {
            invalidate() {},
            render(width: number) {
              const prefix = "  │ ";
              const available = Math.max(0, width - visibleWidth(prefix));
              const rows = summary.map((line) => theme.fg("dim", prefix) + theme.fg("error", truncateToWidth(line.trim(), available, "…")));
              const hidden = lines.length > summary.length || summary.some((line) => visibleWidth(line.trim()) > available);
              if (hidden) rows.push(truncateToWidth(theme.fg("dim", "  └ … expand for details"), width));
              return rows.map((line) => truncateToWidth(line, width));
            },
          };
        }
        const limit = options.expanded ? lines.length : 3;
        const shown = lines.slice(0, limit);
        const hidden = lines.length - shown.length;
        const rendered = shown.map((line, index) => {
          const last = index === shown.length - 1 && hidden === 0;
          return theme.fg("dim", last ? "  └ " : "  │ ") + theme.fg(context.isError ? "error" : "toolOutput", line);
        });
        if (hidden > 0) rendered.push(theme.fg("dim", `  └ … ${hidden} more lines (expand for details)`));
        return new Text(rendered.join("\n"), 0, 0);
      },
    };
  });
}
