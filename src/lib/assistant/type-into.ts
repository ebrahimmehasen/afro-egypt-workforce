// Types text into a field of the open dialog a little at a time, so the admin sees the assistant writing it. The
// fields are ordinary uncontrolled inputs; this only changes what is shown, and the admin still has to save.

const STEP_MS = 18;
const MAX_MS = 1800;

export function typeIntoField(name: string, text: string): void {
  if (typeof document === "undefined" || !text) return;
  let waited = 0;
  const find = () => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[role="dialog"] [name="${name}"]`);

  const start = () => {
    const el = find();
    if (!el) {
      waited += 40;
      if (waited < 1500) setTimeout(start, 40);
      return;
    }
    const chars = Array.from(text);
    const step = Math.max(1, Math.ceil((chars.length * STEP_MS) / MAX_MS));
    let i = 0;
    el.value = "";
    const tick = () => {
      i = Math.min(chars.length, i + step);
      el.value = chars.slice(0, i).join("");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (i < chars.length) setTimeout(tick, STEP_MS);
    };
    tick();
  };
  setTimeout(start, 120);
}
