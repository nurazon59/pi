import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { ConfigLoader } from "@0xkahi/pi-vim-keys/src/config-loader";
import { VimModalEditor } from "@0xkahi/pi-vim-keys/src/vim-modal-editor";

export function renderPlanBorder(border: string, width: number, label: string, vimLabel: string, style: (text: string) => string): string {
  const labelWidth = visibleWidth(label);
  if (width < labelWidth + visibleWidth(vimLabel) + 2 || visibleWidth(border) < width) return border;
  return style(label) + sliceByColumn(border, labelWidth, width - labelWidth);
}

class ContextualCtrlPEditor extends VimModalEditor {
  planEnabled = false;
  stylePlanLabel: (enabled: boolean, text: string) => string = (_enabled, text) => text;

  setPlanEnabled(enabled: boolean): void {
    this.planEnabled = enabled;
    this.tui.requestRender();
  }

  protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
    const border = super.renderBottomBorder(width, hiddenLineCount);
    const label = this.planEnabled ? " PLAN " : " BUILD ";
    return renderPlanBorder(border, width, label, this.modeLabel, (text) => this.stylePlanLabel(this.planEnabled, text));
  }

  handleInput(data: string): void {
    if (this.isShowingAutocomplete() && matchesKey(data, "ctrl+p")) {
      super.handleInput("\x1b[A");
      return;
    }
    super.handleInput(data);
  }
}

export default function (pi: ExtensionAPI) {
  let cleanupEditor = () => {};
  let activeEditor: ContextualCtrlPEditor | undefined;
  let planEnabled = false;

  pi.events.on("plan-mode:state", (value) => {
    if (typeof value !== "boolean") return;
    planEnabled = value;
    activeEditor?.setPlanEnabled(value);
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const config = new ConfigLoader();
    const { error } = config.initializeConfig(ctx);
    if (error) ctx.ui.notify(error, "error");

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      cleanupEditor();
      const editor = new ContextualCtrlPEditor(tui, theme, keybindings, {
        config,
        getTheme: () => ctx.ui.theme,
        emitEvent: (channel, data) => pi.events.emit(channel, data),
      });
      editor.planEnabled = planEnabled;
      editor.stylePlanLabel = (enabled, text) => ctx.ui.theme.fg(enabled ? "warning" : "muted", ctx.ui.theme.bold(text));
      activeEditor = editor;
      cleanupEditor = () => editor.cleanup();
      return editor;
    });
    pi.events.emit("plan-mode:request-state", undefined);
  });

  pi.on("session_shutdown", () => {
    cleanupEditor();
    cleanupEditor = () => {};
    activeEditor = undefined;
  });
}
