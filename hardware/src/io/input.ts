// 输入脚本：每行「cycle keycode」（十进制，cycle=全局时钟周期，keycode 0=抬起），
// 按 cycle 非降序（SPEC）。事件自其 cycle 起生效，同周期多行取靠后者。

export interface InputEvent {
  cycle: number;
  keycode: number;
}

export function parseInputScript(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(/^(\d+)\s+(\d+)$/);
    if (!m) throw new Error(`输入脚本行非法: "${line}"`);
    events.push({ cycle: Number(m[1]), keycode: Number(m[2]) });
  }
  for (let i = 1; i < events.length; i++) {
    if (events[i].cycle < events[i - 1].cycle) {
      throw new Error(`输入脚本 cycle 非降序: 行 ${i}`);
    }
  }
  return events;
}

export class KeyboardDriver {
  private idx = 0;
  private current = 0;
  readonly events: InputEvent[];

  constructor(events: InputEvent[]) {
    this.events = events;
  }

  /** 第 cycle 周期执行前调用：把生效键值写入 set */
  apply(cycle: number, set: (v: number) => void): void {
    while (this.idx < this.events.length && this.events[this.idx].cycle <= cycle) {
      this.current = this.events[this.idx].keycode;
      this.idx++;
    }
    set(this.current & 0xffff);
  }
}
