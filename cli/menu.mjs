// The menus `npx @aurb/player` shows at a terminal. @clack/core does the terminal work (raw keys, filtering, redrawing in
// place, resizes, cancelling) and @clack/prompts gives its symbols, with plain ASCII ones in consoles that lack them;
// this file only draws the frames. The build bundles all of it into bin/, so @aurb/player still has no dependencies, and
// loads it only when a menu is shown, so every other command starts as fast as before.
import { AutocompletePrompt, SelectPrompt, isCancel } from "@clack/core";
import { S_BAR, S_BAR_END, S_BAR_START, S_RADIO_ACTIVE, S_RADIO_INACTIVE, S_STEP_ACTIVE, S_STEP_CANCEL, S_STEP_ERROR, S_STEP_SUBMIT, unicodeOr } from "@clack/prompts";
import measure from "fast-string-width";
import { colour, styleText as style } from "./style.mjs";

const out = process.stdout;
const ELLIPSIS = unicodeOr("…", "...");
const KEYS = unicodeOr("↑↓", "up/down");

// Cut text to at most `max` columns, ending in an ellipsis when cut. Colour codes take no room and wide characters two,
// measured as the library measures before it wraps a line, so a line that fits here is never wrapped there. (Its own
// truncation is not used: it cuts a character or two late once a line holds symbols such as ↑ or ·.)
const width = measure;
export function fit(text, max) {
  if (width(text) <= max) return text;
  const room = max - width(ELLIPSIS);
  let cut = "", w = 0;
  for (const [, code, ch] of text.matchAll(/(\x1b\[[0-9;?]*[A-Za-z])|(\P{M}\p{M}*)/gsu)) {
    if (code) { cut += code; continue; }
    if (w + width(ch) > room) break;
    cut += ch;
    w += width(ch);
  }
  return `${cut}${ELLIPSIS}${colour() ? "\x1b[0m" : ""}`;
}

// Every line stops a column short of the edge. A line exactly as wide as the window wraps in Windows' console, and the
// redraw, which moves up over the rows it drew last, would then move up too few and leave a copy of the menu behind.
// And no line is longer than 100 columns, nor the list longer than 8, so that when a window is made narrower and the
// terminal rewraps what's on screen, the menu still fits in it: rows pushed off the top could never be redrawn.
const room = () => Math.min(100, (out.columns || 80) - 1);

// When the window gets narrower, the terminal rewraps the menu already on screen, cutting each line at the edge, character
// by character. The library counts those rows by wrapping at word breaks instead, which can come to one more for a long
// line, so it would move up too far and draw over the line above the menu. Here they're counted as the terminal does,
// and after a change of width the menu is drawn again whole, not just the lines that changed, since a line that used to
// be longer can now take two rows.
const rewrapped = (Prompt) =>
  class extends Prompt {
    restoreCursor() {
      const cols = out.columns || 80;
      const rows = this._prevFrame.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(width(line) / cols)), 0);
      this.output.write(`\x1b[999D${rows > 1 ? `\x1b[${rows - 1}A` : ""}`);
    }
    render() {
      if (this._prevFrame && this.cols !== out.columns) {
        this.restoreCursor();
        this.output.write("\x1b[J");
        this._prevFrame = "";
      }
      this.cols = out.columns;
      super.render();
    }
  };

export function intro() {
  const name = colour() ? style(["bgCyan", "black", "bold"], " aurb ") : style("bold", "aurb");
  out.write(`${fit(`${style("gray", S_BAR_START)}  ${name}  ${style("dim", "animated orbs for AI products")}`, room())}\n`);
}

export function outro(text) {
  out.write(`${style("gray", S_BAR)}\n${fit(`${style("gray", S_BAR_END)}  ${text}`, room())}\n`);
}

export function cancelled() {
  out.write(`${style("gray", S_BAR_END)}  ${style("dim", "Cancelled.")}\n`);
}

// One choice: `items` are { value, label, hint, tag }, each drawn on one line, a description cut short rather than wrapped.
// With `filter`, typing narrows the list by name. Resolves to the chosen value, or undefined if cancelled.
export async function menu({ question, answer, items, start = 0, filter = false }) {
  const pad = Math.max(...items.map((x) => width(x.label)));
  const option = (x, on) => {
    const dot = on ? style("cyan", S_RADIO_ACTIVE) : style("dim", S_RADIO_INACTIVE);
    const head = `${dot} ${on ? style("bold", x.label) : x.label}${" ".repeat(pad - width(x.label))}`;
    const tag = x.tag ? `  ${style("yellow", x.tag)}` : "";
    const left = room() - 3 - width(head) - width(tag) - 2; // 3 for the bar in front, 2 between name and description
    const hint = x.hint && left >= 8 ? `  ${style(on ? [] : "dim", fit(x.hint, left))}` : "";
    return `${head}${hint}${tag}`;
  };

  function render() {
    const bar = style(this.state === "error" ? "yellow" : "cyan", S_BAR), gray = style("gray", S_BAR);
    const list = filter ? this.filteredOptions : this.options;
    if (this.state === "submit" || this.state === "cancel") {
      const chosen = this.state === "submit" && items.find((x) => x.value === this.value);
      const line = chosen ? `${style("green", S_STEP_SUBMIT)}  ${answer}  ${style("bold", chosen.label)}` : `${style("gray", S_STEP_CANCEL)}  ${style("dim", question)}`;
      return [gray, line].map((l) => fit(l, room())).join("\n");
    }
    const typed = filter && this.userInput;
    const symbol = this.state === "error" ? style("yellow", S_STEP_ERROR) : style("cyan", S_STEP_ACTIVE);
    const search = !filter ? "" : typed ? `  ${style("cyan", this.userInputWithCursor)}` : `  ${style("dim", "type to filter")}`;
    const count = typed ? style("dim", `  ${list.length} ${list.length === 1 ? "match" : "matches"}`) : "";
    const lines = [gray, `${symbol}  ${style("bold", question)}${search}${count}`];

    // As many as fit, so the whole menu is always on screen.
    const rows = Math.max(1, Math.min(8, (out.rows || 24) - 6));
    const at = Math.max(0, Math.min(this.cursor, list.length - 1));
    const top = Math.max(0, Math.min(at - Math.floor(rows / 2), list.length - rows));
    list.slice(top, top + rows).forEach((x, i) => lines.push(`${bar}  ${option(x, top + i === at)}`));
    if (!list.length) lines.push(`${bar}  ${style("yellow", this.state === "error" ? this.error : `Nothing matches "${this.userInput}"`)}`);

    const keys = [`${KEYS} move`, filter && "type to filter", "enter choose", "esc cancel"].filter(Boolean).join(" · ");
    const where = list.length > rows ? `${at + 1} of ${list.length}  ` : "";
    // The keys go above a last line that's only "└", where the cursor waits: terminals differ on whether they rewrap the
    // cursor's own line when the window narrows, so that line is kept too short to need it.
    lines.push(`${bar}  ${style("dim", `${where}${keys}`)}`, style(this.state === "error" ? "yellow" : "cyan", S_BAR_END));
    return lines.map((l) => fit(l, room())).join("\n");
  }

  const options = items.map((x) => ({ ...x }));
  const value = await (filter
    ? new (rewrapped(AutocompletePrompt))({
        options,
        initialValue: [options[start]?.value],
        filter: (q, x) => x.label.toLowerCase().includes(q.trim().toLowerCase()),
        validate: (v) => (v === undefined ? "Nothing matches. Backspace to change the filter, or esc to cancel." : undefined),
        render,
      })
    : new (rewrapped(SelectPrompt))({ options, initialValue: options[start]?.value, render })
  ).prompt();
  return isCancel(value) ? undefined : value;
}
