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

"use client";
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Layers } from "lucide-react";
interface AIOpsButtonProps {
  onClick: () => void;
  disabled: boolean;
}

// Pointer movement below this many pixels counts as a click, not a drag.
const DRAG_THRESHOLD = 4;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  dragged: boolean;
}

export default function AIOpsBtn({ onClick, disabled }: AIOpsButtonProps) {
  // null = never dragged: keep the default centered spot in the chat header.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      dragged: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (
      !drag.dragged &&
      Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD &&
      Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD
    ) {
      return;
    }
    drag.dragged = true;
    setPos({
      x: Math.min(
        Math.max(e.clientX - drag.offsetX, 0),
        window.innerWidth - drag.width,
      ),
      y: Math.min(
        Math.max(e.clientY - drag.offsetY, 0),
        window.innerHeight - drag.height,
      ),
    });
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // The click event fires after pointerup; swallow it if this was a drag.
    suppressClickRef.current = drag.dragged;
    dragRef.current = null;
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (disabled) return;
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      // aria-disabled instead of disabled: a natively disabled button swallows
      // pointer events, which would make it undraggable while streaming.
      aria-disabled={disabled}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`${
        pos ? "fixed" : "absolute top-4 left-1/2 -translate-x-1/2"
      } z-10 flex cursor-grab touch-none items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-sm font-medium text-white shadow-md transition select-none active:cursor-grabbing ${
        disabled ? "opacity-50" : "hover:bg-green-600"
      }`}
    >
      <Layers className="h-4 w-4" />
      <span>AI Ops</span>
    </button>
  );
}
